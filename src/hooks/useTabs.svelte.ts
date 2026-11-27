import type { Tab, SSHConfig } from '../types';

import { generateId } from '../utils';

import { type SetStateAction } from '../utils/dom';

export const useTabs = (initialTabs: Tab[]) => {
    let tabs = $state.raw<Tab[]>(initialTabs);
    function setTabs(next: SetStateAction<Tab[]>) {
        tabs = typeof next === 'function' ? next(tabs) : next;
    }
    let activeTabId = $state.raw<string>(initialTabs[0]?.id || '');
    function setActiveTabId(next: SetStateAction<string>) {
        activeTabId = typeof next === 'function' ? next(activeTabId) : next;
    }

    const addTab = (type: Tab['type'], title: string, sshConfig?: SSHConfig, subType?: string) => {
        if (type === 'home' || type === 'settings') {
            const existingTab = tabs.find((t) => t.type === type);
            if (existingTab) {
                setActiveTabId(existingTab.id);
                return;
            }
        }
        const newId = generateId();
        setTabs((prev) => [...prev, { id: newId, type, title, config: sshConfig, subType }]);
        setActiveTabId(newId);
    };

    const closeTab = (e?: MouseEvent | { stopPropagation?: () => void }, id?: string) => {
        if (e && 'stopPropagation' in e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
        }
        const targetId = id || activeTabId;
        if (!targetId) return;

        const index = tabs.findIndex((t) => t.id === targetId);
        if (index === -1) return;

        const newTabs = tabs.filter((t) => t.id !== targetId);

        setTabs(newTabs);
        if (newTabs.length > 0 && activeTabId === targetId) {
            const nextActiveTab = newTabs[Math.max(0, index - 1)];
            setActiveTabId(nextActiveTab.id);
        } else if (newTabs.length === 0) {
            setActiveTabId('');
        }
    };

    const setTabConfig = (id: string, config: SSHConfig) => {
        setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, config } : tab)));
    };

    const updateTabs = (updater: (prev: Tab[]) => Tab[]) => {
        setTabs(updater);
    };

    return {
        get tabs() {
            return tabs;
        },
        get activeTabId() {
            return activeTabId;
        },
        setActiveTabId,
        get addTab() {
            return addTab;
        },
        get closeTab() {
            return closeTab;
        },
        setTabConfig,
        setTabs: updateTabs,
    };
};
