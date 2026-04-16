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

        // Если не помещается справа — открывается слева от курсора
        if (x + offsetWidth > innerWidth) {
            left = x - offsetWidth;
        }

        // Если не помещается снизу — открывается сверху от курсора
        if (y + offsetHeight > innerHeight) {
            top = y - offsetHeight;
        }

        // Ограничение минимальных координат (чтобы не ушло за 0,0)
        left = Math.max(0, left);
        top = Math.max(0, top);

        const newPos = {left, top, ready: true};

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
                background: 'var(--bg-color)', // Используем переменную темы вместо фиксированного цвета
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                boxShadow: '0 15px 35px rgba(0,0,0,0.2)',
                zIndex: 1000,
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
                        color: option.danger ? '#cc241d' : 'var(--text-color)', // Адаптивные цвета
                        fontWeight: '600',
                        fontSize: '14px',
                        borderRadius: '8px',
                        marginBottom: '2px'
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        option.onClick();
                        onClose();
                    }}
                >
                    {option.label}
                </div>
            ))}
        </div>
    );
};
