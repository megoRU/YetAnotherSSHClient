import React from 'react';
import { Copy, Terminal, User, Bot } from 'lucide-react';
import type { ChatMessage } from '../../types';
import { useI18n } from '../../utils/i18n';

interface MessageBubbleProps {
    message: ChatMessage;
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
    onInsert: (text: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, language, onCopy, onInsert }) => {
    const { t } = useI18n(language);
    const isUser = message.role === 'user';
    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Simple heuristic to find commands in AI response (lines starting with command-like patterns or backticks)
    const hasCommands = !isUser && (message.content.includes('```') || /^\s*(\$|#|apt|docker|git|ls|cd|mkdir|rm|cp|mv|sudo|npm|yarn|node|python|sh|bash)/m.test(message.content));

    const extractCommands = (content: string) => {
        // Find code blocks or lines that look like commands
        const codeBlockRegex = /```(?:[a-zA-Z]*\n)?([\s\S]*?)```/g;
        let match;
        const commands: string[] = [];

        while ((match = codeBlockRegex.exec(content)) !== null) {
            commands.push(match[1].trim());
        }

        if (commands.length === 0) {
            // Fallback: lines that look like commands
            const lines = content.split('\n');
            const cmdLines = lines.filter(line => /^\s*(\$|#|apt|docker|git|ls|cd|mkdir|rm|cp|mv|sudo|npm|yarn|node|python|sh|bash)/.test(line));
            if (cmdLines.length > 0) {
                commands.push(cmdLines.join('\n').trim());
            }
        }

        return commands.join('\n');
    };

    const commandText = hasCommands ? extractCommands(message.content) : '';

    return (
        <div className={`message-wrapper ${isUser ? 'user' : 'ai'}`}>
            <div className="message-avatar">
                {isUser ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className="message-container">
                <div className="message-bubble">
                    <div className="message-content">
                        <div className="text-content" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {message.content}
                            {message.isTyping && (
                                <span className="typing-indicator-inline">
                                    <span className="dot">.</span><span className="dot">.</span><span className="dot">.</span>
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
                        <button className="action-btn" onClick={() => onCopy(message.content)} title={t('ai.copy')}>
                            <Copy size={14} />
                            <span>{t('ai.copy')}</span>
                        </button>
                        {commandText && (
                            <button className="action-btn" onClick={() => onInsert(commandText)} title={t('ai.insert')}>
                                <Terminal size={14} />
                                <span>{t('ai.insert')}</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
