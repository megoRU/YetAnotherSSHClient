import React, { useMemo } from 'react';
import { Server, Plus, Search, MoreVertical } from 'lucide-react';
import type { SSHConfig, AppConfig, Tab } from '../../types';
import { getOSIcon } from '../../utils';
import { useI18n } from '../../utils/i18n';

interface HomeViewProps {
    config: AppConfig;
    addTab: (type: Tab['type'], title: string, config?: SSHConfig, subType?: string) => void;
    onContextMenu: (e: React.MouseEvent, fav: SSHConfig) => void;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ config, addTab, onContextMenu, searchQuery, setSearchQuery }) => {
    const { t } = useI18n(config.language);

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
        <div style={{
            padding: '40px',
            height: '100%',
            overflowY: 'auto',
            background: 'var(--background)',
            userSelect: 'none'
        }}>
            <div style={{
                maxWidth: '1200px',
                margin: '0 auto'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '32px',
                    gap: '20px'
                }}>
                    <h1 className="text-title" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                        {filteredFavorites.length === 1 ? t('home.server') : t('home.servers')}
                        <span style={{ opacity: 0.5, fontWeight: 400, fontSize: '14px' }}>
                            {filteredFavorites.length}
                        </span>
                    </h1>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'flex-end' }}>
                        <div style={{
                            position: 'relative',
                            width: '100%',
                            maxWidth: '300px'
                        }}>
                            <Search size={16} style={{
                                position: 'absolute',
                                left: '12px',
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
                                    height: '36px',
                                    padding: '0 12px 0 36px',
                                    borderRadius: '8px',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-primary)',
                                    fontSize: '14px',
                                    fontWeight: 400,
                                    outline: 'none',
                                    transition: 'all 0.2s'
                                }}
                            />
                        </div>

                        <button
                            className="btn-primary"
                            onClick={() => addTab('connection', t('tabs.connection'))}
                            style={{
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '0 16px',
                                fontSize: '14px',
                                borderRadius: '8px',
                                flexShrink: 0
                            }}
                        >
                            <Plus size={18} />
                            {t('home.addServer')}
                        </button>
                    </div>
                </div>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '24px'
                }}>
                    {filteredFavorites.map((fav, i) => (
                        <div
                            key={fav.id || i}
                            className="server-card"
                            onClick={() => addTab('ssh', fav.name, fav)}
                            onContextMenu={(e) => onContextMenu(e, fav)}
                            style={{
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: '16px',
                                padding: '20px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '16px',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '10px',
                                    background: 'var(--hover-surface)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '8px'
                                }}>
                                    {fav.osPrettyName ? (
                                        <img src={getOSIcon(fav.osPrettyName)}
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'contain'
                                            }} alt="OS Icon" />
                                    ) : (
                                        <Server size={20} style={{ color: 'var(--text-secondary)' }} />
                                    )}
                                </div>
                            </div>

                            <div>
                                <div className="text-card-title" style={{
                                    marginBottom: '4px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                    {fav.name || fav.host}
                                </div>
                                <div className="text-meta" style={{ fontFamily: 'var(--mono-font-family)' }}>
                                    {fav.user}@{fav.host}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    background: 'var(--hover-surface)',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    color: 'var(--text-secondary)',
                                    fontWeight: 600
                                }}>
                                    SSH
                                </div>
                                {fav.user === 'root' && (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 8px',
                                        background: 'var(--hover-surface)',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        color: 'var(--text-secondary)',
                                        fontWeight: 600
                                    }}>
                                        ROOT
                                    </div>
                                )}
                            </div>

                            <button
                                className="card-menu-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onContextMenu(e, fav);
                                }}
                                style={{
                                    position: 'absolute',
                                    bottom: '16px',
                                    right: '16px',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '4px',
                                    borderRadius: '6px',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <MoreVertical size={18} />
                            </button>
                        </div>
                    ))}

                    <div
                        className="server-card add-card"
                        onClick={() => addTab('connection', t('tabs.connection'))}
                        style={{
                            background: 'transparent',
                            border: '1px dashed var(--border)',
                            borderRadius: '16px',
                            padding: '20px',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '12px',
                            minHeight: '180px',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            background: 'var(--hover-surface)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-secondary)'
                        }}>
                            <Plus size={24} />
                        </div>
                        <div className="text-card-title" style={{ color: 'var(--text-secondary)' }}>
                            {t('home.addServer')}
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .server-card:hover {
                    border-color: var(--accent) !important;
                    background: var(--hover-surface) !important;
                }
                .card-menu-btn:hover {
                    background: var(--border) !important;
                    color: var(--text-primary) !important;
                }
                .add-card:hover {
                    background: var(--hover-surface) !important;
                    border-color: var(--accent) !important;
                }
                .add-card:hover svg {
                    color: var(--accent);
                }
            `}</style>
        </div>
    );
};
