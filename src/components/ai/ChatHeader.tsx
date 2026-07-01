import React from 'react';
import { X, Bot } from 'lucide-react';
import { useI18n } from '../../utils/i18n';

interface ChatHeaderProps {
    onClose: () => void;
    language: 'ru' | 'en';
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ onClose, language }) => {
    const { t } = useI18n(language);

    return (
        <div className="chat-header">
            <div className="chat-header-title">
                <Bot size={20} className="ai-icon" />
                <span>{t('ai.title')}</span>
            </div>
            <button className="chat-close-btn" onClick={onClose}>
                <X size={18} />
            </button>
        </div>
    );
};
