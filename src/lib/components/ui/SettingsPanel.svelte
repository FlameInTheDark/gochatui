<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	export let open = true;
	export let maxWidthClass = 'max-w-3xl';
	export let sidebarClass = '';
	export let contentClass = '';

	const dispatch = createEventDispatcher();

	const close = () => {
		if (!open) return;
		open = false;
		dispatch('close');
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (!open) return;
		if (event.key === 'Escape') {
			close();
		}
	};

        const handleBackdropClick = (event: MouseEvent) => {
                if (event.target !== event.currentTarget) return;
                close();
        };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
        <div
                class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                role="presentation"
                onclick={handleBackdropClick}
        >
                <div
                        class={`relative flex h-[80vh] w-full flex-col overflow-hidden rounded-lg bg-[var(--bg)] shadow-xl ${maxWidthClass}`}
                        role="dialog"
                        aria-modal="true"
                        onpointerdown={(event) => event.stopPropagation()}
                >
                        <header class="relative z-20 flex items-center justify-end border-b border-[var(--stroke)] bg-[var(--panel)] px-4 py-3">
                                <button
                                        aria-label={m.close()}
                                        class="relative z-20 rounded p-1 text-xl leading-none hover:bg-[var(--panel-strong)]"
                                        onclick={close}
                                >
                                        &times;
                                </button>
                        </header>
                        <div class="flex flex-1 overflow-hidden">
                                <aside class={`w-48 flex-shrink-0 space-y-2 border-r border-[var(--stroke)] p-4 ${sidebarClass}`}>
                                        <slot name="sidebar" {close} />
                                </aside>
                                <section class="flex flex-1 flex-col overflow-hidden">
                                        <div class={`scroll-area flex-1 space-y-4 overflow-y-auto p-4 ${contentClass}`}>
                                                <slot {close} />
                                        </div>
                                        {#if $$slots.footer}
                                                <footer class="border-t border-[var(--stroke)] bg-[var(--panel)] p-4">
                                                        <slot name="footer" {close} />
                                                </footer>
                                        {/if}
                                </section>
                        </div>
                </div>
        </div>
{/if}
