import React, { useEffect, useRef } from 'react';

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

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, options, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Adjust position if menu goes off screen
  const adjustPosition = () => {
    if (!menuRef.current) return { left: x, top: y };
    const { innerWidth, innerHeight } = window;
    const { offsetWidth, offsetHeight } = menuRef.current;

    let left = x;
    let top = y;

    if (x + offsetWidth > innerWidth) {
      left = innerWidth - offsetWidth - 5;
    }
    if (y + offsetHeight > innerHeight) {
      top = innerHeight - offsetHeight - 5;
    }

    return { left, top };
  };

  const pos = adjustPosition();

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        background: 'var(--bg-color)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
        minWidth: '160px',
        padding: '5px 0',
      }}
    >
      {options.map((option, index) => (
        <div
          key={index}
          className="menu-dropdown-item"
          style={{
            padding: '8px 15px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: option.danger ? '#e81123' : 'inherit',
            fontWeight: 'bold',
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
