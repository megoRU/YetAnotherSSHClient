import React from 'react';

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = {hasError: false, error: null};
    }

    static getDerivedStateFromError(error: Error) {
        return {hasError: true, error};
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught an error', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            const lang = localStorage.getItem('last-lang') || 'ru';
            const isRu = lang === 'ru';
            return (
                <div style={{padding: '40px', color: '#cc241d', background: '#fbf1c7', height: '100vh', fontFamily: 'monospace'}}>
                    <h1 style={{ marginBottom: '20px' }}>{isRu ? 'Произошла ошибка' : 'An error occurred'}</h1>
                    <div style={{ background: 'rgba(0,0,0,0.05)', padding: '20px', borderRadius: '8px', marginBottom: '20px', overflow: 'auto', maxHeight: '60vh' }}>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error?.stack || this.state.error?.toString()}</pre>
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '10px 20px',
                            background: '#af3a03',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: 'bold'
                        }}
                    >
                        {isRu ? 'Перезагрузить приложение' : 'Reload Application'}
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
