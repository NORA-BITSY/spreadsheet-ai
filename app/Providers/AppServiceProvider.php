<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('tabular-api', function (Request $request): Limit {
            $configured = (int) config('tabular.rate_limit_api', 120);
            $limit = $this->app->environment('testing') && $configured === 120 ? 1000 : max(1, $configured);

            return Limit::perMinute($limit)->by($request->ip() ?: 'unknown');
        });

        RateLimiter::for('tabular-stream', function (Request $request): Limit {
            $configured = (int) config('tabular.rate_limit_stream', 30);
            $limit = $this->app->environment('testing') && $configured === 30 ? 1000 : max(1, $configured);

            return Limit::perMinute($limit)->by($request->ip() ?: 'unknown');
        });
    }
}
