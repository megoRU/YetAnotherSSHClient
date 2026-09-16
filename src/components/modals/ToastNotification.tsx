import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ToastNotificationProps {
    message: string;
    duration?: number;
    onClose: () => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({
    message,
    duration = 6000,
    onClose
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isExiting, setIsExiting] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const remainingRef = useRef<number>(duration);
    const startTimeRef = useRef<number>(0);

    const handleClose = useCallback(() => {
        setIsExiting(true);
        setTimeout(() => {
            onClose();
        }, 300);
    }, [onClose]);

    const startTimer = useCallback((time: number) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        startTimeRef.current = Date.now();
        timerRef.current = setTimeout(() => {
            handleClose();
        }, time);
    }, [handleClose]);

    useEffect(() => {
        startTimer(remainingRef.current);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [startTimer]);

    const handleMouseEnter = () => {
        setIsHovered(true);
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const elapsed = Date.now() - startTimeRef.current;
        remainingRef.current = Math.max(1000, remainingRef.current - elapsed);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        startTimer(remainingRef.current);
    };

    return (
        <div
            className={`toast-notification ${isExiting ? 'toast-exit' : 'toast-enter'}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
                position: 'fixed',
                bottom: '30px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 20px',
                borderRadius: '50px',
                backgroundColor: 'var(--surface, #1e1e2e)',
                color: 'var(--text-primary, #ffffff)',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
                backdropFilter: 'blur(12px)',
                pointerEvents: 'auto',
                userSelect: 'none',
                maxWidth: '90vw',
                whiteSpace: 'nowrap'
            }}
        >
            <CheckCircle2 color="#2ea44f" size={20} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--ui-font-size, 13px)', fontWeight: 500, flexGrow: 1 }}>
                {message}
            </span>
            <button
                type="button"
                onClick={handleClose}
                aria-label="Close notification"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))',
                    cursor: 'pointer',
                    padding: '2px',
                    borderRadius: '50%',
                    marginLeft: '4px',
                    opacity: isHovered ? 1 : 0,
                    width: isHovered ? '20px' : '0px',
                    overflow: 'hidden',
                    transition: 'opacity 0.2s ease, width 0.2s ease, color 0.15s ease',
                    pointerEvents: isHovered ? 'auto' : 'none'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary, #fff)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.6))'; }}
            >
                <X size={16} />
            </button>
        </div>
    );
};
