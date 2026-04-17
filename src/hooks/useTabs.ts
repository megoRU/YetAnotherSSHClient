import React, { useState, useCallback } from 'react';
import type { Tab, SSHConfig } from '../types';
import { generateId } from '../utils';

export const useTabs = (initialTabs: Tab[]) => {
    const [tabs, setTabs] = useState<Tab[]>(initialTabs);
    const [activeTabId, setActiveTabId] = useState<string>(initialTabs[0]?.id || '0');

    const addTab = useCallback((type: Tab['type'], title: string, sshConfig?: SSHConfig) => {
        if (type === 'home' || type === 'settings' || type === 'about') {
            const existingTab = tabs.find(t => t.type === type);
            if (existingTab) {
                setActiveTabId(existingTab.id);
                return;
            }
        }
        const newId = generateId();
        setTabs(prev => [...prev, { id: newId, type, title, config: sshConfig }]);
        setActiveTabId(newId);
    }, [tabs]);

    const closeTab = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const index = tabs.findIndex(t => t.id === id);
        const newTabs = tabs.filter(t => t.id !== id);

        if (newTabs.length === 0) {
            const homeId = generateId();
            setTabs([{ id: homeId, type: 'home', title: 'Главная' }]);
            setActiveTabId(homeId);
        } else {
            setTabs(newTabs);
            if (activeTabId === id) {
                const nextActiveTab = newTabs[Math.max(0, index - 1)];
                setActiveTabId(nextActiveTab.id);
            }
        }
    }, [tabs, activeTabId]);

    const setTabConfig = useCallback((id: string, config: SSHConfig) => {
        setTabs(prev => prev.map(tab => tab.id === id ? { ...tab, config } : tab));
    }, []);

    const updateTabs = useCallback((updater: (prev: Tab[]) => Tab[]) => {
        setTabs(updater);
    }, []);

    return {
        tabs,
        activeTabId,
        setActiveTabId,
        addTab,
        closeTab,
        setTabConfig,
        setTabs: updateTabs
    };
};
