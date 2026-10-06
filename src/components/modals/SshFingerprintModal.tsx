import { useEffect, type FC } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { ServerInfoBubble } from './ServerInfoBubble';
import type { AppConfig, SSHConfig } from '../../types';
import type { SshFingerprintChallenge } from '../../ipc';

interface SshFingerprintModalProps {
    /** Отпечаток, который предъявил сервер. */
    challenge: SshFingerprintChallenge;
    /** Подключаемый сервер: имя, адрес и иконка ОС для «пузыря» в окне. */
    server: SSHConfig;
    /**
     * Ответ уже отправлен, ожидается продолжение подключения.
     *
     * Нужен терминалу, где окно остаётся до статуса «соединение
     * установлено». SFTP и проброс портов окно снимают по нажатию и показывают
     * своё обычное состояние подключения, поэтому передают `false`.
     */
    isSubmitting?: boolean;
    /** Не удалось передать подтверждение подключению. */
    error?: string | null;
    appConfig?: AppConfig;
    /** Пользователь подтвердил отпечаток: он сохраняется и подключение продолжается. */
    onAccept: () => void;
    /** Пользователь отклонил отпечаток: подключение отменяется, сохранённое значение не меняется. */
    onReject: () => void;
}

/**
 * Подтверждение отпечатка ключа хоста — окно самого приложения.
 *
 * Показывается, когда сервер предъявил ключ, которого нет в конфиге сервера,
 * либо когда сохранённый отпечаток изменился. Во втором случае это потенциальная
 * атака посредника, поэтому вместо обычного подтверждения выводится
 * предупреждение с обоими значениями: старый отпечаток известен только
 * пользователю, сверить его с сервером может только он.
 *
 * Системные диалоги не используются: окно встроено в webview, как и остальные
 * окна ввода данных.
 */
export const SshFingerprintModal: FC<SshFingerprintModalProps> = ({
    challenge,
    server,
    isSubmitting = false,
    error,
    appConfig,
    onAccept,
    onReject
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    // Смена ключа — единственный случай, когда нужен красный блок: первое
    // подключение подтверждения не требует.
    const changed = !!challenge.previous && challenge.previous !== challenge.fingerprint;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Escape равнозначно отклонению: подключение без явного согласия
            // продолжаться не должно.
            if (e.key === 'Escape' && !isSubmitting) {
                e.preventDefault();
                onReject();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onReject, isSubmitting]);

    return (
        <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000
        }}>
            <div style={{
                padding: '20px 24px 24px',
                // Ширина подобрана под длинный base64 внутри отпечатка: он
                // переносится по словам, а не выходит за границы окна.
                width: '520px',
                maxWidth: '90%',
                boxSizing: 'border-box',
                color: 'var(--text-primary)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
            }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
                    {t('terminal.fingerprintChangedTitle')}
                </h3>

                <ServerInfoBubble server={server} />

                {changed && (
                    <>
                        <div style={{
                            padding: '10px 12px',
                            borderRadius: '10px',
                            background: 'var(--danger-color, #ef4444)',
                            color: '#fff',
                            fontSize: '0.9rem',
                            lineHeight: 1.4
                        }}>
                            {t('terminal.fingerprintChangedWarning')}
                        </div>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.4 }}>
                            {t('terminal.fingerprintChangedDesc')}
                        </p>
                    </>
                )}

                {!changed && !challenge.serverId && (
                    <div style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'var(--hover-surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.9rem',
                        lineHeight: 1.4
                    }}>
                        {t('terminal.fingerprintNotSaved')}
                    </div>
                )}

                {changed && (
                    <FingerprintRow label={t('terminal.fingerprintPrevious')} value={challenge.previous!} />
                )}

                {changed ? (
                    <FingerprintRow
                        label={t('terminal.fingerprintNew')}
                        value={challenge.fingerprint}
                        highlight
                    />
                ) : (
                    <FingerprintConfirmCard
                        title={t('terminal.fingerprintTitle')}
                        fingerprint={challenge.fingerprint}
                    />
                )}

                {error && (
                    <p role="alert" style={{ margin: 0, color: 'var(--danger-color, #ef4444)', fontSize: '0.9rem' }}>
                        {error}
                    </p>
                )}

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={onReject}
                        disabled={isSubmitting}
                        style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                        {t('terminal.fingerprintReject')}
                    </button>
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={onAccept}
                        disabled={isSubmitting}
                        style={{
                            flex: 1,
                            padding: '10px',
                            borderRadius: '8px',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            opacity: isSubmitting ? 0.5 : 1,
                            cursor: isSubmitting ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isSubmitting
                            ? t('terminal.connecting')
                            : t('terminal.fingerprintAccept')}
                    </button>
                </div>
            </div>
        </div>
    );
};

/** Подпись и значение отпечатка; значение переносится по словам. */
const FingerprintRow: FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{label}</span>
        <code style={{
            fontFamily: 'var(--ui-font-family)',
            fontSize: '0.85rem',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'var(--hover-surface)',
            border: highlight ? '1px solid var(--accent)' : '1px solid var(--border)',
            // Отпечаток — длинная строка base64 без пробелов: без переноса он
            // растянул бы окно за пределы экрана.
            wordBreak: 'break-all',
            userSelect: 'text'
        }}>
            {value}
        </code>
    </div>
);

/**
 * Карточка подтверждения отпечатка при первом подключении: заметный блок
 * с заголовком «Подтвердите отпечаток ключа сервера» и самим отпечатком.
 */
const FingerprintConfirmCard: FC<{ title: string; fingerprint: string }> = ({ title, fingerprint }) => (
    <div style={{
        borderRadius: '10px',
        overflow: 'hidden'
    }}>
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            background: 'var(--hover-surface)',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: '0.95rem',
            fontWeight: 600,
            lineHeight: 1.3
        }}>
            <ShieldCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            {title}
        </div>
        <code style={{
            display: 'block',
            fontFamily: 'var(--ui-font-family)',
            fontSize: '0.90rem',
            padding: '10px 12px',
            background: 'var(--hover-surface)',
            // Отпечаток — длинная строка base64 без пробелов: без переноса он
            // растянул бы окно за пределы экрана.
            wordBreak: 'break-all',
            userSelect: 'text'
        }}>
            {fingerprint}
        </code>
    </div>
);
