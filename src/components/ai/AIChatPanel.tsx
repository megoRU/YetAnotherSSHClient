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
        const userMessage: ChatMessage = {
            id: generateId(),
            role: 'user',
            content,
            timestamp: Date.now()
        };

        const updatedMessages = [...messages, userMessage];
        onMessagesChange(updatedMessages);
        setIsLoading(true);

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
            let displayedContent = '';
            let isStreaming = true;

            const updateLoop = () => {
                if (!isMounted.current) return;

                if (displayedContent.length < fullContent.length) {
                    const diff = fullContent.length - displayedContent.length;
                    const charsToAdd = Math.max(1, Math.ceil(diff / 8));
                    displayedContent = fullContent.substring(0, displayedContent.length + charsToAdd);

                    onMessagesChange((prev: ChatMessage[]) => {
                        const next = [...prev];
                        const index = next.findIndex(m => m.id === aiMessageId);
                        if (index !== -1) {
                            next[index] = {
                                ...next[index],
                                content: displayedContent,
                                isTyping: true
                            };
                        }
                        return next;
                    });
                }

                if (isStreaming || displayedContent.length < fullContent.length) {
                    requestAnimationFrame(updateLoop);
                } else {
                    // Final state update
                    onMessagesChange((prev: ChatMessage[]) => {
                        const next = [...prev];
                        const index = next.findIndex(m => m.id === aiMessageId);
                        if (index !== -1) {
                            next[index] = {
                                ...next[index],
                                content: fullContent,
                                isTyping: false
                            };
                        }
                        return next;
                    });
                    setIsLoading(false);
                }
            };

            // Start the typewriter loop
            requestAnimationFrame(updateLoop);

            await AiService.generateStreamingResponse(
                content,
                (chunk) => {
                    fullContent += chunk;
                },
                messages,
                osPrettyName,
                language
            );

            isStreaming = false;
        } catch (error) {
            console.error('[AIChatPanel] Error generating response:', error);
            isStreaming = false;
            onMessagesChange((prev: ChatMessage[]) => {
                const next = [...prev];
                const index = next.findIndex(m => m.id === aiMessageId);
                if (index !== -1) {
                    next[index] = {
                        ...next[index],
                        content: t('ai.error') as string,
                        isTyping: false
                    };
                }
                return next;
            });
            setIsLoading(false);
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
