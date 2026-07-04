import React from 'react';
import {Check, Copy, User} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {vscDarkPlus, prism} from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import type {ChatMessage} from "../../types.ts";
import {useI18n} from "../../utils/i18n.ts";
import {useConfig} from "../../hooks/useConfig.ts";

interface CodeBlockProps {
    language: string;
    value: string;
    isTyping?: boolean;
    theme: string;
}

const CodeBlock = React.memo(({language, value, isTyping, theme}: CodeBlockProps) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Fast path for typing to avoid freezes
    if (isTyping) {
        return (
            <div className="code-block-container">
                <div className="code-block-header">
                    <span>{language || 'text'}</span>
                </div>
                <pre><code>{value}</code></pre>
            </div>
        );
    }

    const isDark = theme.toLowerCase().includes('dark') || theme === 'Windows Terminal';

    return (
        <div className="code-block-container">
            <div className="code-block-header">
                <span>{language || 'text'}</span>
                <button className="code-copy-btn" onClick={handleCopy} title="Copy code">
                    {copied ? <Check size={14}/> : <Copy size={14}/>}
                </button>
            </div>
            <SyntaxHighlighter
                language={language || 'text'}
                style={isDark ? vscDarkPlus : prism}
                customStyle={{
                    margin: 0,
                    padding: '12px',
                    fontSize: '13px',
                    background: 'transparent',
                }}
            >
                {value}
            </SyntaxHighlighter>
        </div>
    );
});

interface MessageBubbleProps {
    message: ChatMessage;
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
}

export const MessageBubble = React.memo(function MessageBubble({message, language, onCopy,}: MessageBubbleProps) {
    const {t} = useI18n(language);
    const {resolvedTheme} = useConfig();
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

                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code({node, inline, className, children, ...props}: any) {
                                        const match = /language-(\w+)/.exec(className || '');
                                        return !inline ? (
                                            <CodeBlock
                                                language={match ? match[1] : ''}
                                                value={String(children).replace(/\n$/, '')}
                                                isTyping={message.isTyping}
                                                theme={resolvedTheme}
                                            />
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
