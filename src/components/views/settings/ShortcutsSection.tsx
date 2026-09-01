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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '16px' }}>
                {/* Категория: Программа */}
                <div style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '20px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '16px',
                        paddingBottom: '12px',
                        borderBottom: '1px solid var(--border)'
                    }}>
                        <AppWindow size={20} style={{ color: 'var(--accent)' }} />
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                            {t('settings.appShortcutsHeading')}
                        </h3>
                    </div>

                    <div className="shortcuts-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {appShortcuts.map((s, i) => (
                            <div key={i} className="settings-row" style={{ padding: '8px 12px', borderRadius: '8px', background: 'var(--hover-surface)' }}>
                                <div className="settings-label-container">
                                    <label style={{ cursor: 'default' }}>{s.label}</label>
                                </div>
                                <span className="shortcut-key">{s.key}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Категория: Терминал */}
                <div style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '20px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '16px',
                        paddingBottom: '12px',
                        borderBottom: '1px solid var(--border)'
                    }}>
                        <Terminal size={20} style={{ color: 'var(--accent)' }} />
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                            {t('settings.terminalShortcutsHeading')}
                        </h3>
                    </div>

                    <div className="shortcuts-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {terminalShortcuts.map((s, i) => (
                            <div key={i} className="settings-row" style={{ padding: '8px 12px', borderRadius: '8px', background: 'var(--hover-surface)' }}>
                                <div className="settings-label-container">
                                    <label style={{ cursor: 'default' }}>{s.label}</label>
                                </div>
                                <span className="shortcut-key">{s.key}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
});
