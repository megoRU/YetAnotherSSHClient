import { useState, type FC } from 'react';
import { Server } from 'lucide-react';
import { getOSIcon } from '../../utils';
import type { SSHConfig } from '../../types';

interface ServerInfoBubbleProps {
    /** Сервер: имя, адрес и иконка ОС. */
    server: SSHConfig;
}

/**
 * «Пузырь» сервера в окнах ввода логина и авторизации: иконка ОС, имя и адрес
 * подключения. Если иконка ОС неизвестна или не загрузилась, показывается иконка сервера.
 */
export const ServerInfoBubble: FC<ServerInfoBubbleProps> = ({ server }) => {
    const [iconError, setIconError] = useState(false);

    const osIconUrl = server.osPrettyName ? getOSIcon(server.osPrettyName) : null;
    const serverName = server.name || server.host;
    const address = `SSH ${server.user ? `${server.user}@` : ''}${server.host}:${server.port}`;

    return (
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
    );
};
