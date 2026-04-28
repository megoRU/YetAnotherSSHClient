import React, { useState } from 'react';
import { Power, X } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import type { SSHConfig } from '../../types';

const { ipcRenderer } = window;

interface PortForwardingViewProps {
    sshConfig: SSHConfig;
    theme: string;
    language: 'ru' | 'en';
}

export const PortForwardingView: React.FC<PortForwardingViewProps> = ({ sshConfig, language }) => {
    const { t } = useI18n(language);
    const [localPort, setLocalPort] = useState('8080');
    const [localAddress, setLocalAddress] = useState('127.0.0.1');
    const [internalAddress, setInternalAddress] = useState('127.0.0.1');
    const [internalPort, setInternalPort] = useState('80');
    const [isActive, setIsActive] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sessionId = `forward-${sshConfig.host}-${localPort}`;

    const handleToggle = async () => {
        if (typeof ipcRenderer === 'undefined') {
            setError('IPC renderer is not available');
            return;
        }

        if (isActive) {
            await ipcRenderer.invoke('ssh-forward-stop', sessionId);
            setIsActive(false);
        } else {
            setError(null);
            try {
                await ipcRenderer.invoke('ssh-forward-start', {
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
            }
        }
    };

    const handleClose = () => {
        window.close();
    };

    return (
        <div style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-color)',
            color: 'var(--text-color)',
            padding: '20px',
            boxSizing: 'border-box',
            WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion']
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '1.2em' }}>{t('forward.title')}</h2>
                <div
                    onClick={handleClose}
                    style={{ cursor: 'pointer', WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'], opacity: 0.7 }}
                >
                    <X size={20} />
                </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
                <div className="form-group">
                    <label>{t('forward.localPort')}</label>
                    <input
                        type="text"
                        value={localPort}
                        onChange={(e) => setLocalPort(e.target.value.replace(/\D/g, ''))}
                        disabled={isActive}
                        className="custom-input"
                    />
                </div>

                <div className="form-group">
                    <label>{t('forward.localAddress')}</label>
                    <input
                        type="text"
                        value={localAddress}
                        onChange={(e) => setLocalAddress(e.target.value)}
                        disabled={isActive}
                        className="custom-input"
                    />
                </div>

                <div className="form-group">
                    <label>{t('forward.remoteHost')}</label>
                    <input
                        type="text"
                        value={sshConfig.host}
                        readOnly
                        className="custom-input"
                        style={{ opacity: 0.6 }}
                    />
                </div>

                <div className="form-group">
                    <label>{t('forward.internalAddress')}</label>
                    <input
                        type="text"
                        value={internalAddress}
                        onChange={(e) => setInternalAddress(e.target.value)}
                        disabled={isActive}
                        className="custom-input"
                    />
                </div>

                <div className="form-group">
                    <label>{t('forward.internalPort')}</label>
                    <input
                        type="text"
                        value={internalPort}
                        onChange={(e) => setInternalPort(e.target.value.replace(/\D/g, ''))}
                        disabled={isActive}
                        className="custom-input"
                    />
                </div>

                {error && (
                    <div style={{ color: 'var(--danger-color)', fontSize: '0.9em', marginTop: '10px' }}>
                        {t('forward.error')}: {error}
                    </div>
                )}
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
                <button
                    onClick={handleToggle}
                    className={`custom-button ${isActive ? 'danger' : 'primary'}`}
                    style={{
                        width: '100%',
                        height: '45px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        fontSize: '1.1em'
                    }}
                >
                    <Power size={20} />
                    {isActive ? t('forward.stop') : t('forward.start')}
                </button>
            </div>

            <div style={{
                marginTop: '15px',
                textAlign: 'center',
                fontSize: '0.85em',
                opacity: 0.6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
            }}>
                <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: isActive ? 'var(--success-color)' : 'var(--danger-color)'
                }} />
                {isActive ? t('forward.active') : t('forward.inactive')}
            </div>
        </div>
    );
};
