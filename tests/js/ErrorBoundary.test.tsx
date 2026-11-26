import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../resources/js/components/ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new Error('Kaboom from child');
    }
    return <div>Healthy child</div>;
}

describe('ErrorBoundary', () => {
    it('renders children when nothing throws', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={false} />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Healthy child')).toBeInTheDocument();
    });

    it('renders fallback UI with error message and Reload button when a child throws', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onReload = vi.fn();

        render(
            <ErrorBoundary onReload={onReload}>
                <Bomb shouldThrow />
            </ErrorBoundary>,
        );

        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText('Kaboom from child')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Reload/i }));
        expect(onReload).toHaveBeenCalledTimes(1);

        consoleSpy.mockRestore();
    });
});
