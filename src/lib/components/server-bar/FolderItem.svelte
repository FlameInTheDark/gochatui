<script lang="ts">
        import { browser } from '$app/environment';
        import { onMount, tick } from 'svelte';

        import ServerList from './ServerList.svelte';
        import { hexToRgba } from './state';
        import type { FolderItem, ServerBarCallbacks } from './types';

        const props = $props<{
                item: FolderItem;
                callbacks: ServerBarCallbacks;
                dropIntoId?: string | null;
                draggingId?: string | null;
        }>();

        let { item, callbacks, dropIntoId = null, draggingId = null } = props;

        let liEl: HTMLLIElement | null = $state(null);
        let buttonEl: HTMLButtonElement | null = $state(null);
        let contentsEl: HTMLUListElement | null = $state(null);
        let scopeStyle = $state<{ top: number; height: number } | null>(null);

        async function updateScope() {
                if (item.collapsed || !liEl || !buttonEl) {
                        scopeStyle = null;
                        return;
                }
                await tick();
                if (!liEl || !buttonEl) return;
                const liRect = liEl.getBoundingClientRect();
                const btnRect = buttonEl.getBoundingClientRect();
                const ulRect = contentsEl?.getBoundingClientRect() ?? btnRect;
                const padTop = 6;
                const padBottom = 6;
                const topEdge = Math.min(btnRect.top, ulRect.top);
                const bottomEdge = Math.max(btnRect.bottom, ulRect.bottom);
                const top = Math.max(0, Math.floor(topEdge - liRect.top - padTop));
                const bottom = Math.ceil(bottomEdge - liRect.top + padBottom);
                scopeStyle = { top, height: Math.max(0, bottom - top) };
        }

        function handleResize() {
                if (!item.collapsed) {
                        updateScope();
                }
        }

        onMount(() => {
                if (!browser) return;
                if (!item.collapsed) updateScope();
                window.addEventListener('resize', handleResize);
                return () => {
                        window.removeEventListener('resize', handleResize);
                };
        });

        $effect(() => {
                if (!browser) {
                        return;
                }
                const collapsed = item.collapsed;
                const childCount = item.children.length;
                if (!collapsed) {
                        void childCount;
                        updateScope();
                } else {
                        scopeStyle = null;
                }
        });

        const folderLabel = $derived(`${item.name} (folder)`);
</script>

<li
        bind:this={liEl}
        class={`folder draggable${dropIntoId === item.id ? ' drop-into' : ''}`}
        data-id={item.id}
        aria-label={folderLabel}
        draggable="true"
        aria-grabbed={draggingId === item.id ? 'true' : undefined}
        ondragstart={(event) => callbacks.onItemDragStart(event, item)}
        ondragend={(event) => callbacks.onItemDragEnd(event, item)}
        ondragover={(event) => callbacks.onItemDragOver(event, item)}
        ondragleave={(event) => callbacks.onItemDragLeave(event, item)}
        ondrop={(event) => callbacks.onItemDrop(event, item)}
        onmouseenter={(event) => callbacks.onItemMouseEnter(event, item)}
        onmouseleave={(event) => callbacks.onItemMouseLeave(event, item)}
        onmousemove={(event) => callbacks.onItemMouseMove(event, item)}
>
        {#if scopeStyle}
                <div
                        class="folder-scope"
                        style={`top: ${scopeStyle.top}px; height: ${scopeStyle.height}px; background: ${hexToRgba(item.color, 0.18)}; border-color: ${hexToRgba(item.color, 0.35)}; box-shadow: 0 0 0 1px ${hexToRgba(item.color, 0.35)}, inset 0 1px 0 rgba(255,255,255,.05);`}
                ></div>
        {/if}
        <button
                bind:this={buttonEl}
                class="folder-toggle focus-ring"
                type="button"
                aria-label={`${item.name} toggle`}
                aria-expanded={String(!item.collapsed)}
                onclick={() => callbacks.onFolderToggle(item)}
        >
                <div class="circle folder-circle" style={`background: ${item.color}`}>
                        <div class={`folder-thumb${item.collapsed && item.children.length === 0 ? ' empty' : ''}`}>
                                {#if item.collapsed}
                                        <div class="folder-grid">
                                                {#each item.children.slice(0, 4) as child (child.id)}
                                                        <div class="mini" style={`background: ${child.color}`}>
                                                                {child.type === 'guild' ? child.letter ?? child.name.charAt(0) : 'F'}
                                                        </div>
                                                {/each}
                                        </div>
                                {:else}
                                        <div class="folder-label">{item.name}</div>
                                {/if}
                        </div>
                </div>
        </button>
        <ul bind:this={contentsEl} class="folder-contents">
                {#if !item.collapsed}
                        <ServerList
                                items={item.children}
                                {callbacks}
                                dropIntoId={dropIntoId}
                                {draggingId}
                        />
                {/if}
        </ul>
</li>
