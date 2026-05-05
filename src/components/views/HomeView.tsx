import React, { useMemo } from 'react';
import { Server, Plus, Search, MoreHorizontal, Globe, LayoutGrid, Rows } from 'lucide-react';
import type { SSHConfig, AppConfig, Tab } from '../../types';
import { getOSIcon } from '../../utils';
import { useI18n } from '../../utils/i18n';

interface HomeViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    addTab: (type: Tab['type'], title: string, config?: SSHConfig, subType?: string) => void;
    onContextMenu: (e: React.MouseEvent, fav: SSHConfig) => void;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ config, setConfig, addTab, onContextMenu, searchQuery, setSearchQuery }) => {
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
                    </h1>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'flex-end' }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px',
                            background: 'var(--surface)',
                            padding: '2px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            marginRight: '8px',
                            height: '36px',
                            boxSizing: 'border-box'
                        }}>
                            <button
                                onClick={() => setConfig({ ...config, serverCardSize: 'standard' })}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '6px',
                                    background: config.serverCardSize === 'standard' ? 'var(--hover-surface)' : 'transparent',
                                    border: 'none',
                                    color: config.serverCardSize === 'standard' ? 'var(--accent)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                title={t('settings.serverCardSizeStandard')}
                            >
                                <LayoutGrid size={16} />
                            </button>
                            <button
                                onClick={() => setConfig({ ...config, serverCardSize: 'compact' })}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '6px',
                                    background: config.serverCardSize === 'compact' ? 'var(--hover-surface)' : 'transparent',
                                    border: 'none',
                                    color: config.serverCardSize === 'compact' ? 'var(--accent)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                title={t('settings.serverCardSizeCompact')}
                            >
                                <Rows size={16} />
                            </button>
                        </div>

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
                                    fontSize: '1rem',
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
                                fontSize: '1rem',
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
                    gridTemplateColumns: config.serverCardSize === 'compact'
                        ? 'repeat(auto-fill, minmax(240px, 1fr))'
                        : 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: config.serverCardSize === 'compact' ? '12px' : '24px'
                }}>
                    {filteredFavorites.map((fav, i) => (
                        <div
                            key={fav.id || i}
                            className="server-card"
                            onClick={() => addTab('ssh', fav.name || fav.host, fav)}
                            onContextMenu={(e) => onContextMenu(e, fav)}
                            style={{
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: config.serverCardSize === 'compact' ? '8px' : '16px',
                                padding: config.serverCardSize === 'compact' ? '8px 12px' : '24px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                display: 'flex',
                                flexDirection: config.serverCardSize === 'compact' ? 'row' : 'column',
                                alignItems: config.serverCardSize === 'compact' ? 'center' : 'flex-start',
                                justifyContent: 'flex-start',
                                gap: config.serverCardSize === 'compact' ? '18px' : '16px',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                minHeight: config.serverCardSize === 'compact' ? '48px' : '200px'
                            }}
                        >
                            <div style={{
                                width: config.serverCardSize === 'compact' ? '24px' : '56px',
                                height: config.serverCardSize === 'compact' ? '24px' : '56px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                {fav.osPrettyName ? (
                                    <img src={getOSIcon(fav.osPrettyName)}
                                        style={{
                                            width: '115%',
                                            height: '115%',
                                            objectFit: 'contain'
                                        }} alt="OS Icon" draggable="false" />
                                ) : (
                                    <Server size={config.serverCardSize === 'compact' ? 16 : 42} style={{ color: 'var(--text-secondary)' }} />
                                )}
                            </div>

                            <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                                <div className="text-card-title" style={{
                                    marginBottom: config.serverCardSize === 'compact' ? '0px' : '8px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    fontSize: config.serverCardSize === 'compact' ? '0.95rem' : '1.14rem',
                                    fontWeight: 600,
                                    lineHeight: 1.2
                                }}>
                                    {fav.name || fav.host}
                                </div>
                                {config.serverCardSize === 'compact' ? (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 0px 0px 0px',
                                        color: 'var(--text-secondary)',
                                        fontSize: '0.8rem',
                                        fontFamily: 'var(--mono-font-family)',
                                        opacity: 0.7,
                                        lineHeight: 1
                                    }}>
                                        {fav.host}
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start' }}>
                                        <div style={{
                                            fontSize: '0.78rem',
                                            color: 'var(--text-secondary)',
                                            fontWeight: 600,
                                            padding: '2px 8px',
                                            background: 'var(--hover-surface)',
                                            borderRadius: '4px'
                                        }}>SSH</div>
                                        <div style={{
                                            fontSize: '0.78rem',
                                            color: 'var(--text-secondary)',
                                            fontWeight: 600,
                                            padding: '2px 8px',
                                            background: 'var(--hover-surface)',
                                            borderRadius: '4px'
                                        }}>{fav.user.toUpperCase()}</div>
                                    </div>
                                )}
                            </div>

                            {config.serverCardSize !== 'compact' && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    color: 'var(--text-secondary)',
                                    fontSize: '0.93rem',
                                    fontFamily: 'var(--mono-font-family)',
                                    width: '100%',
                                    justifyContent: 'space-between'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Globe size={14} />
                                        {fav.host}
                                    </div>

                                    <button
                                        className="card-menu-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onContextMenu(e, fav);
                                        }}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: '4px',
                                            borderRadius: '6px',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            transition: 'all 0.2s',
                                            marginRight: '-4px'
                                        }}
                                    >
                                        <MoreHorizontal size={18} />
                                    </button>
                                </div>
                            )}

                            {config.serverCardSize === 'compact' && (
                                <button
                                    className="card-menu-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onContextMenu(e, fav);
                                    }}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        padding: '8px',
                                        borderRadius: '6px',
                                        color: 'var(--text-secondary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s',
                                        flexShrink: 0
                                    }}
                                >
                                    <MoreHorizontal size={18} />
                                </button>
                            )}
                        </div>
                    ))}

                    <div
                        className="server-card add-card"
                        onClick={() => addTab('connection', t('tabs.connection'))}
                        style={{
                            background: 'transparent',
                            border: '1px dashed var(--border)',
                            borderRadius: config.serverCardSize === 'compact' ? '8px' : '16px',
                            padding: config.serverCardSize === 'compact' ? '8px 12px' : '24px',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: config.serverCardSize === 'compact' ? 'row' : 'column',
                            alignItems: 'center',
                            justifyContent: config.serverCardSize === 'compact' ? 'flex-start' : 'center',
                            gap: config.serverCardSize === 'compact' ? '18px' : '12px',
                            transition: 'all 0.2s ease',
                            minHeight: config.serverCardSize === 'compact' ? '48px' : '200px'
                        }}
                    >
                        <div style={{
                            width: config.serverCardSize === 'compact' ? '24px' : '48px',
                            height: config.serverCardSize === 'compact' ? '24px' : '48px',
                            borderRadius: '50%',
                            background: 'var(--hover-surface)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-secondary)',
                            flexShrink: 0
                        }}>
                            <Plus size={config.serverCardSize === 'compact' ? 18 : 24} />
                        </div>
                        <div className="text-card-title" style={{
                            color: 'var(--text-secondary)',
                            fontSize: config.serverCardSize === 'compact' ? '0.95rem' : '1.14rem'
                        }}>
                            {t('home.addServer')}
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .server-card:hover {
                    border-color: var(--accent) !important;
                }
                .server-card .card-menu-btn {
                    opacity: 0;
                }
                .server-card:hover .card-menu-btn {
                    opacity: 1;
                }
                .card-menu-btn:hover {
                    background: var(--hover-surface) !important;
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
