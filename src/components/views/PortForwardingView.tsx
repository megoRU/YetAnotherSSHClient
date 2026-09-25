import { useState, useRef, useEffect, type FC, type SubmitEvent, type MouseEvent } from 'react';
import { ExternalLink, Loader2, Play, Power, Share2 } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import type { SSHConfig } from '../../types';

const { ipcRenderer } = window;

const buildForwardedUrl = (address: string, port: string): string => {
    let host = address.trim() || '127.0.0.1';

    if (host === '0.0.0.0') {
        host = '127.0.0.1';
    } else if (host === '::') {
        host = '::1';
    }

    if (host.includes(':') && !host.startsWith('[')) {
        host = `[${host}]`;
    }

    return `http://${host}:${port}`;
};

interface PortForwardingViewProps {
    sshConfig: SSHConfig;
    theme: string;
    language: 'ru' | 'en';
}

export const PortForwardingView: FC<PortForwardingViewProps> = ({ sshConfig, language }) => {
    const { t } = useI18n(language);
    const [localPort, setLocalPort] = useState('');
    const [localAddress, setLocalAddress] = useState('127.0.0.1');
    const [internalAddress, setInternalAddress] = useState('127.0.0.1');
    const [internalPort, setInternalPort] = useState('');
    const [isActive, setIsActive] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);

    const sessionId = `forward-${sshConfig.host}-${localPort}`;
    const activeSessionIdRef = useRef<string | null>(null);
    const forwardedUrl = isActive ? buildForwardedUrl(localAddress, localPort) : null;
    const isFieldsLocked = isActive || isPending;

    useEffect(() => {
        if (isActive) {
            activeSessionIdRef.current = sessionId;
        } else {
            activeSessionIdRef.current = null;
        }
    }, [isActive, sessionId]);

    useEffect(() => {
        return () => {
            if (activeSessionIdRef.current) {
                void ipcRenderer?.sshForwardStop?.(activeSessionIdRef.current);
            }
        };
    }, []);

    const handleToggle = async (e?: SubmitEvent<HTMLFormElement>) => {
        if (e) e.preventDefault();

        if (isPending) return;

        if (isActive) {
            setIsPending(true);
            try {
                if (typeof ipcRenderer !== 'undefined') {
                    await ipcRenderer?.sshForwardStop?.(sessionId);
                }
                setIsActive(false);
            } finally {
                setIsPending(false);
            }
            return;
        }

        if (typeof ipcRenderer === 'undefined') {
            setError('IPC renderer is not available');
            return;
        }

        setError(null);
        setIsPending(true);
        try {
            await ipcRenderer?.sshForwardStart?.({
                id: sessionId,
                config: sshConfig,
                localAddress,
                localPort: parseInt(localPort),
                remoteAddress: internalAddress,
                remotePort: parseInt(internalPort)
            });
            setIsActive(true);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsPending(false);
        }
    };

    const handleOpenForwardedUrl = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();

        if (!forwardedUrl) {
            return;
        }

        if (typeof ipcRenderer !== 'undefined' && ipcRenderer.openExternal) {
            ipcRenderer.openExternal(forwardedUrl);
        } else {
            window.open(forwardedUrl, '_blank', 'noopener,noreferrer');
        }
    };

    const inputStyle = (disabled: boolean) => ({
        width: '100%',
        padding: '8px',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'text'
    });

    const wideInputStyle = (disabled: boolean) => ({
        width: '100%',
        padding: '10px',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'text'
    });

    return (
        <div style={{
            userSelect: 'none',
            height: '100%',
            overflowY: 'auto'
        }}>
            <div style={{
                padding: '40px',
                maxWidth: '600px',
                margin: '0 auto'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
                    <div style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '12px',
                        background: 'var(--primary-color)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                    }}>
                        <Share2 size={28} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0 }}>{t('forward.title')}</h2>
                        <div style={{ opacity: 0.7, fontSize: '1em' }}>{sshConfig.name || sshConfig.host}</div>
                    </div>
                </div>

                <form ref={formRef} onSubmit={handleToggle} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div className="settings-group" style={{ marginBottom: 0, padding: '15px' }}>
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>{t('forward.title')}</div>

                        <div className="settings-row" style={{ gap: '15px', padding: '8px 0' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('forward.localAddress')}</label>
                                <input
                                    value={localAddress}
                                    onChange={(e) => setLocalAddress(e.target.value)}
                                    readOnly={isFieldsLocked}
                                    placeholder="127.0.0.1"
                                    style={inputStyle(isFieldsLocked)}
                                />
                            </div>
                            <div style={{ width: '120px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('forward.localPort')}</label>
                                <input
                                    required
                                    value={localPort}
                                    onChange={(e) => setLocalPort(e.target.value.replace(/\D/g, ''))}
                                    readOnly={isFieldsLocked}
                                    placeholder="80"
                                    style={inputStyle(isFieldsLocked)}
                                />
                            </div>
                        </div>

                        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px', padding: '8px 0' }}>
                            <label>{t('forward.remoteHost')}</label>
                            <input
                                value={sshConfig.host}
                                readOnly
                                style={{ ...wideInputStyle(true), cursor: 'not-allowed' }}
                            />
                        </div>

                        <div className="settings-row" style={{ gap: '15px', padding: '8px 0' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('forward.internalAddress')}</label>
                                <input
                                    value={internalAddress}
                                    onChange={(e) => setInternalAddress(e.target.value)}
                                    readOnly={isFieldsLocked}
                                    placeholder="127.0.0.1"
                                    style={inputStyle(isFieldsLocked)}
                                />
                            </div>
                            <div style={{ width: '120px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('forward.internalPort')}</label>
                                <input
                                    required
                                    value={internalPort}
                                    onChange={(e) => setInternalPort(e.target.value.replace(/\D/g, ''))}
                                    readOnly={isFieldsLocked}
                                    placeholder="80"
                                    style={inputStyle(isFieldsLocked)}
                                />
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div style={{
                            padding: '10px',
                            borderRadius: '8px',
                            background: 'rgba(255, 0, 0, 0.1)',
                            color: 'var(--danger-color)',
                            fontSize: '0.9em'
                        }}>
                            {t('forward.error')}: {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '15px', marginTop: '10px', flexDirection: 'column', alignItems: 'center' }}>
                        <button
                            type="submit"
                            disabled={isPending}
                            className={isActive ? 'btn-danger' : 'btn-primary'}
                            style={{
                                width: '100%',
                                padding: '14px',
                                fontSize: '1.1em',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                opacity: isPending ? 0.75 : 1,
                                cursor: 'pointer'
                            }}
                        >
                            {isPending
                                ? <Loader2 size={20} className="spin" />
                                : isActive ? <Power size={20} /> : <Play size={20} />}
                            {isPending
                                ? (isActive ? t('forward.stopping') : t('forward.starting'))
                                : (isActive ? t('forward.stop') : t('forward.start'))}
                        </button>

                        {isActive && forwardedUrl && (
                            <a
                                href={forwardedUrl}
                                onClick={handleOpenForwardedUrl}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '12px 14px',
                                    border: '1px solid var(--border)',
                                    borderRadius: '10px',
                                    background: 'var(--surface)',
                                    color: 'var(--text-primary)',
                                    textDecoration: 'none'
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    style={{
                                        width: '9px',
                                        height: '9px',
                                        flex: '0 0 auto',
                                        borderRadius: '50%',
                                        background: '#22c55e',
                                        boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.14)'
                                    }}
                                />
                                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                    <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.92em' }}>
                                        {t('forward.openInBrowser')}
                                    </span>
                                    <span
                                        style={{
                                            display: 'block',
                                            marginTop: '2px',
                                            color: 'var(--accent)',
                                            fontFamily: 'var(--mono-font-family)',
                                            fontSize: '0.92em',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {forwardedUrl}
                                    </span>
                                </span>
                                <ExternalLink size={18} color="var(--text-secondary)" />
                            </a>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};
