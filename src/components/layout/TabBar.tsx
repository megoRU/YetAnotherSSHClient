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
            height: '42px',
            display: 'flex',
            userSelect: 'none',
            borderBottom: '1px solid var(--border-color)'
        }}>
            {tabs.map((tab, index) => {
                const isActive = activeTabId === tab.id;
                const isNextActive = index < tabs.length - 1 && tabs[index + 1].id === activeTabId;

                return (
                    <React.Fragment key={tab.id}>
                        <div
                            className={`tab ${isActive ? 'active' : ''}`}
                            onClick={() => setActiveTabId(tab.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                cursor: 'pointer',
                                justifyContent: 'space-between'
                            }}
                            title={tab.title}
                        >
                            <span style={{
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                fontSize: '0.9em'
                            }}>
                                {tab.title}
                            </span>

                            {!(tabs.length === 1 && tab.type === 'home') && (
                                <div className="tab-close-btn" onClick={(e) => closeTab(e, tab.id)} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    flexShrink: 0
                                }}>
                                    <X size={12} strokeWidth={3} />
                                </div>
                            )}
                        </div>
                        {!isActive && !isNextActive && index < tabs.length - 1 && (
                            <div className="tab-divider" />
                        )}
                    </React.Fragment>
                );
            })}
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                <div className="tab-add-btn"
                    onClick={() => addTab('home', 'Главная')}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        cursor: 'pointer'
                    }}>
                    <Plus size={16} />
                </div>
            </div>
        </div>
    );
};
