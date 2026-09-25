import { useEffect, useState, type FC, type FormEvent } from 'react';
import { Server } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { getOSIcon } from '../../utils';
import type { AppConfig, SSHConfig } from '../../types';

interface LoginPromptModalProps {
    /** Подключаемый сервер: имя, адрес и иконка ОС для «пузыря» в окне. */
    server: SSHConfig;
    /** Сервер сохранён в избранном: введённый логин будет сохранён. */
    willSave: boolean;
    appConfig?: AppConfig;
    onSubmit: (user: string) => void;
    onCancel: () => void;
}

/**
 * Запрашивает логин до установки соединения: без него сервер не пустит,
 * поэтому подключение начинается только после ввода.
 */
export const LoginPromptModal: FC<LoginPromptModalProps> = ({
    server,
    willSave,
    appConfig,
    onSubmit,
    onCancel
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const [user, setUser] = useState('');
    const [iconError, setIconError] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const value = user.trim();
        if (!value) return;
        onSubmit(value);
    };

    const osIconUrl = server.osPrettyName ? getOSIcon(server.osPrettyName) : null;
    const serverName = server.name || server.host;
    const address = `SSH ${server.user ? `${server.user}@` : ''}${server.host}:${server.port}`;

    return (
        <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000
        }}>
            <form
                onSubmit={handleSubmit}
                style={{
                    padding: '20px 24px 24px',
                    // Ширина подобрана так, чтобы «Отмена» и «Продолжить и сохранить»
                    // всегда помещались в одну строку; боковые поля сохраняются
                    width: '480px',
                    maxWidth: '90%',
                    boxSizing: 'border-box',
                    color: 'var(--text-primary)',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                }}
            >
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
                    {t('terminal.loginRequired')}
                </h3>

                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'var(--hover-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                }}>
                    {osIconUrl && !iconError ? (
                        <img
                            src={osIconUrl}
                            alt="OS"
                            onError={() => setIconError(true)}
                            style={{ width: '34px', height: '34px', objectFit: 'contain', flexShrink: 0 }}
                            draggable="false"
                        />
                    ) : (
                        <Server size={34} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                        <span style={{
                            fontWeight: 600,
                            fontSize: 'var(--ui-font-size)',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}>
                            {serverName}
                        </span>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {address}
                        </span>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.93rem', color: 'var(--text-primary)' }}>
                        {t('connection.user')}
                    </label>
                    <input
                        autoFocus
                        type="text"
                        value={user}
                        onChange={e => setUser(e.target.value)}
                        placeholder="root"
                        style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={onCancel}
                        style={{ flex: 1, padding: '10px' }}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={user.trim() === ''}
                        style={{
                            flex: 1,
                            padding: '10px',
                            borderRadius: '8px',
                            fontWeight: 600,
                            opacity: user.trim() !== '' ? 1 : 0.5,
                            cursor: user.trim() !== '' ? 'pointer' : 'not-allowed'
                        }}
                    >
                        {willSave ? t('terminal.loginContinueAndSave') : t('terminal.loginContinue')}
                    </button>
                </div>
            </form>
        </div>
    );
};
