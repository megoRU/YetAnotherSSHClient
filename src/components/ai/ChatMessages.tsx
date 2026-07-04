import React, { useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../../types';
import { MessageBubble } from './MessageBubble';

interface ChatMessagesProps {
    messages: ChatMessage[];
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
                                                              messages,
                                                              language,
                                                              onCopy,
                                                          }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const shouldAutoScrollRef = useRef(true);
    const rafRef = useRef<number | null>(null);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            const container = containerRef.current;
            if (!container) return;

            if (behavior === 'smooth') {
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth',
                });
            } else {
                container.scrollTop = container.scrollHeight;
            }
        });
    }, []);

    const handleScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        shouldAutoScrollRef.current =
            container.scrollHeight - container.scrollTop - container.clientHeight < 30;
    }, []);

    useEffect(() => {
        const isLastMessageFromUser =
            messages.length > 0 &&
            messages[messages.length - 1].role === 'user';

        if (isLastMessageFromUser || shouldAutoScrollRef.current) {
            scrollToBottom(isLastMessageFromUser ? 'smooth' : 'auto');
        }
    }, [messages, scrollToBottom]);

    useEffect(() => {
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="chat-messages"
            onScroll={handleScroll}
        >
            {messages.map((msg) => (
                <MessageBubble
                    key={msg.id}
                    message={msg}
                    language={language}
                    onCopy={onCopy}
                />
            ))}
        </div>
    );
};