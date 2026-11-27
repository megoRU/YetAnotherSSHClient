<script module lang="ts">
    import { inlineStyle } from '../../utils/dom';
</script>

<script lang="ts">
    let { label, value, highlight }: { label: string; value: string; highlight?: boolean } = $props();
</script>

<div style="display: flex; flex-direction: column; gap: 4px">
    <span style="font-size: 0.85rem; color: var(--text-secondary)">{label}</span>
    <code
        style={inlineStyle({
            fontFamily: 'var(--ui-font-family)',
            fontSize: '0.85rem',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'var(--hover-surface)',
            border: highlight ? '1px solid var(--accent)' : '1px solid var(--border)',
            // Отпечаток — длинная строка base64 без пробелов: без переноса он
            // растянул бы окно за пределы экрана.
            wordBreak: 'break-all',
            userSelect: 'text',
        })}
    >
        {value}
    </code>
</div>
