<?php

declare(strict_types=1);

namespace Tests\Feature\TabularReview;

use App\Models\TabularReview;
use App\Support\TabularReview\PresetData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StreamTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tabular.mock' => true, 'tabular.sse_pacing_ms' => 0]);
    }

    private function review(): TabularReview
    {
        $preset = PresetData::preset('returns');

        return TabularReview::query()->create([
            'tenant_id' => 'demo',
            'preset_key' => 'returns',
            'title' => 'Triage Resi',
            'row_source' => 'returns_rows',
            'columns_config' => PresetData::columnsConfig($preset),
        ]);
    }

    public function test_stream_is_event_stream_with_cells_and_done(): void
    {
        $review = $this->review();

        $res = $this->get("/api/reviews/{$review->id}/stream");

        $res->assertOk();
        $res->assertHeader('Content-Type', 'text/event-stream; charset=UTF-8');
        $res->assertHeader('Cache-Control', 'no-cache, private');
        $res->assertHeader('X-Accel-Buffering', 'no');

        $body = $res->streamedContent();

        $this->assertGreaterThanOrEqual(1, substr_count($body, 'event: cell'));
        $this->assertStringContainsString('event: done', $body);
    }

    public function test_stream_respects_cols_filter(): void
    {
        $review = $this->review();

        $body = $this->get("/api/reviews/{$review->id}/stream?cols=0")->streamedContent();

        // 14 returns rows, one column → 14 cell events.
        $this->assertSame(14, substr_count($body, 'event: cell'));
    }

    public function test_stream_unknown_review_is_404(): void
    {
        $this->get('/api/reviews/9999/stream')->assertNotFound();
    }

    public function test_stream_rejects_invalid_cols_with_422(): void
    {
        $review = $this->review();
        $colCount = count($review->columns_config ?? []);

        $this->getJson("/api/reviews/{$review->id}/stream?cols=-1")
            ->assertStatus(422)
            ->assertJson(['message' => 'Invalid cols parameter.']);

        $this->getJson("/api/reviews/{$review->id}/stream?cols=abc")
            ->assertStatus(422)
            ->assertJson(['message' => 'Invalid cols parameter.']);

        $this->getJson("/api/reviews/{$review->id}/stream?cols={$colCount}")
            ->assertStatus(422)
            ->assertJson(['message' => 'Invalid cols parameter.']);

        $this->getJson("/api/reviews/{$review->id}/stream?cols=0,,1")
            ->assertStatus(422)
            ->assertJson(['message' => 'Invalid cols parameter.']);
    }

    public function test_stream_deduplicates_cols_filter(): void
    {
        $review = $this->review();

        $body = $this->get("/api/reviews/{$review->id}/stream?cols=0,0,0")->streamedContent();

        // 14 returns rows, deduplicated single column → 14 cell events.
        $this->assertSame(14, substr_count($body, 'event: cell'));
    }

    public function test_stream_rate_limit_enforces_429_when_configured_low(): void
    {
        config(['tabular.rate_limit_stream' => 1]);
        $review = $this->review();

        $this->get("/api/reviews/{$review->id}/stream?cols=0")->assertOk();
        $this->getJson("/api/reviews/{$review->id}/stream?cols=0")->assertStatus(429);
    }
}
