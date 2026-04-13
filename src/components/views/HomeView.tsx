import React from 'react';
import { Server, Plus } from 'lucide-react';
import type { SSHConfig, AppConfig, Tab } from '../../types';
import { getOSIcon } from '../../utils';

interface HomeViewProps {
    config: AppConfig;
    addTab: (type: Tab['type'], title: string, config?: SSHConfig) => void;
    onContextMenu: (e: React.MouseEvent, fav: SSHConfig) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ config, addTab, onContextMenu }) => {
    return (
        <div style={{ padding: '60px 40px', textAlign: 'center', userSelect: 'none' }}>
            <h2 style={{ marginBottom: '30px', userSelect: 'none' }}>
                {config.favorites.length === 1 ? 'Сервер' : 'Сервера'}
            </h2>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 270px))',
                gap: '20px',
                justifyContent: 'center',
                maxWidth: '1200px',
                margin: '0 auto'
            }}>
                {config.favorites.map((fav, i) => (
                    <div
                        key={fav.id || i}
                        className="server-list-item"
                        onClick={() => addTab('ssh', fav.name, fav)}
                        onContextMenu={(e) => onContextMenu(e, fav)}
                        style={{
                            height: '220px',
                            padding: '20px',
                            borderRadius: '15px',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '15px',
                            boxSizing: 'border-box',
                            transition: 'background-color 0.2s',
                            border: '1px solid var(--border-color)'
                        }}
                    >
                        <div style={{
                            width: '90px',
                            height: '90px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            {fav.osPrettyName ? (
                                <img src={getOSIcon(fav.osPrettyName)}
                                    style={{
                                        width: '72px',
                                        height: '72px',
                                        objectFit: 'contain'
                                    }} alt="OS Icon" />
                            ) : (
                                <Server size={72} style={{ opacity: 0.7 }} />
                            )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '1.15em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                                {fav.name || fav.host}
                            </div>
                            <div style={{ opacity: 0.6, fontSize: '0.95em' }}>
                                ssh, {fav.user}
                            </div>
                        </div>
                    </div>
                ))}
                <div
                    className="server-list-item"
                    onClick={() => addTab('connection', 'Подключение')}
                    style={{
                        height: '220px',
                        padding: '20px',
                        borderRadius: '15px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '15px',
                        boxSizing: 'border-box',
                        transition: 'background-color 0.2s',
                        border: '1px dashed var(--border-color)',
                        opacity: 0.8
                    }}
                >
                    <div style={{
                        width: '90px',
                        height: '90px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        background: 'rgba(0,0,0,0.05)'
                    }}>
                        <Plus size={56} style={{ opacity: 0.5 }} />
                    </div>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1em' }}>
                        Добавить сервер
                    </div>
                </div>
            </div>
        </div>
    );
};
