<?php

declare(strict_types=1);

namespace App\Ai;

use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper around the `laravel/ai` SDK so the rest of the codebase never
 * touches the SDK directly (single seam → trivial to fake / swap).
 *
 * `complete()` issues one text generation and returns the raw `->text`.
 *
 * Provider, model, max_tokens, and temperature come from `config('tabular.*')`
 * so callers stay env()-free. `TabularAnonymousAgent` exposes `maxTokens()`
 * and `temperature()` for `TextGenerationOptions::forAgent()`.
 *
 * SECURITY: any provider throwable is caught and re-thrown as {@see
 * AiException} with a GENERIC message. The real message is logged here, never
 * surfaced to callers / API consumers.
 */
class TabularAiClient
{
    public function makeAgent(string $system): TabularAnonymousAgent
    {
        return new TabularAnonymousAgent(
            instructions: $system,
            maxTokensValue: (int) config('tabular.max_tokens', 1200),
            temperatureValue: (float) config('tabular.temperature', 0.1),
        );
    }

    public function complete(string $system, string $user): string
    {
        try {
            return $this->makeAgent($system)
                ->prompt(
                    $user,
                    provider: config('tabular.provider'),
                    model: config('tabular.model'),
                )
                ->text;
        } catch (\Throwable $e) {
            Log::warning('TabularAiClient provider call failed', [
                'message' => $e->getMessage(),
                'exception' => $e::class,
            ]);

            throw new AiException('AI provider error.', previous: $e);
        }
    }
}
