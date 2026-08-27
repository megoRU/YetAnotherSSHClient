import React from 'react';

interface ShortcutsSectionProps {
    shortcuts: { label: string; key: string }[];
    t: (key: string, options?: Record<string, string>) => string;
}

export const ShortcutsSection: React.FC<ShortcutsSectionProps> = React.memo(({
    shortcuts,
    t
}) => {
    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('settings.shortcuts')}</h2>
                <div className="settings-section-subtitle">{t('settings.shortcutsSubtitle')}</div>
            </div>

            <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-color)', margin: 0 }}>
                    {t('settings.terminalShortcutsHeading')}
                </h3>
            </div>

            <div className="shortcuts-list">
                {shortcuts.map((s, i) => (
                    <div key={i} className="settings-row">
                        <div className="settings-label-container">
                            <label>{s.label}</label>
                        </div>
                        <span className="shortcut-key">{s.key}</span>
                    </div>
                ))}
            </div>
        </div>
    );
});
