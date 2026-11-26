<?php

declare(strict_types=1);

namespace Tests\Unit\TabularReview;

use App\Ai\TabularAiClient;
use App\Ai\TabularAnonymousAgent;
use Laravel\Ai\Gateway\TextGenerationOptions;
use Tests\TestCase;

class TabularAiClientTest extends TestCase
{
    public function test_make_agent_forwards_configured_max_tokens_and_temperature(): void
    {
        config([
            'tabular.max_tokens' => 2048,
            'tabular.temperature' => 0.35,
        ]);

        $client = app(TabularAiClient::class);
        $agent = $client->makeAgent('System instructions');

        $this->assertInstanceOf(TabularAnonymousAgent::class, $agent);

        $options = TextGenerationOptions::forAgent($agent);

        $this->assertSame(2048, $options->maxTokens);
        $this->assertSame(0.35, $options->temperature);
    }
}
