import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
    children: ReactNode;
    onReload?: () => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    override state: ErrorBoundaryState = {
        hasError: false,
        message: '',
    };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {
            hasError: true,
            message: error?.message || 'An unexpected error occurred.',
        };
    }

    override componentDidCatch(_error: Error, _info: ErrorInfo): void {
        // Error captured in state for fallback rendering.
    }

    private handleReload = (): void => {
        if (this.props.onReload) {
            this.props.onReload();
            return;
        }
        if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
            window.location.reload();
        }
    };

    override render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="error-boundary" role="alert">
                    <div className="error-boundary-card">
                        <h2>Something went wrong</h2>
                        <p className="error-boundary-msg">{this.state.message}</p>
                        <button
                            type="button"
                            className="btn primary"
                            onClick={this.handleReload}
                        >
                            Reload
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
