import React, { useState } from 'react';
import { Play, Power, Share2 } from 'lucide-react';
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
    const [localPort, setLocalPort] = useState('');
    const [localAddress, setLocalAddress] = useState('127.0.0.1');
    const [internalAddress, setInternalAddress] = useState('127.0.0.1');
    const [internalPort, setInternalPort] = useState('');
    const [isActive, setIsActive] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sessionId = `forward-${sshConfig.host}-${localPort}`;

    const handleToggle = async () => {
        if (!localPort || !internalPort) {
            setError('Please fill in all port fields');
            return;
        }

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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div className="settings-group" style={{ marginBottom: 0, padding: '15px' }}>
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>{t('forward.title')}</div>

                        <div className="settings-row" style={{ gap: '15px', padding: '8px 0' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('forward.localAddress')}</label>
                                <input
                                    value={localAddress}
                                    onChange={(e) => setLocalAddress(e.target.value)}
                                    readOnly={isActive}
                                    placeholder="127.0.0.1"
                                    style={inputStyle(isActive)}
                                />
                            </div>
                            <div style={{ width: '120px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('forward.localPort')}</label>
                                <input
                                    value={localPort}
                                    onChange={(e) => setLocalPort(e.target.value.replace(/\D/g, ''))}
                                    readOnly={isActive}
                                    placeholder="8080"
                                    style={inputStyle(isActive)}
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
                                    readOnly={isActive}
                                    placeholder="127.0.0.1"
                                    style={inputStyle(isActive)}
                                />
                            </div>
                            <div style={{ width: '120px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('forward.internalPort')}</label>
                                <input
                                    value={internalPort}
                                    onChange={(e) => setInternalPort(e.target.value.replace(/\D/g, ''))}
                                    readOnly={isActive}
                                    placeholder="80"
                                    style={inputStyle(isActive)}
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
                            onClick={handleToggle}
                            className={isActive ? 'btn-danger' : 'btn-primary'}
                            style={{
                                width: '100%',
                                padding: '14px',
                                fontSize: '1.1em',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px'
                            }}
                        >
                            {isActive ? <Power size={20} /> : <Play size={20} />}
                            {isActive ? t('forward.stop') : t('forward.start')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
