import React, {useState} from 'react';
import {Check, Copy, User} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {vscDarkPlus, prism} from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import type {ChatMessage} from "../../types.ts";
import {useI18n} from "../../utils/i18n.ts";

interface MessageBubbleProps {
    message: ChatMessage;
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
    theme?: string;
}

interface CodeBlockProps {
    language: string;
    value: string;
    isTyping?: boolean;
    theme?: string;
    onCopy: (text: string) => void;
    t: (key: string) => string;
}

const CodeBlock = React.memo(({language, value, isTyping, theme, onCopy, t}: CodeBlockProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        onCopy(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const isDark = theme !== 'light';
    const syntaxTheme = isDark ? vscDarkPlus : prism;

    return (
        <div className="code-block-container">
            <div className="code-block-header">
                <span className="code-block-lang">{language || 'text'}</span>
                <button className="code-copy-btn" onClick={handleCopy} title={t('ai.copy')}>
                    {copied ? <Check size={14}/> : <Copy size={14}/>}
                </button>
            </div>
            <div className="code-block-content">
                {isTyping ? (
                    <pre><code>{value}</code></pre>
                ) : (
                    <SyntaxHighlighter
                        language={language || 'text'}
                        style={syntaxTheme}
                        PreTag="div"
                        customStyle={{
                            margin: 0,
                            padding: '12px',
                            background: 'transparent',
                            fontSize: 'var(--ui-font-size)',
                        }}
                    >
                        {value}
                    </SyntaxHighlighter>
                )}
            </div>
        </div>
    );
});

export const MessageBubble = React.memo(function MessageBubble({message, language, onCopy, theme}: MessageBubbleProps) {
    const {t} = useI18n(language);
    const [messageCopied, setMessageCopied] = React.useState(false);
    const isUser = message.role === 'user';

    const handleCopyMessage = () => {
        // Регулярка для поиска всех блоков кода
        const codeBlockRegex = /```(?:\w+)?\s*\n?([\s\S]*?)\n?```/g;
        const matches = Array.from(message.content.matchAll(codeBlockRegex));

        if (matches.length > 0) {
            // Если есть блоки кода, копируем только их содержимое, разделяя двойным переносом
            const codeOnly = matches.map(match => match[1].trim()).join('\n\n');
            onCopy(codeOnly);
        } else {
            // Если блоков кода нет, копируем весь текст, но убираем инлайновые `
            const cleanText = message.content.replace(/`([^`]+)`/g, '$1');
            onCopy(cleanText);
        }

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
                        <div className={`text-content ${message.isTyping ? 'typing' : ''}`}>
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code({inline, className, children, ...props}: any) {
                                        const match = /language-(\w+)/.exec(className || '');
                                        const lang = match ? match[1] : '';
                                        const value = String(children).replace(/\n$/, '');

                                        if (!inline) {
                                            return (
                                                <CodeBlock
                                                    language={lang}
                                                    value={value}
                                                    isTyping={message.isTyping}
                                                    theme={theme}
                                                    onCopy={onCopy}
                                                    t={t}
                                                />
                                            );
                                        }

                                        return (
                                            <code className={className} {...props}>
                                                {children}
                                            </code>
                                        );
                                    }
                                }}
                            >
                                {message.content}
                            </ReactMarkdown>
                        </div>
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