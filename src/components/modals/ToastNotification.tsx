import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import type { NotificationType } from '../../types';

interface ToastNotificationProps {
    message: string;
    type?: NotificationType;
    duration?: number;
    onClose: () => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({
    message,
    type = 'success',
    duration = 5000,
    onClose
}) => {
    const [isExiting, setIsExiting] = useState(false);
    const isClosingRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const remainingRef = useRef<number>(duration);
    const startTimeRef = useRef<number>(0);

    const clearAllTimers = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (exitTimerRef.current !== null) {
            clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
    }, []);

    const handleClose = useCallback(() => {
        if (isClosingRef.current) return;
        isClosingRef.current = true;

        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        setIsExiting(true);
        exitTimerRef.current = setTimeout(() => {
            onClose();
        }, 300);
    }, [onClose]);

    const startTimer = useCallback((time: number) => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
        }
        startTimeRef.current = Date.now();
        timerRef.current = setTimeout(() => {
            handleClose();
        }, time);
    }, [handleClose]);

    useEffect(() => {
        startTimer(remainingRef.current);
        return () => {
            clearAllTimers();
        };
    }, [startTimer, clearAllTimers]);

    const handleMouseEnter = () => {
        if (isClosingRef.current) return;
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const elapsed = Date.now() - startTimeRef.current;
        remainingRef.current = Math.max(1000, remainingRef.current - elapsed);
    };

    const handleMouseLeave = () => {
        if (isClosingRef.current) return;
        startTimer(remainingRef.current);
    };

    return (
        <div
            className={`toast-notification ${isExiting ? 'toast-exit' : 'toast-enter'}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            role="status"
            aria-live="polite"
        >
            {type === 'error' && <AlertCircle size={20} className="toast-icon toast-icon-error" />}
            {type === 'warning' && <AlertTriangle size={20} className="toast-icon toast-icon-warning" />}
            {type === 'info' && <Info size={20} className="toast-icon toast-icon-info" />}
            {(type === 'success' || !['error', 'warning', 'info'].includes(type)) && (
                <CheckCircle2 size={20} className="toast-icon toast-icon-success" />
            )}
            <span className="toast-message">
                {message}
            </span>
            <button
                type="button"
                className="toast-close-btn"
                onClick={handleClose}
                aria-label="Close notification"
            >
                <X size={16} />
            </button>
        </div>
    );
};
