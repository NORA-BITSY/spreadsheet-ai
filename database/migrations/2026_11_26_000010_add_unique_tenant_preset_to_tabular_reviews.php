<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tabular_reviews', function (Blueprint $table) {
            $table->unique(['tenant_id', 'preset_key']);
        });
    }

    public function down(): void
    {
        Schema::table('tabular_reviews', function (Blueprint $table) {
            $table->dropUnique(['tenant_id', 'preset_key']);
        });
    }
};
