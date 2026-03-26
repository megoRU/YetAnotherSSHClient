import React from 'react';
import { Plus, X } from 'lucide-react';
import type { Tab } from '../../types';

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    setActiveTabId: (id: string) => void;
    addTab: (type: Tab['type'], title: string) => void;
    closeTab: (e: React.MouseEvent, id: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
    tabs,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab
}) => {
    return (
        <div className="tab-bar" style={{
            height: '35px',
            display: 'flex',
            background: 'rgba(0,0,0,0.05)',
            borderBottom: '1px solid var(--border-color)',
            userSelect: 'none'
        }}>
            {tabs.map(tab => (
                <div
                    key={tab.id}
                    className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTabId(tab.id)}
                    style={{
                        padding: '0 15px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        borderRight: '1px solid var(--border-color)',
                        background: activeTabId === tab.id ? 'var(--bg-color)' : 'transparent',
                    }}
                >
                    {tab.title}
                    {!(tabs.length === 1 && tab.type === 'home') && (
                        <div className="tab-close-btn" onClick={(e) => closeTab(e, tab.id)} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            transition: 'background-color 0.2s'
                        }}>
                            <X size={12} />
                        </div>
                    )}
                </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 5px' }}>
                <div className="tab-add-btn"
                    onClick={() => addTab('home', 'Главная')}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                    }}>
                    <Plus size={14} />
                </div>
            </div>
        </div>
    );
};
