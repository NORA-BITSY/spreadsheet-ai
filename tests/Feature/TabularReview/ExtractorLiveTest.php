<?php

declare(strict_types=1);

namespace Tests\Feature\TabularReview;

use App\Ai\TabularAnonymousAgent;
use App\Models\TabularReview;
use App\Services\TabularReview\TabularReviewExtractor;
use App\Support\TabularReview\CellStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Ai\Ai;
use Tests\TestCase;

class ExtractorLiveTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tabular.mock' => false]);
    }

    /**
     * A review with two LLM columns (0,1) and one json_path column (2).
     */
    private function review(): TabularReview
    {
        return TabularReview::query()->create([
            'tenant_id' => 'demo',
            'preset_key' => 'returns',
            'title' => 'Live test',
            'row_source' => 'returns_rows',
            'columns_config' => [
                ['index' => 0, 'name' => 'Reason', 'prompt' => 'Classify', 'format' => 'enum', 'enum_values' => ['A', 'B']],
                ['index' => 1, 'name' => 'Serial', 'prompt' => 'Serial?', 'format' => 'yes_no'],
                ['index' => 2, 'name' => 'Conf', 'prompt' => '$.meta.confidence', 'format' => 'json_path', 'json_path' => '$.meta.confidence'],
            ],
        ]);
    }

    public function test_parses_json_lines_into_cells_and_resolves_json_path(): void
    {
        Ai::fakeAgent(TabularAnonymousAgent::class, [
            implode("\n", [
                '{"column_index":0,"summary":"A","flag":"green","reasoning":"clear","citations":["q1"]}',
                '{"column_index":1,"summary":"Yes","flag":"yellow","reasoning":"maybe","citations":[]}',
            ]),
        ]);

        $extractor = app(TabularReviewExtractor::class);
        $row = ['id' => 'RET-1', 'reason' => 'x', 'meta' => ['confidence' => 88]];

        $cells = $extractor->extractRow($this->review(), $row, 0, 'RET-1');

        $byIdx = collect($cells)->keyBy('column_index');

        $this->assertSame('A', $byIdx[0]->content['summary']);
        $this->assertSame('green', $byIdx[0]->flag);
        $this->assertSame(CellStatus::READY->value, $byIdx[0]->status);

        $this->assertSame('Yes', $byIdx[1]->content['summary']);
        $this->assertSame('yellow', $byIdx[1]->flag);

        // json_path column resolved LLM-free, flag grey.
        $this->assertSame('88', $byIdx[2]->content['summary']);
        $this->assertSame('grey', $byIdx[2]->flag);
    }

    public function test_missing_column_line_becomes_red_refusal(): void
    {
        // Only column 0 returned; column 1 missing → red refusal (R14).
        Ai::fakeAgent(TabularAnonymousAgent::class, [
            '{"column_index":0,"summary":"A","flag":"green","reasoning":"ok","citations":[]}',
        ]);

        $extractor = app(TabularReviewExtractor::class);
        $row = ['id' => 'RET-1', 'meta' => ['confidence' => 90]];

        $cells = $extractor->extractRow($this->review(), $row, 0, 'RET-1');
        $byIdx = collect($cells)->keyBy('column_index');

        $this->assertSame('red', $byIdx[1]->flag);
        $this->assertNull($byIdx[1]->content['summary']);
        $this->assertSame(CellStatus::FAILED->value, $byIdx[1]->status);
    }

    public function test_empty_summary_becomes_red_refusal(): void
    {
        Ai::fakeAgent(TabularAnonymousAgent::class, [
            implode("\n", [
                '{"column_index":0,"summary":null,"flag":"red"}',
                '{"column_index":1,"summary":"","flag":"green"}',
            ]),
        ]);

        $extractor = app(TabularReviewExtractor::class);
        $row = ['id' => 'RET-1', 'meta' => ['confidence' => 90]];

        $cells = $extractor->extractRow($this->review(), $row, 0, 'RET-1');
        $byIdx = collect($cells)->keyBy('column_index');

        $this->assertSame('red', $byIdx[0]->flag);
        $this->assertNull($byIdx[0]->content['summary']);
        $this->assertSame('red', $byIdx[1]->flag);
    }

    public function test_provider_exception_does_not_leak_raw_message(): void
    {
        $secret = 'SECRET_HOST api.internal.example.com KEY sk-leak-123';

        Ai::fakeAgent(TabularAnonymousAgent::class, function () use ($secret) {
            throw new \RuntimeException($secret);
        });

        $extractor = app(TabularReviewExtractor::class);
        $row = ['id' => 'RET-1', 'meta' => ['confidence' => 90]];

        $cells = $extractor->extractRow($this->review(), $row, 0, 'RET-1');
        $byIdx = collect($cells)->keyBy('column_index');

        // Both LLM columns are red refusals; json_path col still resolves.
        foreach ([0, 1] as $idx) {
            $this->assertSame('red', $byIdx[$idx]->flag);
            $this->assertStringNotContainsString('SECRET_HOST', (string) $byIdx[$idx]->content['reasoning']);
            $this->assertStringNotContainsString('sk-leak-123', (string) $byIdx[$idx]->content['reasoning']);
            $this->assertStringNotContainsString('api.internal', (string) $byIdx[$idx]->content['reasoning']);
        }

        $this->assertSame('90', $byIdx[2]->content['summary']);
    }

    public function test_non_json_path_format_with_json_path_resolves_without_llm(): void
    {
        $review = TabularReview::query()->create([
            'tenant_id' => 'demo',
            'preset_key' => 'returns',
            'title' => 'JsonPath percentage',
            'row_source' => 'returns_rows',
            'columns_config' => [
                ['index' => 0, 'name' => 'Conf', 'prompt' => '$.meta.confidence', 'format' => 'percentage', 'json_path' => '$.meta.confidence'],
            ],
        ]);

        Ai::fakeAgent(TabularAnonymousAgent::class, function () {
            throw new \RuntimeException('LLM must not be called for json_path columns');
        });

        $cells = app(TabularReviewExtractor::class)->extractRow(
            $review,
            ['id' => 'RET-1', 'meta' => ['confidence' => '94%']],
            0,
            'RET-1',
        );

        $this->assertCount(1, $cells);
        $this->assertSame('94%', $cells[0]->content['summary']);
        $this->assertSame('grey', $cells[0]->flag);
    }

    public function test_handles_non_scalar_summaries_and_json_array_response(): void
    {
        $review = TabularReview::query()->create([
            'tenant_id' => 'demo',
            'preset_key' => 'returns',
            'title' => 'Array summary',
            'row_source' => 'returns_rows',
            'columns_config' => [
                ['index' => 0, 'name' => 'Bullets', 'prompt' => 'List items', 'format' => 'bulleted_list'],
                ['index' => 1, 'name' => 'Meta', 'prompt' => 'Describe', 'format' => 'text'],
            ],
        ]);

        Ai::fakeAgent(TabularAnonymousAgent::class, [
            json_encode([
                [
                    'column_index' => 0,
                    'summary' => ['Item one', 'Item two'],
                    'flag' => 'green',
                    'reasoning' => 'extracted list',
                    'citations' => [],
                ],
                [
                    'column_index' => 1,
                    'summary' => ['key' => 'val'],
                    'flag' => 'yellow',
                    'reasoning' => 'structured',
                    'citations' => [],
                ],
            ], JSON_PRETTY_PRINT),
        ]);

        $cells = app(TabularReviewExtractor::class)->extractRow($review, ['id' => 'RET-1'], 0, 'RET-1');
        $byIdx = collect($cells)->keyBy('column_index');

        $this->assertSame(['Item one', 'Item two'], $byIdx[0]->content['summary']);
        $this->assertSame('{"key":"val"}', $byIdx[1]->content['summary']);
    }

    public function test_parses_pretty_printed_multiline_json_objects(): void
    {
        $pretty = <<<'JSON'
{
  "column_index": 0,
  "summary": "A",
  "flag": "green",
  "reasoning": "clear",
  "citations": []
}
{
  "column_index": 1,
  "summary": "No",
  "flag": "green",
  "reasoning": "none",
  "citations": []
}
JSON;

        Ai::fakeAgent(TabularAnonymousAgent::class, [$pretty]);

        $cells = app(TabularReviewExtractor::class)->extractRow(
            $this->review(),
            ['id' => 'RET-1', 'meta' => ['confidence' => 75]],
            0,
            'RET-1',
        );
        $byIdx = collect($cells)->keyBy('column_index');

        $this->assertSame('A', $byIdx[0]->content['summary']);
        $this->assertSame('No', $byIdx[1]->content['summary']);
        $this->assertSame('75', $byIdx[2]->content['summary']);
    }

    public function test_user_prompt_wraps_row_data_in_untrusted_tags_and_truncates(): void
    {
        $capturedPrompt = '';

        Ai::fakeAgent(TabularAnonymousAgent::class, function ($prompt) use (&$capturedPrompt) {
            $capturedPrompt = (string) $prompt;

            return implode("\n", [
                '{"column_index":0,"summary":"A","flag":"green"}',
                '{"column_index":1,"summary":"Yes","flag":"green"}',
            ]);
        });

        $hugeRow = [
            'id' => 'RET-1',
            'meta' => ['confidence' => 99],
            'blob' => str_repeat('x', 40000),
        ];

        app(TabularReviewExtractor::class)->extractRow($this->review(), $hugeRow, 0, 'RET-1');

        $this->assertStringContainsString('<untrusted_row_data>', $capturedPrompt);
        $this->assertStringContainsString('</untrusted_row_data>', $capturedPrompt);
        $this->assertStringContainsString('...[truncated]', $capturedPrompt);
    }
}
