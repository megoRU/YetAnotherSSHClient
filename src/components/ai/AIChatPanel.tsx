import React, { useState, useEffect, useCallback } from 'react';
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
    onInsertToTerminal: (text: string) => void;
    language: 'ru' | 'en';
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
    messages,
    onMessagesChange,
    onClose,
    onInsertToTerminal,
    language
}) => {
    const { t } = useI18n(language);
    const [isLoading, setIsLoading] = useState(false);

    const simulateTyping = useCallback(async (fullText: string, messageId: string) => {
        let displayedText = '';
        const chunkSize = 5; // Characters per step
        const delay = 15;    // Milliseconds per step

        for (let i = 0; i < fullText.length; i += chunkSize) {
            displayedText = fullText.substring(0, i + chunkSize);
            onMessagesChange(messages =>
                messages.map(m => m.id === messageId ? { ...m, content: displayedText, isTyping: true } : m)
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Ensure final text is set exactly and isTyping is false
        onMessagesChange(messages =>
            messages.map(m => m.id === messageId ? { ...m, content: fullText, isTyping: false } : m)
        );
    }, [onMessagesChange]);

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
            const response = await AiService.generateResponse(content);
            await simulateTyping(response, aiMessageId);
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
                onInsert={onInsertToTerminal}
            />
            <ChatInput onSend={handleSendMessage} isLoading={isLoading} language={language} />
        </div>
    );
};
