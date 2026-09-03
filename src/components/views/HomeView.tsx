import React, { useMemo, useCallback } from 'react';
import { Server, Plus, Search, MoreHorizontal, Globe, LayoutGrid, LayoutList, Rows } from 'lucide-react';
import type { SSHConfig, AppConfig, Tab } from '../../types';
import { getOSIcon } from '../../utils';
import { useI18n } from '../../utils/i18n';

interface ServerCardProps {
    fav: SSHConfig;
    size: 'standard' | 'compact' | 'medium';
    onClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}

const ServerCard = React.memo<ServerCardProps>(({ fav, size, onClick, onContextMenu }) => {
    const isCompact = size === 'compact';
    const isMedium = size === 'medium';
    const isStandard = size === 'standard';

    return (
        <div
            className={`server-card ${size}`}
            onClick={onClick}
            onContextMenu={onContextMenu}
        >
            <div className={`server-card-icon-container ${size}`}>
                {fav.osPrettyName ? (
                    <img
                        src={getOSIcon(fav.osPrettyName)}
                        style={{ width: '115%', height: '115%', objectFit: 'contain' }}
                        draggable="false"
                        alt={fav.osPrettyName}
                    />
                ) : (
                    <Server size={isCompact ? 16 : (isMedium ? 32 : 42)} style={{ color: 'var(--text-secondary)' }} />
                )}
            </div>

            <div className="server-card-info">
                <div className="text-card-title" style={{
                    marginBottom: isCompact ? '0px' : (isMedium ? '4px' : '8px'),
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontSize: isCompact ? '0.95rem' : '1.14rem',
                    fontWeight: 600,
                    lineHeight: 1.2
                }}>
                    {fav.name || fav.host}
                </div>
                {isCompact ? (
                    <div className="server-card-host-text">
                        {fav.host}
                    </div>
                ) : (
                    <>
                        <div className="server-card-tag-list" style={{ marginBottom: isMedium ? '4px' : '0px' }}>
                            <div className="server-card-tag">SSH</div>
                            <div className="server-card-tag">{fav.user.toUpperCase()}</div>
                        </div>
                        {isMedium && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem', fontFamily: 'var(--mono-font-family), serif' }}>
                                <Globe size={14} />
                                {fav.host}
                            </div>
                        )}
                    </>
                )}
            </div>

            {isStandard && (
                <div className="server-card-meta-container">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Globe size={14} />
                        {fav.host}
                    </div>

                    <button
                        className="card-menu-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onContextMenu(e);
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
                            transition: 'background-color 0.2s, color 0.2s',
                            marginRight: '-4px'
                        }}
                    >
                        <MoreHorizontal size={18} />
                    </button>
                </div>
            )}

            {(isCompact || isMedium) && (
                <button
                    className="card-menu-btn"
                    onClick={(e) => {
                        e.stopPropagation();
                        onContextMenu(e);
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
                        transition: 'background-color 0.2s, color 0.2s',
                        flexShrink: 0,
                        alignSelf: 'center'
                    }}
                >
                    <MoreHorizontal size={18} />
                </button>
            )}
        </div>
    );
});

interface HomeViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    addTab: (type: Tab['type'], title: string, config?: SSHConfig, subType?: string) => void;
    onContextMenu: (e: React.MouseEvent, fav: SSHConfig) => void;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    onOpenSupport?: () => void;
}

export const HomeView: React.FC<HomeViewProps> = React.memo(({ config, setConfig, addTab, onContextMenu, searchQuery, setSearchQuery, onOpenSupport }) => {
    const { t } = useI18n(config.language);

    const handleSetStandard = useCallback(() => setConfig({ ...config, serverCardSize: 'standard' }), [config, setConfig]);
    const handleSetMedium = useCallback(() => setConfig({ ...config, serverCardSize: 'medium' }), [config, setConfig]);
    const handleSetCompact = useCallback(() => setConfig({ ...config, serverCardSize: 'compact' }), [config, setConfig]);
    const handleAddServer = useCallback(() => addTab('connection', t('tabs.connection')), [addTab, t]);

    const isLicensed = !!(config.licenseKey && (!config.licenseExpiresAt || config.licenseExpiresAt > Date.now()));

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
                                onClick={handleSetStandard}
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
                                    transition: 'background-color 0.2s, color 0.2s'
                                }}
                            >
                                <LayoutGrid size={16} />
                            </button>
                            <button
                                onClick={handleSetMedium}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '6px',
                                    background: config.serverCardSize === 'medium' ? 'var(--hover-surface)' : 'transparent',
                                    border: 'none',
                                    color: config.serverCardSize === 'medium' ? 'var(--accent)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'background-color 0.2s, color 0.2s'
                                }}
                            >
                                <LayoutList size={16} />
                            </button>
                            <button
                                onClick={handleSetCompact}
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
                                    transition: 'background-color 0.2s, color 0.2s'
                                }}
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
                                    transition: 'border-color 0.2s, box-shadow 0.2s'
                                }}
                            />
                        </div>

                        <button
                            className="btn-primary"
                            onClick={handleAddServer}
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
                        : config.serverCardSize === 'medium'
                        ? 'repeat(auto-fill, minmax(320px, 1fr))'
                        : 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: config.serverCardSize === 'compact' ? '12px' : (config.serverCardSize === 'medium' ? '16px' : '24px')
                }}>
                    {filteredFavorites.map((fav, i) => (
                        <ServerCard
                            key={fav.id || i}
                            fav={fav}
                            size={config.serverCardSize || 'standard'}
                            onClick={() => addTab('ssh', fav.name || fav.host, fav)}
                            onContextMenu={(e) => onContextMenu(e, fav)}
                        />
                    ))}

                    <div
                        className={`server-card add-card ${config.serverCardSize || 'standard'}`}
                        onClick={handleAddServer}
                        style={{
                            background: 'transparent',
                            borderStyle: 'dashed',
                        }}
                    >
                        <div
                            className="add-icon-circle"
                            style={{
                                width: config.serverCardSize === 'compact' ? '24px' : (config.serverCardSize === 'medium' ? '36px' : '48px'),
                                height: config.serverCardSize === 'compact' ? '24px' : (config.serverCardSize === 'medium' ? '36px' : '48px'),
                                borderRadius: '50%',
                                background: 'var(--hover-surface)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-secondary)',
                                flexShrink: 0
                            }}
                        >
                            <Plus size={config.serverCardSize === 'compact' ? 18 : (config.serverCardSize === 'medium' ? 20 : 24)} />
                        </div>
                        <div className="text-card-title" style={{
                            color: 'var(--text-secondary)',
                            fontSize: config.serverCardSize === 'compact' ? '0.95rem' : '1.14rem'
                        }}>
                            {t('home.addServer')}
                        </div>
                    </div>
                </div>

                {!isLicensed && (
                    <div style={{
                        marginTop: '36px',
                        textAlign: 'center',
                        fontSize: '0.9rem',
                        color: 'var(--text-secondary)',
                        paddingTop: '16px',
                        borderTop: '1px solid var(--border)'
                    }}>
                        {t('home.unlicensedNotice')}
                        <span
                            onClick={onOpenSupport}
                            style={{
                                color: 'var(--accent)',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                fontWeight: 600
                            }}
                        >
                            {t('home.unlicensedBuy')}
                        </span>
                    </div>
                )}
            </div>

        </div>
    );
});
