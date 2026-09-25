import { useEffect, useState, type FC, type FormEvent } from 'react';
import { Eye, EyeOff, FileKey, KeyRound, Server } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { getOSIcon } from '../../utils';
import { looksLikePrivateKey } from '../../utils/privateKey';
import type { AppConfig, SSHConfig } from '../../types';
import type { SshAuthChallenge } from '../../ipc/ssh';
import { MAX_AUTH_ATTEMPTS } from '../../ipc/ssh';

const { ipcRenderer } = window;

const stripIpcErrorPrefix = (message: string): string =>
    message.replace(/^Error (?:occurred in handler for|invoking remote method) '[^']+':\s*(?:Error:\s*)?/, '');

type AuthTab = 'password' | 'key';

interface SshAuthModalProps {
    /** Запрос авторизации, пришедший от main-процесса. */
    challenge: SshAuthChallenge;
    /** Подключаемый сервер: имя, адрес и иконка ОС для «пузыря» в окне. */
    server: SSHConfig;
    /** Сервер сохранён в избранном: введённые данные будут сохранены. */
    willSave: boolean;
    /** Данные отправлены, ожидается ответ сервера. */
    isSubmitting: boolean;
    /** Ошибка применения введённых данных (например, не удалось зашифровать ключ). */
    error?: string | null;
    appConfig?: AppConfig;
    /** Ответ на запрос пароля или парольной фразы. */
    onSubmitSecret: (secret: string) => void;
    /** Ответ содержимым приватного ключа (из файла или вставленный). */
    onSubmitKey: (keyContent: string) => void;
    onCancel: () => void;
}

/**
 * Окно ввода данных, которые запрашивает сервер (пароль, код, парольная фраза ключа).
 * Вместо пароля можно сразу передать приватный ключ из файла или вставить его текстом.
 */
export const SshAuthModal: FC<SshAuthModalProps> = ({
    challenge,
    server,
    willSave,
    isSubmitting,
    error,
    appConfig,
    onSubmitSecret,
    onSubmitKey,
    onCancel
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const [tab, setTab] = useState<AuthTab>('password');
    const [secret, setSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [keyDraft, setKeyDraft] = useState('');
    const [keyError, setKeyError] = useState<string | null>(null);
    const [iconError, setIconError] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isSubmitting) {
                e.preventDefault();
                onCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel, isSubmitting]);

    const isPassphrase = challenge.kind === 'passphrase';
    const secretLabel = challenge.prompt
        || (isPassphrase ? t('terminal.authPassphrase') : t('terminal.authPassword'));
    const canSubmit = tab === 'password' ? secret !== '' : looksLikePrivateKey(keyDraft);

    const handleLoadKeyFile = async () => {
        setKeyError(null);
        if (typeof ipcRenderer === 'undefined') {
            setKeyError(t('errors.ipcNotAvailable'));
            return;
        }
        try {
            const content = await ipcRenderer?.loadPrivateKeyFile?.();
            if (content === null || content === undefined) return;
            if (!looksLikePrivateKey(content)) {
                setKeyError(t('errors.invalidPrivateKey'));
                return;
            }
            setKeyDraft(content);
        } catch (err) {
            const message = stripIpcErrorPrefix(err instanceof Error ? err.message : String(err));
            setKeyError(t('errors.readPrivateKeyFailed', { message }));
        }
    };

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isSubmitting || !canSubmit) return;

        if (tab === 'password') {
            onSubmitSecret(secret);
            return;
        }

        if (!looksLikePrivateKey(keyDraft)) {
            setKeyError(t('errors.invalidPrivateKey'));
            return;
        }
        onSubmitKey(keyDraft);
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
                    // Ширина подобрана так, чтобы «Отмена» и «Подключиться и сохранить»
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
                    {t('terminal.authTitle')}
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

                {challenge.instructions && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.4 }}>
                        {challenge.instructions}
                    </div>
                )}

                {error && (
                    <div style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'var(--danger-color, #ef4444)',
                        color: '#fff',
                        fontSize: '0.9rem'
                    }}>
                        {error}
                    </div>
                )}

                {challenge.failed && challenge.attempt > 1 && (
                    <div style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'var(--danger-color, #ef4444)',
                        color: '#fff',
                        fontSize: '0.9rem'
                    }}>
                        {t('terminal.authRetryHint', { n: String(challenge.attempt), max: String(MAX_AUTH_ATTEMPTS) })}
                    </div>
                )}

                <div className="auth-tabs">
                    <button
                        type="button"
                        className={`auth-tab${tab === 'password' ? ' active' : ''}`}
                        onClick={() => setTab('password')}
                    >
                        {isPassphrase ? t('terminal.authPassphraseTab') : t('terminal.authPasswordTab')}
                    </button>
                    <button
                        type="button"
                        className={`auth-tab${tab === 'key' ? ' active' : ''}`}
                        onClick={() => setTab('key')}
                    >
                        <KeyRound size={15} /> {t('terminal.authKeyTab')}
                    </button>
                </div>

                {tab === 'password' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '0.93rem', color: 'var(--text-primary)' }}>
                            {secretLabel}
                        </label>
                        <div style={{ position: 'relative' }}>
                            <input
                                autoFocus
                                type={showSecret ? 'text' : 'password'}
                                value={secret}
                                onChange={e => setSecret(e.target.value)}
                                placeholder="••••••••"
                                style={{ width: '100%', padding: '10px', paddingRight: '40px', boxSizing: 'border-box' }}
                            />
                            <div
                                onClick={() => setShowSecret(!showSecret)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: 0.5
                                }}
                            >
                                {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '0.93rem', color: 'var(--text-primary)' }}>
                            {t('terminal.authPrivateKey')}
                        </label>
                        <textarea
                            autoFocus
                            value={keyDraft}
                            onChange={e => {
                                setKeyDraft(e.target.value);
                                setKeyError(null);
                            }}
                            placeholder={t('terminal.authKeyPlaceholder')}
                            rows={7}
                            spellCheck={false}
                            style={{
                                width: '100%',
                                padding: '10px',
                                boxSizing: 'border-box',
                                fontFamily: 'var(--mono-font-family), monospace',
                                fontSize: '1em',
                                resize: 'vertical'
                            }}
                        />
                        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={handleLoadKeyFile}
                                style={{ padding: '8px 15px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                                <FileKey size={16} /> {t('connection.loadFromFile')}
                            </button>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => {
                                    setKeyDraft('');
                                    setKeyError(null);
                                }}
                                style={{ padding: '8px 15px', borderRadius: '6px' }}
                            >
                                {t('connection.clearKey')}
                            </button>
                        </div>
                        {keyError && (
                            <div style={{ color: 'var(--danger-color, #ef4444)', fontSize: '0.85em', marginTop: '8px' }}>
                                {keyError}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={onCancel}
                        disabled={isSubmitting}
                        style={{ flex: 1, padding: '10px' }}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={!canSubmit || isSubmitting}
                        style={{
                            flex: 1,
                            padding: '10px',
                            borderRadius: '8px',
                            fontWeight: 600,
                            opacity: canSubmit && !isSubmitting ? 1 : 0.5,
                            cursor: canSubmit && !isSubmitting ? 'pointer' : 'not-allowed'
                        }}
                    >
                        {isSubmitting
                            ? t('terminal.connecting')
                            : (willSave ? t('terminal.authConnectAndSave') : t('common.connect'))}
                    </button>
                </div>
            </form>
        </div>
    );
};
