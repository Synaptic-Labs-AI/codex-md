<!-- src/lib/components/common/StatusBadge.svelte -->
<script>
    export let status = 'ready';
    export let showIcon = true;
    
    const STATUS_CONFIG = {
        ready: {
            icon: '🔄',
            color: 'var(--color-text-secondary)',
            background: 'var(--color-background-secondary)',
            label: 'Idle'
        },
        converting: {
            icon: '⚡',
            color: 'var(--color-prime)',
            background: 'var(--color-prime-light)',
            label: 'Converting'
        },
        completed: {
            icon: '✨',
            color: 'var(--color-success)',
            background: 'var(--color-success-light)',
            label: 'Completed'
        },
        error: {
            icon: '⚠️',
            color: 'var(--color-error)',
            background: 'var(--color-error-light)',
            label: 'Error'
        },
        stopped: {
            icon: '🛑',
            color: 'var(--color-warning)',
            background: 'var(--color-warning-light)',
            label: 'Stopped'
        }
    };

    $: config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
</script>

<span 
    class="status-badge"
    style="
        --badge-color: {config.color};
        --badge-background: {config.background};
    "
    aria-label={config.label}
>
    {#if showIcon}
        <span class="icon" aria-hidden="true">{config.icon}</span>
    {/if}
    <span class="label">{config.label}</span>
</span>

<style>
    .status-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-2xs);
        padding: 4px var(--spacing-xs);
        border-radius: var(--rounded-full);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--badge-color);
        background: var(--badge-background);
        white-space: nowrap;
        transition: all var(--transition-duration-normal) ease;
    }

    .icon {
        font-size: 14px;
        line-height: 1;
    }

    .label {
        text-transform: capitalize;
    }
</style>
