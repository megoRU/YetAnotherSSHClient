import React, { useRef, useEffect } from 'react';
import type { ChatMessage } from '../../types';
import { MessageBubble } from './MessageBubble';

interface ChatMessagesProps {
    messages: ChatMessage[];
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({ messages, language, onCopy }) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const isLastMessageFromUser = messages.length > 0 && messages[messages.length - 1].role === 'user';

        // Check if user is near bottom (within 150px)
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;

        if (isLastMessageFromUser || isNearBottom) {
            scrollToBottom(isLastMessageFromUser ? 'smooth' : 'auto');
        }
    }, [messages]);

    return (
        <div className="chat-messages" ref={containerRef}>
            {messages.map((msg) => (
                <MessageBubble
                    key={msg.id}
                    message={msg}
                    language={language}
                    onCopy={onCopy}
                />
            ))}
            <div ref={messagesEndRef} />
        </div>
    );
};
