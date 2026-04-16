import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';

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
    const [pos, setPos] = useState({left: x, top: y, ready: false});

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    useLayoutEffect(() => {
        if (!menuRef.current) return;

        const {innerWidth, innerHeight} = window;
        const {offsetWidth, offsetHeight} = menuRef.current;

        let left = x;
        let top = y;

        if (x + offsetWidth > innerWidth) {
            left = innerWidth - offsetWidth - 5;
        }
        if (y + offsetHeight > innerHeight) {
            top = innerHeight - offsetHeight - 5;
        }

        // Ensure not negative
        left = Math.max(5, left);
        top = Math.max(5, top);

        const newPos = {left, top, ready: true};

        // Use requestAnimationFrame to avoid "cascading renders" lint error
        // while still being faster than setTimeout(0)
        requestAnimationFrame(() => {
            setPos(prev => {
                if (prev.left === newPos.left && prev.top === newPos.top && prev.ready === newPos.ready) return prev;
                return newPos;
            });
        });
    }, [x, y]);

    return (
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                background: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                zIndex: 1000,
                minWidth: '160px',
                padding: '4px',
                opacity: pos.ready ? 1 : 0,
                pointerEvents: pos.ready ? 'auto' : 'none'
            }}
        >
            {options.map((option, index) => (
                <div
                    key={index}
                    className="menu-dropdown-item"
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        color: option.danger ? '#e81123' : 'inherit',
                        fontWeight: 'inherit',
                        marginBottom: '2px'
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
        </div>
    );
};
