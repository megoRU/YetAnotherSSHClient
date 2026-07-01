import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useI18n } from '../../utils/i18n';

interface ChatInputProps {
    onSend: (message: string) => void;
    isLoading: boolean;
    language: 'ru' | 'en';
}

export const ChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputProps>(({ onSend, isLoading, language }, ref) => {
    const { t } = useI18n(language);
    const [value, setValue] = useState('');
    const internalRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement | null>) || internalRef;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSend = () => {
        if (value.trim() && !isLoading) {
            onSend(value.trim());
            setValue('');
        }
    };

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
        }
    }, [value]);

    return (
        <div className="chat-input-container">
            <textarea
                ref={textareaRef}
                className="chat-textarea no-scrollbar"
                placeholder={t('ai.placeholder')}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isLoading}
            />
            <button
                className={`chat-send-btn ${!value.trim() || isLoading ? 'disabled' : ''}`}
                onClick={handleSend}
                disabled={!value.trim() || isLoading}
            >
                {isLoading ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            </button>
        </div>
    );
});
