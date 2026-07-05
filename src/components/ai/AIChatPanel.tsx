import React, { useState, useEffect, useRef } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import type { ChatMessage } from '../../types';
import { AiService } from '../../services/AiService';
import { generateId } from '../../utils';
import { useI18n } from '../../utils/i18n';

interface AIChatPanelProps {
    messages: ChatMessage[];
    onMessagesChange: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
    onClose: () => void;
    language: 'ru' | 'en';
    osPrettyName?: string;
    focusTrigger?: number;
    visible?: boolean;
    theme?: string;
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
    messages,
    onMessagesChange,
    onClose,
    language,
    osPrettyName,
    focusTrigger,
    visible,
    theme
}) => {
    const { t } = useI18n(language);
    const [isLoading, setIsLoading] = useState(false);
    const [typingId, setTypingId] = useState<string | null>(null);
    const [typingContent, setTypingContent] = useState('');
    const chatInputRef = useRef<HTMLTextAreaElement>(null);
    const isMounted = useRef(true);

    useEffect(() => {
        return () => {
            isMounted.current = false;
        };
    }, []);

    useEffect(() => {
        // Focus input on mount, when trigger changes, or when becoming visible/not loading
        if (visible && !isLoading) {
            const timer = setTimeout(() => {
                chatInputRef.current?.focus();
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [focusTrigger, visible, isLoading]);

    const handleSendMessage = async (content: string) => {
        const aiMessageId = generateId();

        onMessagesChange(prev => [
            ...prev,
            { id: generateId(), role: 'user', content, timestamp: Date.now() },
            { id: aiMessageId, role: 'assistant', content: '', timestamp: Date.now(), isTyping: true }
        ]);

        setIsLoading(true);
        setTypingId(aiMessageId);
        setTypingContent('');

        const state = {
            full: '',
            displayed: '',
            active: true
        };

        const updateLoop = () => {
            if (!isMounted.current) return;

            let changed = false;
            if (state.displayed.length < state.full.length) {
                const diff = state.full.length - state.displayed.length;
                const charsToAdd = Math.max(1, Math.ceil(diff / 8));
                state.displayed = state.full.substring(0, state.displayed.length + charsToAdd);
                setTypingContent(state.displayed);
                changed = true;
            }

            if (state.active || state.displayed.length < state.full.length) {
                requestAnimationFrame(updateLoop);
            } else {
                onMessagesChange(prev => prev.map(m =>
                    m.id === aiMessageId ? { ...m, content: state.full, isTyping: false } : m
                ));
                setTypingId(null);
                setTypingContent('');
                setIsLoading(false);
            }
        };

        requestAnimationFrame(updateLoop);

        try {
            await AiService.generateStreamingResponse(
                content,
                (chunk) => { state.full += chunk; },
                messages,
                osPrettyName,
                language
            );
        } catch (error) {
            console.error('[AIChatPanel] AI Error:', error);
            onMessagesChange(prev => prev.map(m =>
                m.id === aiMessageId ? { ...m, content: t('ai.error') as string, isTyping: false } : m
            ));
            setTypingId(null);
            setTypingContent('');
            setIsLoading(false);
        } finally {
            state.active = false;
        }
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).catch(err => {
            console.error('[AIChatPanel] Failed to copy text:', err);
        });
    };

    return (
        <div className="ai-chat-panel">
            <ChatHeader onClose={onClose} language={language} />
            <ChatMessages
                messages={messages}
                language={language}
                onCopy={handleCopy}
                theme={theme}
                typingId={typingId}
                typingContent={typingContent}
            />
            <ChatInput
                ref={chatInputRef}
                onSend={handleSendMessage}
                isLoading={isLoading}
                language={language}
            />
        </div>
    );
};
