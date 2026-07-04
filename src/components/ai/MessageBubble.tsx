import React from 'react';
import {Check, Copy, User} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type {ChatMessage} from "../../types.ts";
import {useI18n} from "../../utils/i18n.ts";

interface MessageBubbleProps {
    message: ChatMessage;
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
}

export const MessageBubble = React.memo(function MessageBubble({message, language, onCopy,}: MessageBubbleProps) {
    const {t} = useI18n(language);
    const [messageCopied, setMessageCopied] = React.useState(false);
    const isUser = message.role === 'user';
    const time = new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

    const handleCopyMessage = () => {
        onCopy(message.content);
        setMessageCopied(true);
        setTimeout(() => setMessageCopied(false), 2000);
    };

    return (
        <div className={`message-wrapper ${isUser ? 'user' : 'ai'}`}>
            <div className="message-avatar">
                {isUser ? <User size={14}/> : <span style={{fontSize: '14px'}}>🤖</span>}
            </div>
            <div className="message-container">
                <div className="message-bubble">
                    <div className="message-content">
                        <div className="text-content">

                            <ReactMarkdown>{message.content}</ReactMarkdown>

                            {message.isTyping && (
                                <span className="typing-indicator-inline">
                                    <span className="dot">.</span><span className="dot">.</span><span
                                    className="dot">.</span>
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="message-footer">
                        <span className="message-time">{time}</span>
                    </div>
                </div>
                {!isUser && !message.isTyping && (
                    <div className="message-actions">
                        <button className="action-btn" onClick={handleCopyMessage}>
                            {messageCopied ? <Check size={14}/> : <Copy size={14}/>}
                            <span>{t('ai.copy')}</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});
