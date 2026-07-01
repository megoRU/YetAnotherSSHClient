import React, { useState } from 'react';
import { X, Info } from 'lucide-react';
import { useI18n } from '../../utils/i18n';

interface ChatHeaderProps {
    onClose: () => void;
    language: 'ru' | 'en';
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ onClose, language }) => {
    const { t, tArray } = useI18n(language);
    const [showRules, setShowRules] = useState(false);

    const rules = tArray('ai.rules');

    return (
        <>
            <div className="chat-header">
                <div className="chat-header-title">
                    <span className="ai-emoji">🤖</span>
                    <span>{t('ai.title')}</span>
                    <button
                        className="info-btn"
                        onClick={() => setShowRules(true)}
                    >
                        <Info size={16} />
                    </button>
                </div>
                <button className="chat-close-btn" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>

            {showRules && (
                <div className="rules-overlay" onClick={() => setShowRules(false)}>
                    <div className="rules-modal" onClick={e => e.stopPropagation()}>
                        <div className="rules-header">
                            <h3>{t('ai.rulesTitle')}</h3>
                            <button onClick={() => setShowRules(false)}><X size={18} /></button>
                        </div>
                        <div className="rules-content">
                            <ul>
                                {rules.map((rule, index) => (
                                    <li key={index}>
                                        {rule.includes('**') ? (
                                            rule.split('**').map((part, i) => i % 2 === 1 ? <b key={i}>{part}</b> : part)
                                        ) : rule}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
