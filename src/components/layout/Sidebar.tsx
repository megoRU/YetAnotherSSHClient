import React, { useMemo, useState } from 'react';
import { Search, Server } from 'lucide-react';
import type { SSHConfig, AppConfig, Tab } from '../../types';
import { getOSIcon } from '../../utils';
import { useI18n } from '../../utils/i18n';

interface SidebarProps {
    config: AppConfig;
    addTab: (type: Tab['type'], title: string, config?: SSHConfig, subType?: string) => void;
    onContextMenu: (e: React.MouseEvent, fav: SSHConfig) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ config, addTab, onContextMenu }) => {
    const { t } = useI18n(config.language);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredFavorites = useMemo(() => {
        if (!searchQuery) return config.favorites;
        const query = searchQuery.toLowerCase();
        return config.favorites.filter(fav =>
            (fav.name && fav.name.toLowerCase().includes(query)) ||
            fav.host.toLowerCase().includes(query) ||
            fav.user.toLowerCase().includes(query)
        );
    }, [config.favorites, searchQuery]);

    return (
        <div className="sidebar" style={{
            width: '260px',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            borderRight: config.sidebarPosition === 'left' ? '1px solid var(--border)' : 'none',
            borderLeft: config.sidebarPosition === 'right' ? '1px solid var(--border)' : 'none',
            background: 'var(--background)',
            flexShrink: 0,
            overflow: 'hidden'
        }}>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ position: 'relative' }}>
                    <Search size={14} style={{
                        position: 'absolute',
                        left: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        opacity: 0.5,
                        color: 'var(--text-secondary)'
                    }} />
                    <input
                        type="text"
                        placeholder={t('common.search')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            height: '32px',
                            padding: '0 10px 0 32px',
                            borderRadius: '6px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                            outline: 'none'
                        }}
                    />
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }} className="no-scrollbar">
                {filteredFavorites.map((fav, i) => (
                    <div
                        key={fav.id || i}
                        className="fav-item"
                        onClick={() => addTab('ssh', fav.name || fav.host, fav)}
                        onContextMenu={(e) => onContextMenu(e, fav)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '10px 12px',
                            cursor: 'pointer',
                            userSelect: 'none'
                        }}
                    >
                        <div style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {fav.osPrettyName ? (
                                <img src={getOSIcon(fav.osPrettyName)}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'contain'
                                    }} draggable="false" />
                            ) : (
                                <Server size={16} style={{ color: 'var(--text-secondary)' }} />
                            )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: '0.9rem',
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: 'var(--text-primary)'
                            }}>
                                {fav.name || fav.host}
                            </div>
                            <div style={{
                                fontSize: '0.75rem',
                                color: 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                opacity: 0.7
                            }}>
                                {fav.host}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
