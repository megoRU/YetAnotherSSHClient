import React, {useState} from 'react';
import {Check, Copy, User} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {vscDarkPlus, prism} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type {ChatMessage} from "../../types.ts";
import {useI18n} from "../../utils/i18n.ts";

interface MessageBubbleProps {
    message: ChatMessage;
    language: 'ru' | 'en';
    onCopy: (text: string) => void;
    theme?: string;
}

interface CodeBlockProps {
    inline?: boolean;
    className?: string;
    children: React.ReactNode;
    isTyping: boolean;
    theme?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({inline, className, children, isTyping, theme}) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : 'text';
    const content = String(children).replace(/\n$/, '');
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (inline) {
        return <code>{children}</code>;
    }

    const contentStr = String(children || '');

    if (isTyping) {
        return (
            <div className="code-block-container">
                <div className="code-block-header">
                    <span>{language}</span>
                </div>
                <pre>
                    <code>
                        {contentStr}
                        <span className="typing-cursor"></span>
                    </code>
                </pre>
            </div>
        );
    }

    const highlighterTheme = theme?.toLowerCase().includes('dark') || theme === 'Auto' ? vscDarkPlus : prism;

    return (
        <div className="code-block-container">
            <div className="code-block-header">
                <span>{language}</span>
                <button className="code-copy-btn" onClick={handleCopy} title="Copy code">
                    {copied ? <Check size={14}/> : <Copy size={14}/>}
                </button>
            </div>
            <SyntaxHighlighter
                style={highlighterTheme}
                language={language}
                PreTag="div"
                codeTagProps={{
                    style: {
                        fontFamily: 'var(--mono-font-family)',
                        fontSize: 'var(--ui-font-size)'
                    }
                }}
                customStyle={{
                    margin: 0,
                    padding: '12px',
                    background: 'transparent',
                    fontSize: 'var(--ui-font-size)'
                }}
            >
                {contentStr}
            </SyntaxHighlighter>
        </div>
    );
};

export const MessageBubble = React.memo(function MessageBubble({message, language, onCopy, theme}: MessageBubbleProps) {
    const {t} = useI18n(language);
    const [messageCopied, setMessageCopied] = React.useState(false);
    const isUser = message.role === 'user';

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
                        <div className={`text-content markdown-body ${message.isTyping ? 'typing' : ''}`}>
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code({node, inline, className, children, ...props}: any) {
                                        try {
                                            const isTyping = message.isTyping || false;
                                            return (
                                                <CodeBlock
                                                    inline={inline}
                                                    className={className}
                                                    isTyping={isTyping}
                                                    theme={theme}
                                                    {...props}
                                                >
                                                    {children}
                                                </CodeBlock>
                                            );
                                        } catch (e) {
                                            console.error('Markdown code error:', e);
                                            return <code className={className}>{children}</code>;
                                        }
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