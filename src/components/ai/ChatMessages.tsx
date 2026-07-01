import React, { useRef, useEffect } from 'react';
import type { ChatMessage } from '../../types';
import { MessageBubble } from './MessageBubble';

interface ChatMessagesProps {
    messages: ChatMessage[];
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
    onInsert: (text: string) => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({ messages, language, onCopy, onInsert }) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    return (
        <div className="chat-messages no-scrollbar">
            {messages.map((msg) => (
                <MessageBubble
                    key={msg.id}
                    message={msg}
                    language={language}
                    onCopy={onCopy}
                    onInsert={onInsert}
                />
            ))}
            <div ref={messagesEndRef} />
        </div>
    );
};
