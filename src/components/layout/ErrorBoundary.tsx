import React from 'react';

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
    constructor(props: any) {
        super(props);
        this.state = {hasError: false, error: null};
    }

    static getDerivedStateFromError(error: any) {
        return {hasError: true, error};
    }

    componentDidCatch(error: any, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught an error', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{padding: '40px', color: 'red', background: 'white', height: '100vh'}}>
                    <h1>Что-то пошло не так.</h1>
                    <pre>{this.state.error?.toString()}</pre>
                    <button onClick={() => window.location.reload()}>Перезагрузить приложение</button>
                </div>
            );
        }

        return this.props.children;
    }
}
