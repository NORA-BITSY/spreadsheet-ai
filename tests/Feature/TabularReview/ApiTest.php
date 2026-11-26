<?php

declare(strict_types=1);

namespace Tests\Feature\TabularReview;

use App\Models\TabularReview;
use App\Services\TabularReview\TabularReviewExtractor;
use App\Support\TabularReview\PresetData;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tabular.mock' => true]);
    }

    public function test_get_review_returns_full_shape(): void
    {
        $res = $this->getJson('/api/reviews/returns');

        $res->assertOk()
            ->assertJsonStructure([
                'review' => ['id', 'preset_key', 'title', 'row_source'],
                'base_columns',
                'columns',
                'rows' => [['row_id']],
                'cells',
                'suggestions_available',
                'ai_mode' => ['mock', 'provider', 'model'],
            ]);

        $this->assertSame('returns', $res->json('review.preset_key'));
        $this->assertSame('RET-1042', $res->json('rows.0.row_id'));
        $this->assertTrue($res->json('suggestions_available'));
        $this->assertTrue($res->json('ai_mode.mock'));
        $this->assertSame('anthropic', $res->json('ai_mode.provider'));
        $this->assertSame('claude-haiku-4-5', $res->json('ai_mode.model'));
    }

    public function test_get_review_is_idempotent_find_or_create(): void
    {
        $this->getJson('/api/reviews/returns')->assertOk();
        $this->getJson('/api/reviews/returns')->assertOk();

        $this->assertSame(1, TabularReview::query()->where('preset_key', 'returns')->count());
    }

    public function test_unknown_preset_is_404(): void
    {
        $this->getJson('/api/reviews/nope')->assertNotFound();
    }

    public function test_suggest_returns_cooked_proposals(): void
    {
        $res = $this->getJson('/api/suggest/returns');

        $res->assertOk();
        $this->assertCount(count(PresetData::suggestions()['returns']), $res->json('suggestions'));
        $this->assertSame('Probabilità chargeback 30gg', $res->json('suggestions.0.name'));
    }

    public function test_add_column_appends(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');
        $before = count($this->getJson('/api/reviews/returns')->json('columns'));

        $res = $this->postJson("/api/reviews/{$id}/columns", [
            'name' => 'New col',
            'format' => 'text',
            'prompt' => 'do something',
        ]);

        $res->assertCreated();
        $this->assertCount($before + 1, $res->json('columns'));
    }

    public function test_add_column_rejects_bad_format(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');

        $this->postJson("/api/reviews/{$id}/columns", [
            'name' => 'Bad',
            'format' => 'not_a_format',
        ])->assertStatus(422)->assertJsonValidationErrorFor('format');
    }

    public function test_add_enum_column_requires_enum_values(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');

        $this->postJson("/api/reviews/{$id}/columns", [
            'name' => 'Enum',
            'format' => 'enum',
        ])->assertStatus(422)->assertJsonValidationErrorFor('enum_values');
    }

    public function test_add_json_path_column_requires_json_path(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');

        $this->postJson("/api/reviews/{$id}/columns", [
            'name' => 'JP',
            'format' => 'json_path',
        ])->assertStatus(422)->assertJsonValidationErrorFor('json_path');
    }

    public function test_edit_column_clears_its_cells(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');
        $review = TabularReview::query()->find($id);

        // Seed a cell on column 0.
        app(TabularReviewExtractor::class)
            ->extractRow($review, PresetData::preset('returns')['rows'][0], 0, 'RET-1042');
        $this->assertSame('ready', $review->cells()->where('column_index', 0)->first()->status);

        $this->patchJson("/api/reviews/{$id}/columns/0", [
            'name' => 'Edited',
            'format' => 'text',
            'prompt' => 'changed',
        ])->assertOk();

        $this->assertSame('pending', $review->cells()->where('column_index', 0)->first()->status);
    }

    public function test_edit_unknown_column_is_404(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');

        $this->patchJson("/api/reviews/{$id}/columns/999", [
            'name' => 'X',
            'format' => 'text',
        ])->assertNotFound();
    }

    public function test_delete_column_removes_it(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');
        $before = count($this->getJson('/api/reviews/returns')->json('columns'));

        $res = $this->deleteJson("/api/reviews/{$id}/columns/0");

        $res->assertOk();
        $this->assertCount($before - 1, $res->json('columns'));
    }

    public function test_delete_column_preserves_and_shifts_unaffected_cells(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');
        $review = TabularReview::query()->findOrFail($id);

        // Extract row 0 across all columns (0..N-1).
        app(TabularReviewExtractor::class)
            ->extractRow($review, PresetData::preset('returns')['rows'][0], 0, 'RET-1042');

        $col0Summary = $review->cells()->where('row_id', 'RET-1042')->where('column_index', 0)->firstOrFail()->content['summary'];
        $col2Summary = $review->cells()->where('row_id', 'RET-1042')->where('column_index', 2)->firstOrFail()->content['summary'];
        $totalBefore = $review->cells()->where('row_id', 'RET-1042')->count();

        // Delete column 1 — column 0 stays at 0, column 2 shifts to 1.
        $this->deleteJson("/api/reviews/{$id}/columns/1")->assertOk();

        $this->assertSame($totalBefore - 1, $review->cells()->where('row_id', 'RET-1042')->count());
        $this->assertSame($col0Summary, $review->cells()->where('row_id', 'RET-1042')->where('column_index', 0)->firstOrFail()->content['summary']);
        $this->assertSame($col2Summary, $review->cells()->where('row_id', 'RET-1042')->where('column_index', 1)->firstOrFail()->content['summary']);
    }

    public function test_add_column_enforces_max_column_cap(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');
        $review = TabularReview::query()->findOrFail($id);

        $cols = [];
        for ($i = 0; $i < 30; $i++) {
            $cols[] = ['index' => $i, 'name' => "Col {$i}", 'prompt' => 'p', 'format' => 'text'];
        }
        $review->columns_config = $cols;
        $review->save();

        $this->postJson("/api/reviews/{$id}/columns", [
            'name' => 'Col 31',
            'format' => 'text',
            'prompt' => 'overflow',
        ])->assertStatus(422);
    }

    public function test_add_enum_column_rejects_whitespace_only_and_excessive_values(): void
    {
        $id = $this->getJson('/api/reviews/returns')->json('review.id');

        $this->postJson("/api/reviews/{$id}/columns", [
            'name' => 'Whitespace enum',
            'format' => 'enum',
            'enum_values' => ['Valid', '   '],
        ])->assertStatus(422)->assertJsonValidationErrorFor('enum_values.1');

        $this->postJson("/api/reviews/{$id}/columns", [
            'name' => 'Huge enum',
            'format' => 'enum',
            'enum_values' => array_map(static fn (int $i) => "opt-{$i}", range(1, 51)),
        ])->assertStatus(422)->assertJsonValidationErrorFor('enum_values');
    }

    public function test_api_rate_limit_enforces_429_when_configured_low(): void
    {
        config(['tabular.rate_limit_api' => 2]);

        $this->getJson('/api/reviews/returns')->assertOk();
        $this->getJson('/api/reviews/returns')->assertOk();
        $this->getJson('/api/reviews/returns')->assertStatus(429);
    }

    public function test_duplicate_tenant_preset_review_is_rejected_by_unique_index(): void
    {
        $this->getJson('/api/reviews/returns')->assertOk();

        $this->expectException(UniqueConstraintViolationException::class);

        TabularReview::query()->create([
            'tenant_id' => 'demo',
            'preset_key' => 'returns',
            'title' => 'Duplicate',
            'row_source' => 'returns_rows',
            'columns_config' => [],
        ]);
    }
}
