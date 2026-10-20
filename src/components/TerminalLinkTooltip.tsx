import type { FC } from 'react';

export interface TerminalLinkTooltipPosition {
    left: number;
    top: number;
    placement: 'above' | 'below';
}

interface Props {
    position: TerminalLinkTooltipPosition;
    clickLabel: string;
    hint: string;
}

export const TerminalLinkTooltip: FC<Props> = ({ position, clickLabel, hint }) => (
    <div
        className={`terminal-link-tooltip terminal-link-tooltip--${position.placement}`}
        role="tooltip"
        style={{ left: position.left, top: position.top }}
    >
        <kbd>Ctrl</kbd>
        <span className="terminal-link-tooltip__plus">+</span>
        <kbd>{clickLabel}</kbd>
        <span className="terminal-link-tooltip__hint">{hint}</span>
    </div>
);
