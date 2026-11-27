<script module lang="ts">
    import { inlineStyle } from '../utils/dom';

    interface Props {
        position: TerminalLinkTooltipPosition;
        clickLabel: string;
        hint: string;
    }

    export interface TerminalLinkTooltipPosition {
        left: number;
        top: number;
        placement: 'above' | 'below';
    }
</script>

<script lang="ts">
    let { position, clickLabel, hint }: Props = $props();
</script>

<div
    class={`terminal-link-tooltip terminal-link-tooltip--${position.placement}`}
    role="tooltip"
    style={inlineStyle({ left: position.left, top: position.top })}
>
    <kbd>Ctrl</kbd>
    <span class="terminal-link-tooltip__plus">+</span>
    <kbd>{clickLabel}</kbd>
    <span class="terminal-link-tooltip__hint">{hint}</span>
</div>
