<script module lang="ts">
    import { ChevronDown } from '@lucide/svelte';

    import { onMount } from 'svelte';

    import { type CSSProperties, type RefObject, inlineStyle } from '../../utils/dom';

    interface Option {
        value: string;
        label: string;
    }

    interface CustomSelectProps {
        id?: string;
        value: string;
        onChange: (value: string) => void;
        options: Option[];
        className?: string;
        style?: CSSProperties;
        placeholder?: string;
    }
</script>

<script lang="ts">
    let { id, value, onChange, options, className, style, placeholder }: CustomSelectProps = $props();

    const listId = $props.id();
    let trigger: HTMLButtonElement;
    let isOpen = $state.raw(false);

    const containerRef: RefObject<HTMLDivElement | null> = $state({ current: null });

    const selectedOption = $derived(options.find((opt) => opt.value === value));

    onMount(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                isOpen = false;
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    });
</script>

<div
    onkeydown={(event) => {
        if (isOpen && event.key === 'Escape') {
            event.stopPropagation();
            isOpen = false;
            trigger.focus();
        }
    }}
    role="presentation"
    bind:this={containerRef.current}
    class={className}
    style={inlineStyle({ position: 'relative', ...style })}
>
    <button
        type="button"
        {id}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        bind:this={trigger}
        class="plain-button plain-button-wide custom-select-trigger"
        onclick={() => (isOpen = !isOpen)}
        style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: var(--ui-font-size-base); transition: background-color 0.2s ease, border-color 0.2s ease; user-select: none"
    >
        <span
            style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; font-size: var(--ui-font-size-base); color: var(--text-primary)"
        >
            {#if selectedOption}{selectedOption.label}{:else}{placeholder}{/if}
        </span>
        <ChevronDown
            size={16}
            style={inlineStyle({
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                opacity: 0.7,
                flexShrink: 0,
                color: 'var(--text-primary)',
            })}
        />
    </button>

    {#if isOpen}<div id={listId} class="custom-select-dropdown">
            <div
                style="position: absolute; top: calc(100% + 5px); left: 0; right: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); z-index: 1000; max-height: 300px; overflow-y: auto; padding: 4px"
            >
                {#each options as option (option.value)}<button
                        type="button"
                        onclick={() => {
                            onChange(option.value);
                            isOpen = false;
                            trigger.focus();
                        }}
                        class={`plain-button plain-button-wide custom-select-option ${value === option.value ? 'active' : ''}`}
                        style={inlineStyle({
                            padding: '8px 12px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease, color 0.15s ease',
                            backgroundColor: value === option.value ? 'var(--accent)' : 'transparent',
                            color: value === option.value ? '#fff' : 'var(--text-primary)',
                            fontWeight: value === option.value ? '600' : 'normal',
                            marginBottom: '2px',
                            fontSize: '1rem',
                        })}
                    >
                        {option.label}
                    </button>{/each}
            </div>
        </div>{/if}
</div>
