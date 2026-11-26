<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\TabularReview;

use App\Http\Controllers\Controller;
use App\Http\Requests\TabularReview\ColumnRequest;
use App\Models\TabularCell;
use App\Models\TabularReview;
use App\Services\TabularReview\ReviewHydrator;
use App\Support\TabularReview\CellStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class ColumnController extends Controller
{
    private const MAX_COLUMNS = 30;

    public function __construct(
        private readonly ReviewHydrator $hydrator,
    ) {}

    /**
     * Append a new column. Its cells start pending (regenerate on demand).
     */
    public function store(ColumnRequest $request, int $id): JsonResponse
    {
        return DB::transaction(function () use ($request, $id): JsonResponse {
            $review = $this->findReview($id);
            $columns = $this->columns($review);

            if (count($columns) >= self::MAX_COLUMNS) {
                return response()->json([
                    'message' => 'Maximum number of columns ('.self::MAX_COLUMNS.') reached.',
                ], 422);
            }

            $newIndex = count($columns);
            $columns[] = $this->columnFromRequest($request, $newIndex);

            $this->saveColumns($review, $columns);
            // New column: no existing cells to clear.

            return response()->json($this->hydrator->payload($review->fresh()), 201);
        });
    }

    /**
     * Edit an existing column. Clears that column's cells (set pending) so
     * they regenerate.
     */
    public function update(ColumnRequest $request, int $id, int $index): JsonResponse
    {
        return DB::transaction(function () use ($request, $id, $index): JsonResponse {
            $review = $this->findReview($id);
            $columns = $this->columns($review);

            if (! array_key_exists($index, $columns)) {
                throw new NotFoundHttpException("Column [{$index}] not found.");
            }

            $columns[$index] = $this->columnFromRequest($request, $index);

            $this->saveColumns($review, $columns);
            $this->clearColumnCells($review, $index);

            return response()->json($this->hydrator->payload($review->fresh()));
        });
    }

    /**
     * Remove a column, reindex the remaining ones, and shift cells after the
     * deleted column down by 1 without wiping unaffected columns.
     */
    public function destroy(int $id, int $index): JsonResponse
    {
        return DB::transaction(function () use ($id, $index): JsonResponse {
            $review = $this->findReview($id);
            $columns = $this->columns($review);

            if (! array_key_exists($index, $columns)) {
                throw new NotFoundHttpException("Column [{$index}] not found.");
            }

            unset($columns[$index]);
            $columns = array_values($columns);
            foreach ($columns as $i => &$col) {
                $col['index'] = $i;
            }
            unset($col);

            $this->saveColumns($review, $columns);

            // Delete only cells belonging to the removed column, then shift
            // higher column_index cells down by 1 in ascending column_index
            // order so UNIQUE(review_id, row_id, column_index) never collides.
            TabularCell::query()
                ->where('review_id', $review->id)
                ->where('column_index', $index)
                ->delete();

            $cellsToShift = TabularCell::query()
                ->where('review_id', $review->id)
                ->where('column_index', '>', $index)
                ->orderBy('column_index')
                ->get();

            foreach ($cellsToShift as $cell) {
                $cell->column_index = $cell->column_index - 1;
                $cell->save();
            }

            return response()->json($this->hydrator->payload($review->fresh()));
        });
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function columns(TabularReview $review): array
    {
        return array_values($review->columns_config ?? []);
    }

    /**
     * @return array<string, mixed>
     */
    private function columnFromRequest(ColumnRequest $request, int $index): array
    {
        $col = [
            'index' => $index,
            'name' => (string) $request->input('name'),
            'prompt' => (string) ($request->input('prompt') ?? ''),
            'format' => (string) $request->input('format'),
        ];

        $enumValues = $request->input('enum_values');
        if (is_array($enumValues) && $enumValues !== []) {
            $col['enum_values'] = array_values($enumValues);
        }

        $jsonPath = $request->input('json_path');
        if (is_string($jsonPath) && trim($jsonPath) !== '') {
            $col['json_path'] = trim($jsonPath);
        }

        return $col;
    }

    /**
     * @param  list<array<string, mixed>>  $columns
     */
    private function saveColumns(TabularReview $review, array $columns): void
    {
        $review->columns_config = $columns;
        $review->save();
    }

    private function clearColumnCells(TabularReview $review, int $columnIndex): void
    {
        TabularCell::query()
            ->where('review_id', $review->id)
            ->where('column_index', $columnIndex)
            ->update([
                'content' => null,
                'flag' => null,
                'confidence' => null,
                'status' => CellStatus::PENDING->value,
                'generated_at' => null,
            ]);
    }

    private function findReview(int $id): TabularReview
    {
        $review = TabularReview::query()->where('tenant_id', 'demo')->find($id);

        if ($review === null) {
            throw new NotFoundHttpException("Review [{$id}] not found.");
        }

        return $review;
    }
}
