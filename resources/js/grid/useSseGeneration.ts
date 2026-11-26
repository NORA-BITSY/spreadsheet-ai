// ============================================================
// SSE consumer + run controller.
//
// - ONE EventSource per run (article §10): on `event: cell` write to the cell
//   store and atomically repaint via gridRef.updateCells; on `event: done`
//   close + finish.
// - Run-token guard (§1.A.7): each run captures a token; if the preset/review
//   changes (token bumped) or stop() is called, late events are ignored and the
//   stream is closed — no stale cell can bleed into a new preset.
// - Targeted cells are snapshotted before being marked `generating` (via a
//   single `batchSet`), so stop() can restore prior values and onerror can
//   transition remaining skeletons to `failed`.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataEditorRef } from '@glideapps/glide-data-grid';
import { streamUrl, type AiColumn, type Cell, type Row } from '../api/client';
import { cellKey, type CellKey, type SubscribableCellStore } from '../store/cells';
import { applyCellEvent, type SseCellEvent } from './sseReducer';

export interface RunProgress {
    done: number;
    total: number;
}

export interface UseSseGenerationArgs {
    reviewId: number | undefined;
    rows: Row[];
    columns: AiColumn[];
    store: SubscribableCellStore;
    gridRef: React.RefObject<DataEditorRef | null>;
    /**
     * Number of base (display) columns to the left of AI columns — needed to
     * translate an AI column_index into a Glide grid column for updateCells.
     */
    baseColumnCount: number;
    /** Called whenever a cell event lands (for footer/citation refresh). */
    onCell?: (cell: Cell) => void;
    /** Called when the EventSource errors and aborts the stream. */
    onError?: (message: string) => void;
}

export interface SseGenerationApi {
    running: boolean;
    progress: RunProgress;
    runAll: () => void;
    runColumns: (indexes: number[]) => void;
    stop: () => void;
}

interface PendingCellSnapshot {
    rowId: string;
    columnIndex: number;
    prior: Cell | undefined;
}

export function useSseGeneration({
    reviewId,
    rows,
    columns,
    store,
    gridRef,
    baseColumnCount,
    onCell,
    onError,
}: UseSseGenerationArgs): SseGenerationApi {
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<RunProgress>({ done: 0, total: 0 });

    const sourceRef = useRef<EventSource | null>(null);
    const tokenRef = useRef(0);
    const pendingRef = useRef<Map<CellKey, PendingCellSnapshot>>(new Map());

    // Keep latest rows/columns/callbacks in refs so active EventSource handlers
    // always resolve current grid offsets even if columns or rows mutate.
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const columnsRef = useRef(columns);
    columnsRef.current = columns;
    const baseColumnCountRef = useRef(baseColumnCount);
    baseColumnCountRef.current = baseColumnCount;
    const onCellRef = useRef(onCell);
    onCellRef.current = onCell;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const closeStream = useCallback(() => {
        sourceRef.current?.close();
        sourceRef.current = null;
    }, []);

    const repaintEntries = useCallback(
        (entries: Array<{ rowId: string; columnIndex: number }>) => {
            if (entries.length === 0 || !gridRef.current) return;
            const currentRows = rowsRef.current;
            const currentCols = columnsRef.current;
            const baseCount = baseColumnCountRef.current;
            const coords: Array<{ cell: [number, number] }> = [];
            for (const { rowId, columnIndex } of entries) {
                const offset = columnGridOffset(currentCols, columnIndex);
                if (offset < 0) continue;
                const rowIdx = currentRows.findIndex((r) => r.row_id === rowId);
                if (rowIdx < 0) continue;
                coords.push({ cell: [baseCount + offset, rowIdx] });
            }
            if (coords.length > 0) {
                gridRef.current.updateCells(coords);
            }
        },
        [gridRef],
    );

    const restorePendingGenerating = useCallback(() => {
        if (pendingRef.current.size === 0) return;
        const toRestore: Cell[] = [];
        const toRemove: CellKey[] = [];
        const repaints: Array<{ rowId: string; columnIndex: number }> = [];

        for (const [key, snap] of pendingRef.current.entries()) {
            if (store.getByKey(key)?.status !== 'generating') continue;
            if (snap.prior) {
                toRestore.push(snap.prior);
            } else {
                toRemove.push(key);
            }
            repaints.push({ rowId: snap.rowId, columnIndex: snap.columnIndex });
        }

        pendingRef.current.clear();
        if (toRestore.length > 0) store.batchSet(toRestore);
        if (toRemove.length > 0) store.batchRemove(toRemove);
        repaintEntries(repaints);
    }, [store, repaintEntries]);

    const stop = useCallback(() => {
        tokenRef.current += 1; // Invalidate in-flight events.
        closeStream();
        restorePendingGenerating();
        setRunning(false);
    }, [closeStream, restorePendingGenerating]);

    // Bump the token (and close any stream) whenever the review changes so a
    // mid-run preset switch can't patch stale cells into the new preset.
    useEffect(() => {
        tokenRef.current += 1;
        closeStream();
        pendingRef.current.clear();
        setRunning(false);
        setProgress({ done: 0, total: 0 });
    }, [reviewId, closeStream]);

    useEffect(() => () => stop(), [stop]);

    const start = useCallback(
        (targetIndexes: number[]) => {
            const currentRows = rowsRef.current;
            const currentCols = columnsRef.current;
            if (reviewId == null || currentRows.length === 0 || targetIndexes.length === 0) return;

            // Abort any previous stream and restore any leftover generating cells.
            closeStream();
            restorePendingGenerating();
            const token = ++tokenRef.current;

            const total = currentRows.length * targetIndexes.length;
            setProgress({ done: 0, total });
            setRunning(true);

            // Snapshot prior values and mark every targeted cell `generating` in one batch.
            const generatingCells: Cell[] = [];
            const repaintCoords: Array<{ cell: [number, number] }> = [];
            const baseCount = baseColumnCountRef.current;

            for (let rowIdx = 0; rowIdx < currentRows.length; rowIdx++) {
                const row = currentRows[rowIdx];
                for (const colIndex of targetIndexes) {
                    const key = cellKey(row.row_id, colIndex);
                    const prior = store.getByKey(key);
                    pendingRef.current.set(key, {
                        rowId: row.row_id,
                        columnIndex: colIndex,
                        prior: prior?.status === 'generating' ? undefined : prior,
                    });
                    generatingCells.push({
                        row_id: row.row_id,
                        column_index: colIndex,
                        content: null,
                        flag: null,
                        confidence: null,
                        status: 'generating',
                    });
                    const offset = columnGridOffset(currentCols, colIndex);
                    if (offset >= 0) {
                        repaintCoords.push({ cell: [baseCount + offset, rowIdx] });
                    }
                }
            }
            store.batchSet(generatingCells);
            if (repaintCoords.length > 0) {
                gridRef.current?.updateCells(repaintCoords);
            }

            const src = new EventSource(streamUrl(reviewId, { cols: targetIndexes, force: true }));
            sourceRef.current = src;

            src.addEventListener('cell', (e: MessageEvent) => {
                let ev: SseCellEvent;
                try {
                    ev = JSON.parse(e.data) as SseCellEvent;
                } catch {
                    return;
                }
                if (token !== tokenRef.current) return;

                const offset = columnGridOffset(columnsRef.current, ev.column_index);
                if (offset < 0) return; // Column no longer exists — drop stale event.

                const key = applyCellEvent({
                    store,
                    ev,
                    eventToken: token,
                    activeToken: tokenRef.current,
                });
                if (key == null) return; // stale run

                pendingRef.current.delete(key);

                // Atomic per-cell repaint.
                const gridCol = baseColumnCountRef.current + offset;
                const rowIdx = rowsRef.current.findIndex((r) => r.row_id === ev.row_id);
                if (rowIdx >= 0) {
                    gridRef.current?.updateCells([{ cell: [gridCol, rowIdx] }]);
                }
                setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + 1) }));
                onCellRef.current?.(store.getByKey(key) as Cell);
            });

            src.addEventListener('done', () => {
                if (token !== tokenRef.current) return;
                pendingRef.current.clear();
                closeStream();
                setRunning(false);
            });

            src.onerror = () => {
                if (token !== tokenRef.current) return;
                // Stream ended/aborted — transition remaining skeletons to failed.
                closeStream();
                const failedCells: Cell[] = [];
                const repaints: Array<{ rowId: string; columnIndex: number }> = [];
                for (const [key, snap] of pendingRef.current.entries()) {
                    if (store.getByKey(key)?.status !== 'generating') continue;
                    failedCells.push({
                        row_id: snap.rowId,
                        column_index: snap.columnIndex,
                        content: {
                            summary: null,
                            flag: 'red',
                            reasoning: 'Stream interrupted — cell could not be generated.',
                            citations: [],
                        },
                        flag: 'red',
                        confidence: 0,
                        status: 'failed',
                    });
                    repaints.push({ rowId: snap.rowId, columnIndex: snap.columnIndex });
                }
                pendingRef.current.clear();
                if (failedCells.length > 0) {
                    store.batchSet(failedCells);
                    repaintEntries(repaints);
                }
                setRunning(false);
                onErrorRef.current?.('Stream interrupted — some cells could not be generated.');
            };
        },
        [reviewId, store, gridRef, closeStream, restorePendingGenerating, repaintEntries],
    );

    const runAll = useCallback(() => {
        start(columnsRef.current.map((c) => c.index));
    }, [start]);

    const runColumns = useCallback(
        (indexes: number[]) => {
            start(indexes);
        },
        [start],
    );

    return { running, progress, runAll, runColumns, stop };
}

/**
 * Translate an AI column's `index` (its stable column_index) into its 0-based
 * position among the AI columns currently displayed, so we can compute the
 * Glide grid column. Returns -1 if not found.
 */
function columnGridOffset(columns: AiColumn[], columnIndex: number): number {
    return columns.findIndex((c) => c.index === columnIndex);
}
