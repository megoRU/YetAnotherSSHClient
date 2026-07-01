import React, { useState, useCallback, useMemo } from 'react';
import type { Tab, SSHConfig } from '../types';
import { generateId } from '../utils';

export const useTabs = (initialTabs: Tab[]) => {
    const [tabs, setTabs] = useState<Tab[]>(initialTabs);
    const [activeTabId, setActiveTabId] = useState<string>(initialTabs[0]?.id || '');

    const addTab = useCallback((type: Tab['type'], title: string, sshConfig?: SSHConfig, subType?: string) => {
        if (type === 'home' || type === 'settings') {
            const existingTab = tabs.find(t => t.type === type);
            if (existingTab) {
                setActiveTabId(existingTab.id);
                return;
            }
        }
        const newId = generateId();
        setTabs(prev => [...prev, { id: newId, type, title, config: sshConfig, subType }]);
        setActiveTabId(newId);
    }, [tabs]);

    const closeTab = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const index = tabs.findIndex(t => t.id === id);
        const newTabs = tabs.filter(t => t.id !== id);

        setTabs(newTabs);
        if (newTabs.length > 0 && activeTabId === id) {
            const nextActiveTab = newTabs[Math.max(0, index - 1)];
            setActiveTabId(nextActiveTab.id);
        } else if (newTabs.length === 0) {
            setActiveTabId('');
        }
    }, [tabs, activeTabId]);

    const setTabConfig = useCallback((id: string, config: SSHConfig) => {
        setTabs(prev => prev.map(tab => tab.id === id ? { ...tab, config } : tab));
    }, []);

    const updateTabs = useCallback((updater: (prev: Tab[]) => Tab[]) => {
        setTabs(updater);
    }, []);

    const toggleAi = useCallback((id: string) => {
        setTabs(prev => prev.map(tab => {
            if (tab.id === id) {
                return { ...tab, aiOpen: !tab.aiOpen };
            }
            return tab;
        }));
    }, []);

    const openAi = useCallback((id: string) => {
        setTabs(prev => prev.map(tab => {
            if (tab.id === id) {
                return { ...tab, aiOpen: true };
            }
            return tab;
        }));
    }, []);

    const setAiMessages = useCallback((id: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        setTabs(prev => prev.map(tab => {
            if (tab.id === id) {
                const newMessages = typeof messages === 'function' ? messages(tab.aiMessages || []) : messages;
                return { ...tab, aiMessages: newMessages };
            }
            return tab;
        }));
    }, []);

    return useMemo(() => ({
        tabs,
        activeTabId,
        setActiveTabId,
        addTab,
        closeTab,
        setTabConfig,
        toggleAi,
        openAi,
        setAiMessages,
        setTabs: updateTabs
    }), [tabs, activeTabId, addTab, closeTab, setTabConfig, toggleAi, openAi, setAiMessages, updateTabs]);
};
