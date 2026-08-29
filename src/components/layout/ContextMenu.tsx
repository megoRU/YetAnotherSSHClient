import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuOption {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    options: ContextMenuOption[];
    onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({x, y, options, onClose}) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({left: 0, top: 0, ready: false});

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleMouseMove = (event: MouseEvent) => {
            if (!menuRef.current || !pos.ready) return;

            const rect = menuRef.current.getBoundingClientRect();
            const mouseX = event.clientX;
            const mouseY = event.clientY;

            // Calculate distance to the nearest edge/corner of the menu
            const dx = Math.max(rect.left - mouseX, 0, mouseX - rect.right);
            const dy = Math.max(rect.top - mouseY, 0, mouseY - rect.bottom);
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Close if mouse is further than 150px from the menu
            if (distance > 35) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('mousemove', handleMouseMove);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('mousemove', handleMouseMove);
        };
    }, [onClose, pos.ready]);

    useLayoutEffect(() => {
        if (!menuRef.current) return;

        const {innerWidth, innerHeight} = window;
        const {offsetWidth, offsetHeight} = menuRef.current;

        let left = x + 2;
        let top = y + 2;

        if (left + offsetWidth > innerWidth) {
            left = innerWidth - offsetWidth - 8;
        }

        if (top + offsetHeight > innerHeight) {
            top = innerHeight - offsetHeight - 8;
        }

        setPos(prev => {
            if (prev.left === left && prev.top === top && prev.ready) return prev;
            return {left, top, ready: true};
        });
    }, [x, y]);

    return createPortal(
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                boxShadow: '0 15px 35px rgba(0,0,0,0.2)',
                zIndex: 9999,
                minWidth: '200px',
                padding: '6px',
                opacity: pos.ready ? 1 : 0,
                pointerEvents: pos.ready ? 'auto' : 'none',
                transition: 'opacity 0.1s ease'
            }}
        >
            {options.map((option, index) => (
                <div
                    key={index}
                    className="menu-dropdown-item"
                    style={{
                        padding: '10px 16px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        color: option.danger ? '#ef4444' : 'var(--text-primary)',
                        fontWeight: '500',
                        fontSize: '1rem',
                        borderRadius: '8px',
                        marginBottom: '2px',
                        transition: 'background-color 0.15s ease, color 0.15s ease'
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        option.onClick();
                        onClose();
                    }}
                >
                    {option.icon}
                    {option.label}
                </div>
            ))}
        </div>,
        document.body
    );
};
