import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataEditorRef } from '@glideapps/glide-data-grid';
import { useSseGeneration } from '../../resources/js/grid/useSseGeneration';
import { createCellStore } from '../../resources/js/store/cells';
import { makeCell, sampleColumns, sampleRows } from './fixtures';

class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    closed = false;
    onerror: ((ev: Event) => void) | null = null;
    private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, fn: (ev: MessageEvent) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    emit(type: string, data: string) {
        for (const fn of this.listeners.get(type) ?? []) {
            fn(new MessageEvent(type, { data }));
        }
    }

    triggerError() {
        this.onerror?.(new Event('error'));
    }

    close() {
        this.closed = true;
    }
}

beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function makeGridRef() {
    const updateCells = vi.fn();
    return {
        ref: { current: { updateCells } as unknown as DataEditorRef },
        updateCells,
    };
}

describe('useSseGeneration', () => {
    it('batches generating cells, applies SSE cell events, and finishes on done', () => {
        const store = createCellStore();
        const { ref, updateCells } = makeGridRef();
        const onCell = vi.fn();

        let notifyCount = 0;
        store.subscribe(() => notifyCount++);

        const { result } = renderHook(() =>
            useSseGeneration({
                reviewId: 1,
                rows: sampleRows,
                columns: sampleColumns,
                store,
                gridRef: ref,
                baseColumnCount: 2,
                onCell,
            }),
        );

        act(() => {
            result.current.runColumns([0]);
        });

        expect(result.current.running).toBe(true);
        expect(result.current.progress).toEqual({ done: 0, total: 3 });
        // Initial generating pass uses batchSet -> 1 store notification.
        expect(notifyCount).toBe(1);
        expect(store.get('R1', 0)?.status).toBe('generating');

        const src = MockEventSource.instances[0];
        expect(src.url).toBe('/api/reviews/1/stream?cols=0&force=1');

        act(() => {
            src.emit(
                'cell',
                JSON.stringify({
                    row_id: 'R1',
                    column_index: 0,
                    content: { summary: 'A', flag: 'green', reasoning: 'ok', citations: [] },
                    flag: 'green',
                    confidence: 0.95,
                    status: 'ready',
                }),
            );
        });

        expect(store.get('R1', 0)?.status).toBe('ready');
        expect(store.get('R1', 0)?.content?.summary).toBe('A');
        expect(result.current.progress).toEqual({ done: 1, total: 3 });
        expect(onCell).toHaveBeenCalledTimes(1);
        expect(updateCells).toHaveBeenCalledWith([{ cell: [2, 0] }]);

        act(() => {
            src.emit('done', '{}');
        });

        expect(result.current.running).toBe(false);
        expect(src.closed).toBe(true);
    });

    it('skips malformed JSON and drops events for non-existent columns', () => {
        const store = createCellStore();
        const { ref } = makeGridRef();

        const { result } = renderHook(() =>
            useSseGeneration({
                reviewId: 1,
                rows: sampleRows,
                columns: sampleColumns,
                store,
                gridRef: ref,
                baseColumnCount: 2,
            }),
        );

        act(() => {
            result.current.runColumns([0]);
        });

        const src = MockEventSource.instances[0];

        act(() => {
            src.emit('cell', '{not-json');
            src.emit(
                'cell',
                JSON.stringify({
                    row_id: 'R1',
                    column_index: 99,
                    content: { summary: 'ghost', flag: 'green', reasoning: null, citations: [] },
                    flag: 'green',
                    confidence: 0.9,
                    status: 'ready',
                }),
            );
        });

        expect(store.get('R1', 99)).toBeUndefined();
        expect(result.current.progress.done).toBe(0);
    });

    it('stop() restores prior values and removes cells that had no prior value', () => {
        const store = createCellStore();
        const prior = makeCell('R1', 0, {
            content: { summary: 'previous', flag: 'green', reasoning: 'old', citations: [] },
        });
        store.set(prior);
        const { ref } = makeGridRef();

        const { result } = renderHook(() =>
            useSseGeneration({
                reviewId: 1,
                rows: sampleRows,
                columns: sampleColumns,
                store,
                gridRef: ref,
                baseColumnCount: 2,
            }),
        );

        act(() => {
            result.current.runColumns([0]);
        });

        expect(store.get('R1', 0)?.status).toBe('generating');
        expect(store.get('R2', 0)?.status).toBe('generating');

        act(() => {
            result.current.stop();
        });

        expect(result.current.running).toBe(false);
        expect(MockEventSource.instances[0].closed).toBe(true);
        expect(store.get('R1', 0)).toEqual(prior);
        expect(store.get('R2', 0)).toBeUndefined();
    });

    it('onerror transitions remaining generating cells to failed and calls onError', () => {
        const store = createCellStore();
        const { ref } = makeGridRef();
        const onError = vi.fn();

        const { result } = renderHook(() =>
            useSseGeneration({
                reviewId: 1,
                rows: sampleRows,
                columns: sampleColumns,
                store,
                gridRef: ref,
                baseColumnCount: 2,
                onError,
            }),
        );

        act(() => {
            result.current.runColumns([0]);
        });

        const src = MockEventSource.instances[0];

        // First cell arrives before error.
        act(() => {
            src.emit(
                'cell',
                JSON.stringify({
                    row_id: 'R1',
                    column_index: 0,
                    content: { summary: 'A', flag: 'green', reasoning: 'ok', citations: [] },
                    flag: 'green',
                    confidence: 0.9,
                    status: 'ready',
                }),
            );
            src.triggerError();
        });

        expect(result.current.running).toBe(false);
        expect(src.closed).toBe(true);
        expect(store.get('R1', 0)?.status).toBe('ready');
        expect(store.get('R2', 0)?.status).toBe('failed');
        expect(store.get('R2', 0)?.flag).toBe('red');
        expect(store.get('R3', 0)?.status).toBe('failed');
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('aborts active stream on reviewId switch and on unmount', () => {
        const store = createCellStore();
        const { ref } = makeGridRef();

        const { result, rerender, unmount } = renderHook(
            ({ reviewId }: { reviewId: number }) =>
                useSseGeneration({
                    reviewId,
                    rows: sampleRows,
                    columns: sampleColumns,
                    store,
                    gridRef: ref,
                    baseColumnCount: 2,
                }),
            { initialProps: { reviewId: 1 } },
        );

        act(() => {
            result.current.runColumns([0]);
        });
        const firstSrc = MockEventSource.instances[0];
        expect(firstSrc.closed).toBe(false);

        rerender({ reviewId: 2 });
        expect(firstSrc.closed).toBe(true);
        expect(result.current.running).toBe(false);

        // Start another run and unmount.
        act(() => {
            result.current.runColumns([1]);
        });
        const secondSrc = MockEventSource.instances[1];
        expect(secondSrc.closed).toBe(false);

        unmount();
        expect(secondSrc.closed).toBe(true);
    });
});
