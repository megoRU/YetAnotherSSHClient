import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import type { ChatMessage } from '../../types';
import { AiService } from '../../services/AiService';
import { generateId } from '../../utils';
import { useI18n } from '../../utils/i18n';

interface AIChatPanelProps {
    messages: ChatMessage[];
    onMessagesChange: (messages: ChatMessage[]) => void;
    onClose: () => void;
    language: 'ru' | 'en';
    osPrettyName?: string;
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
    messages,
    onMessagesChange,
    onClose,
    language,
    osPrettyName
}) => {
    const { t } = useI18n(language);
    const [isLoading, setIsLoading] = useState(false);
    const chatInputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        // Focus input on mount (when panel opens)
        chatInputRef.current?.focus();
    }, []);

    const handleSendMessage = async (content: string) => {
        const userMessage: ChatMessage = {
            id: generateId(),
            role: 'user',
            content,
            timestamp: Date.now()
        };

        const updatedMessages = [...messages, userMessage];
        onMessagesChange(updatedMessages);
        setIsLoading(true);

        // Add a placeholder message for AI
        const aiMessageId = generateId();
        const aiPlaceholder: ChatMessage = {
            id: aiMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isTyping: true
        };

        onMessagesChange([...updatedMessages, aiPlaceholder]);

        try {
            let fullContent = '';
            await AiService.generateStreamingResponse(
                content,
                (chunk) => {
                    fullContent += chunk;
                    onMessagesChange(messages =>
                        messages.map(m => m.id === aiMessageId ? { ...m, content: fullContent, isTyping: true } : m)
                    );
                },
                osPrettyName
            );

            onMessagesChange(messages =>
                messages.map(m => m.id === aiMessageId ? { ...m, content: fullContent, isTyping: false } : m)
            );
        } catch (error) {
            onMessagesChange(messages =>
                messages.map(m => m.id === aiMessageId ? {
                    ...m,
                    content: t('ai.error'),
                    isTyping: false
                } : m)
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="ai-chat-panel">
            <ChatHeader onClose={onClose} language={language} />
            <ChatMessages
                messages={messages}
                language={language}
                onCopy={handleCopy}
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
