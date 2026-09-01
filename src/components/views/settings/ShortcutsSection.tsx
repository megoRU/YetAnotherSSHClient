import React from 'react';
import { AppWindow, Terminal } from 'lucide-react';

interface ShortcutItem {
    label: string;
    key: string;
}

interface ShortcutsSectionProps {
    appShortcuts: ShortcutItem[];
    terminalShortcuts: ShortcutItem[];
    t: (key: string, options?: Record<string, string>) => string;
}

export const ShortcutsSection: React.FC<ShortcutsSectionProps> = React.memo(({
    appShortcuts,
    terminalShortcuts,
    t
}) => {
    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('settings.shortcuts')}</h2>
                <div className="settings-section-subtitle">{t('settings.shortcutsSubtitle')}</div>
            </div>

            {/* Группа: Программа */}
            <div style={{ marginTop: '20px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AppWindow size={18} style={{ color: 'var(--accent)' }} />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    {t('settings.appShortcutsHeading')}
                </h3>
            </div>

            <div className="shortcuts-list" style={{ marginBottom: '24px' }}>
                {appShortcuts.map((s, i) => (
                    <div key={i} className="settings-row">
                        <div className="settings-label-container">
                            <label style={{ cursor: 'default' }}>{s.label}</label>
                        </div>
                        <span className="shortcut-key">{s.key}</span>
                    </div>
                ))}
            </div>

            {/* Группа: Терминал */}
            <div style={{ marginTop: '20px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={18} style={{ color: 'var(--accent)' }} />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    {t('settings.terminalShortcutsHeading')}
                </h3>
            </div>

            <div className="shortcuts-list">
                {terminalShortcuts.map((s, i) => (
                    <div key={i} className="settings-row">
                        <div className="settings-label-container">
                            <label style={{ cursor: 'default' }}>{s.label}</label>
                        </div>
                        <span className="shortcut-key">{s.key}</span>
                    </div>
                ))}
            </div>
        </div>
    );
});
