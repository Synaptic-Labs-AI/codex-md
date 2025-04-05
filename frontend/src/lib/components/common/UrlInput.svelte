<!-- src/lib/components/common/UrlInput.svelte -->
<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';
    import { uploadStore } from '../../stores/uploadStore.js';
    import { files } from '../../stores/files.js';

    const dispatch = createEventDispatcher();

    // State
    let inputValue = '';
    let errorMessage = '';
    let loading = false;
    let showTooltip = false;

    // URL type configurations
    const URL_TYPES = {
        parent: {
            icon: '🗺️',
            placeholder: 'Enter parent URL to convert all linked pages',
            type: 'parent'
        },
        single: {
            icon: '🔗',
            placeholder: 'Enter URL to convert to Markdown',
            type: 'url'
        }
    };

    // Reactive declarations
    $: activeType = $uploadStore.activeTab;
    $: currentConfig = URL_TYPES[activeType] || URL_TYPES.single;
    $: isValidFormat = inputValue && couldBeValidUrl(inputValue);
    
    // Check if there are any files in the store (to disable URL input if a file exists)
    $: hasFiles = $files.length > 0 && !$files[0].url;
    $: isDisabled = hasFiles || loading;

    function couldBeValidUrl(input) {
        try {
            const trimmed = input.trim();
            return /^(https?:\/\/)?([\w-]+(\.[\w-]+)+|localhost)(:\d+)?(\/\S*)?$/.test(trimmed);
        } catch (error) {
            return false;
        }
    }

    function normalizeUrl(input) {
        if (!input) throw new Error('URL is required');
        
        let url = input.trim().replace(/\s+/g, '');
        
        if (!/^https?:\/\//i.test(url)) {
            url = `https://${url}`;
        }
        
        try {
            new URL(url);
            return url;
        } catch (error) {
            throw new Error('Invalid URL format');
        }
    }

    function handleInput(event) {
        const value = event.target.value;
        inputValue = value;
        uploadStore.setUrlInput(value);
        errorMessage = '';
    }

    async function handleSubmit() {
        try {
            if (!inputValue.trim()) {
                throw new Error('Please enter a URL');
            }

            const normalizedUrl = normalizeUrl(inputValue);
            const urlObj = new URL(normalizedUrl);
            const fileObj = {
                url: normalizedUrl,
                name: `${urlObj.hostname}${urlObj.pathname}`,
                type: currentConfig.type,
                options: {
                    ...((currentConfig.type === 'parent') && {
                        maxDepth: 3,
                        maxPages: 100,
                        includeImages: true,
                        includeMeta: true
                    })
                }
            };

            const result = files.addFile(fileObj);
            
            if (result.success) {
                inputValue = '';
                uploadStore.setUrlInput('');
                dispatch('submitUrl', { 
                    url: normalizedUrl, 
                    type: currentConfig.type 
                });
            } else if (!result.success && result.message) {
                errorMessage = result.message;
            }

        } catch (error) {
            console.error('URL submission error:', error);
            errorMessage = error.message;
        }
    }

    function handleKeyPress(event) {
        if (event.key === 'Enter' && isValidFormat) {
            handleSubmit();
        }
    }

    function handlePaste() {
        const input = document.querySelector('.url-input');
        input.classList.add('pasted');
        setTimeout(() => input.classList.remove('pasted'), 300);
    }
</script>

<div class="url-input-section" in:fade={{ duration: 200 }}>
    <div class="input-container">
        <input
            type="text"
            class="url-input"
            placeholder={hasFiles ? "Please remove file to add URL" : currentConfig.placeholder}
            bind:value={inputValue}
            on:input={handleInput}
            on:keypress={handleKeyPress}
            on:paste={handlePaste}
            disabled={isDisabled}
            aria-label={hasFiles ? "URL input disabled while file is present" : currentConfig.placeholder}
            aria-describedby="url-error"
        />

        <button 
            class="submit-button"
            on:click={handleSubmit}
            disabled={!isValidFormat || isDisabled}
            aria-label="Add URL to queue"
            on:mouseenter={() => showTooltip = true}
            on:mouseleave={() => showTooltip = false}
        >
            <span class="icon">➕</span>
            {#if showTooltip}
                <div class="tooltip" transition:fade={{ duration: 150 }}>
                    Add to queue
                </div>
            {/if}
        </button>
    </div>

    {#if errorMessage}
        <div 
            id="url-error" 
            class="error-message" 
            role="alert"
            in:fade={{ duration: 200 }}
        >
            {errorMessage}
        </div>
    {/if}

    {#if inputValue && !isValidFormat && !errorMessage}
        <div 
            id="url-format-warning" 
            class="error-message" 
            role="alert"
            in:fade={{ duration: 200 }}
        >
            The URL format looks incorrect.
        </div>
    {/if}

    {#if hasFiles}
        <div
            class="info-message"
            role="status"
            in:fade={{ duration: 200 }}
        >
            Remove the file first to add a URL instead.
        </div>
    {/if}
</div>

<style>
    .url-input-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        width: 100%;
        max-width: 1000px;
        margin: 0 auto;
    }

    .input-container {
        display: flex;
        align-items: center;
        background: rgba(var(--color-prime-rgb), 0.03);
        border-radius: var(--rounded-lg);
        padding: var(--spacing-sm);
        transition: all var(--transition-duration-normal) var(--transition-timing-ease);
        position: relative;
        height: 60px;
    }

    .input-container::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border-radius: var(--rounded-lg);
        padding: 2px;
        background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
        -webkit-mask: 
            linear-gradient(#fff 0 0) content-box, 
            linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        pointer-events: none;
    }

    .input-container:focus-within {
        background: rgba(var(--color-prime-rgb), 0.05);
    }

    .input-container:focus-within::before {
        background: linear-gradient(135deg, var(--color-fourth), var(--color-prime));
    }

    .url-input {
        flex: 1;
        border: none;
        background: transparent;
        padding: var(--spacing-sm);
        font-size: var(--font-size-base);
        color: var(--color-text);
        min-width: 0;
        position: relative;
        z-index: 1;
        font-family: var(--font-mono);
    }

    .url-input:focus {
        outline: none;
    }

    .url-input:disabled {
        cursor: not-allowed;
        opacity: 0.7;
    }

    .url-input.pasted {
        animation: flash 0.3s ease-out;
    }

    @keyframes flash {
        0% { background: rgba(var(--color-prime-rgb), 0); }
        50% { background: rgba(var(--color-prime-rgb), 0.1); }
        100% { background: rgba(var(--color-prime-rgb), 0); }
    }

    .submit-button {
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
        color: white;
        border: none;
        border-radius: var(--rounded-md);
        width: 40px;
        height: 40px;
        cursor: pointer;
        transition: all var(--transition-duration-normal);
        position: relative;
        margin-left: var(--spacing-xs);
    }

    .submit-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
    }

    .submit-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }

    .submit-button .icon {
        font-size: 1.2em;
    }

    .tooltip {
        position: absolute;
        top: -30px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-surface);
        color: var(--color-text);
        padding: var(--spacing-2xs) var(--spacing-xs);
        border-radius: var(--rounded-sm);
        font-size: var(--font-size-sm);
        white-space: nowrap;
        box-shadow: var(--shadow-sm);
        pointer-events: none;
    }

    .error-message {
        color: var(--color-error);
        font-size: var(--font-size-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--rounded-md);
        position: relative;
        background: rgba(var(--color-error-rgb), 0.1);
    }

    .info-message {
        color: var(--color-info);
        font-size: var(--font-size-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--rounded-md);
        position: relative;
        background: rgba(var(--color-info-rgb), 0.1);
    }

    /* Mobile Responsiveness */
    @media (max-width: 640px) {
        .input-container {
            height: 50px;
            padding: var(--spacing-xs);
        }

        .url-input {
            font-size: var(--font-size-sm);
        }

        .submit-button {
            width: 36px;
            height: 36px;
        }

        .submit-button .icon {
            font-size: 1em;
        }
    }

    /* Reduced Motion */
    @media (prefers-reduced-motion: reduce) {
        .input-container,
        .submit-button {
            transition: none;
        }

        .submit-button:hover:not(:disabled) {
            transform: none;
        }

        .url-input.pasted {
            animation: none;
        }
    }

    /* High Contrast */
    @media (prefers-contrast: high) {
        .input-container::before {
            padding: 3px;
        }

        .submit-button {
            border: 2px solid currentColor;
        }
    }
</style>
