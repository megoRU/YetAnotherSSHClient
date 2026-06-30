import React from 'react';
import { Keyboard } from 'lucide-react';

interface ShortcutsSectionProps {
    shortcuts: { label: string; key: string }[];
    t: (key: string, options?: Record<string, string>) => string;
}

export const ShortcutsSection: React.FC<ShortcutsSectionProps> = React.memo(({
    shortcuts,
    t
}) => {
    return (
        <div className="settings-group" id="section-shortcuts">
            <div className="settings-group-title">
                <Keyboard size={14} className="settings-group-icon" /> {t('settings.shortcuts')}
            </div>
            <div className="shortcuts-list">
                {shortcuts.map((s, i) => (
                    <div key={i} className="shortcut-item">
                        <span className="shortcut-label">{s.label}</span>
                        <span className="shortcut-key">{s.key}</span>
                    </div>
                ))}
            </div>
        </div>
    );
});
