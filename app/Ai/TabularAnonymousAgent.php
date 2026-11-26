<?php

declare(strict_types=1);

namespace App\Ai;

use Laravel\Ai\AnonymousAgent;

/**
 * AnonymousAgent subclass that exposes `maxTokens()` and `temperature()`
 * so `Laravel\Ai\Gateway\TextGenerationOptions::forAgent()` forwards the
 * configured `tabular.max_tokens` and `tabular.temperature` values to the
 * underlying provider gateway.
 */
class TabularAnonymousAgent extends AnonymousAgent
{
    public function __construct(
        string $instructions,
        private readonly int $maxTokensValue,
        private readonly float $temperatureValue,
        iterable $messages = [],
        iterable $tools = [],
    ) {
        parent::__construct($instructions, $messages, $tools);
    }

    public function maxTokens(): int
    {
        return $this->maxTokensValue;
    }

    public function temperature(): float
    {
        return $this->temperatureValue;
    }
}
