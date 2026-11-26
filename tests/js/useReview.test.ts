import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAddColumn, useUpdateColumn } from '../../resources/js/hooks/useReview';
import { queryKeys } from '../../resources/js/api/queryClient';
import type { ReviewResponse } from '../../resources/js/api/client';
import { sampleReview } from './fixtures';

afterEach(() => {
    vi.unstubAllGlobals();
});

function createWrapper(qc: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: qc }, children);
    };
}

describe('useReview column mutations', () => {
    it('useUpdateColumn applies optimistic update and rolls back on error', async () => {
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        qc.setQueryData<ReviewResponse>(queryKeys.review('returns'), sampleReview);

        let rejectFetch!: (err: Error) => void;
        vi.stubGlobal(
            'fetch',
            vi.fn(
                () =>
                    new Promise<Response>((_res, rej) => {
                        rejectFetch = rej;
                    }),
            ),
        );

        const { result } = renderHook(() => useUpdateColumn('returns', 1), {
            wrapper: createWrapper(qc),
        });

        act(() => {
            result.current.mutate({ index: 0, col: { name: 'Renamed' } });
        });

        await waitFor(() => {
            const cached = qc.getQueryData<ReviewResponse>(queryKeys.review('returns'));
            expect(cached?.columns[0].name).toBe('Renamed');
        });

        act(() => {
            rejectFetch(new Error('Network down'));
        });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });

        const rolledBack = qc.getQueryData<ReviewResponse>(queryKeys.review('returns'));
        expect(rolledBack?.columns[0].name).toBe('Motivo');
    });

    it('useAddColumn and useUpdateColumn update cache without triggering invalidateQueries refetch', async () => {
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        qc.setQueryData<ReviewResponse>(queryKeys.review('returns'), sampleReview);
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

        const updatedReview: ReviewResponse = {
            ...sampleReview,
            columns: [
                ...sampleReview.columns,
                { index: 3, name: 'New Col', prompt: 'p', format: 'text' },
            ],
        };

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify(updatedReview), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }),
            ),
        );

        const addHook = renderHook(() => useAddColumn('returns', 1), {
            wrapper: createWrapper(qc),
        });

        await act(async () => {
            await addHook.result.current.mutateAsync({
                name: 'New Col',
                prompt: 'p',
                format: 'text',
            });
        });

        expect(qc.getQueryData<ReviewResponse>(queryKeys.review('returns'))?.columns).toHaveLength(4);
        expect(invalidateSpy).not.toHaveBeenCalled();

        const updateHook = renderHook(() => useUpdateColumn('returns', 1), {
            wrapper: createWrapper(qc),
        });

        await act(async () => {
            await updateHook.result.current.mutateAsync({
                index: 3,
                col: { name: 'Updated Col' },
            });
        });

        expect(invalidateSpy).not.toHaveBeenCalled();
    });
});
