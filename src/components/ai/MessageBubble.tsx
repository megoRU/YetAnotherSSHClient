import React from 'react';
import { Copy, User, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage } from '../../types';
import { useI18n } from '../../utils/i18n';

interface MessageBubbleProps {
    message: ChatMessage;
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, language, onCopy }) => {
    const { t } = useI18n(language);
    const [copied, setCopied] = React.useState(false);
    const isUser = message.role === 'user';
    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const handleCopy = (text: string) => {
        onCopy(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={`message-wrapper ${isUser ? 'user' : 'ai'}`}>
            <div className="message-avatar">
                {isUser ? <User size={14} /> : <span style={{fontSize: '14px'}}>🤖</span>}
            </div>
            <div className="message-container">
                <div className="message-bubble">
                    <div className="message-content">
                        <div className="text-content">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code({ inline, className, children, ...props }) {
                                        const match = /language-(\w+)/.exec(className || '');
                                        const codeString = String(children).replace(/\n$/, '');

                                        return !inline ? (
                                            <div className="code-block-container">
                                                <div className="code-block-header">
                                                    <span>{match ? match[1] : 'code'}</span>
                                                    <button
                                                        className="code-copy-btn"
                                                        onClick={() => handleCopy(codeString)}
                                                    >
                                                        {copied ? <Check size={14} /> : <Copy size={14} />}
                                                    </button>
                                                </div>
                                                <SyntaxHighlighter
                                                    style={vscDarkPlus as Record<string, { [key: string]: React.CSSProperties }>}
                                                    language={match ? match[1] : 'text'}
                                                    PreTag="div"
                                                    {...(props as Record<string, unknown>)}
                                                >
                                                    {codeString}
                                                </SyntaxHighlighter>
                                            </div>
                                        ) : (
                                            <code className={className} {...props}>
                                                {children}
                                            </code>
                                        );
                                    }
                                }}
                            >
                                {message.content}
                            </ReactMarkdown>
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
                        <button className="action-btn" onClick={() => handleCopy(message.content)} title={t('ai.copy')}>
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            <span>{t('ai.copy')}</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
