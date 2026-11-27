<script module lang="ts">
    import { ShieldCheck } from '@lucide/svelte';
</script>

<script lang="ts">
    let { title, fingerprint }: { title: string; fingerprint: string } = $props();
</script>

<div style="border-radius: 10px; overflow: hidden">
    <div
        style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--hover-surface); border-bottom: 1px solid var(--border); color: var(--text-primary); font-size: 0.95rem; font-weight: 600; line-height: 1.3"
    >
        <ShieldCheck size={16} style="color: var(--accent); flex-shrink: 0" />
        {title}
    </div>
    <code
        style="display: block; font-family: var(--ui-font-family); font-size: 0.90rem; padding: 10px 12px; background: var(--hover-surface); word-break: break-all; user-select: text"
    >
        {fingerprint}
    </code>
</div>
