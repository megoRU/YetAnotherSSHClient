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
    const shouldAutoScrollRef = useRef(true);

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    };

    const handleScroll = () => {
        const container = containerRef.current;
        if (!container) return;

        // User is at bottom if they are within 30px of the absolute bottom
        const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;
        shouldAutoScrollRef.current = isAtBottom;
    };

    useEffect(() => {
        const isLastMessageFromUser = messages.length > 0 && messages[messages.length - 1].role === 'user';

        if (isLastMessageFromUser || shouldAutoScrollRef.current) {
            scrollToBottom(isLastMessageFromUser ? 'smooth' : 'auto');
        }
    }, [messages]);

    return (
        <div className="chat-messages" ref={containerRef} onScroll={handleScroll}>
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
