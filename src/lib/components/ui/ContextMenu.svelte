<script lang="ts">
        import { contextMenu } from '$lib/stores/contextMenu';
        import type {
                ContextMenuActionItem,
                ContextMenuItem,
                ContextMenuSliderItem
        } from '$lib/stores/contextMenu';
	import { tick } from 'svelte';

	let menuEl: HTMLDivElement | null = $state(null);
	let submenuEl: HTMLDivElement | null = $state(null);
	let posX = $state(0);
	let posY = $state(0);
	let submenuX = $state(0);
	let submenuY = $state(0);

        let itemRefs: (HTMLButtonElement | null)[] = [];
        let submenuItemRefs: (HTMLButtonElement | null)[] = [];
        let sliderValues: Record<number, number> = {};

        function isSliderItem(item: ContextMenuItem): item is ContextMenuSliderItem {
                return (item as ContextMenuSliderItem)?.type === 'slider';
        }

        const isActionItem = (item: ContextMenuItem): item is ContextMenuActionItem => !isSliderItem(item);

        function sliderValue(index: number, item: ContextMenuSliderItem): number {
                const raw = sliderValues[index];
                const fallback = Number(item.value ?? 0);
                return Number.isFinite(raw) ? raw : fallback;
        }

        function sliderDisplay(value: number): string {
                const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
                return `${pct}%`;
        }

        function sliderInputId(index: number): string {
                return `cm-slider-${index}`;
        }

        function handleSliderInput(index: number, item: ContextMenuSliderItem, event: Event) {
                if (item.disabled) return;
                event.stopPropagation();
                const input = event.currentTarget as HTMLInputElement;
                const nextValue = Number(input.value);
                sliderValues = { ...sliderValues, [index]: nextValue };
                item.onChange?.(nextValue);
        }

        function getOpenSubmenuItems(): ContextMenuActionItem[] {
                const cm = $contextMenu as { items: ContextMenuItem[]; openSubmenuIndex: number | null } | null;
                if (!cm || cm.openSubmenuIndex == null) {
                        return [];
                }
                const item = cm.items[cm.openSubmenuIndex];
                if (!item || !isActionItem(item) || !item.children) return [];
                return item.children;
        }
        let submenuCloseTimeout: ReturnType<typeof setTimeout> | null = null;

	function clamp(v: number, min: number, max: number) {
		return Math.max(min, Math.min(max, v));
	}

	function clearSubmenuCloseTimeout() {
		if (submenuCloseTimeout) {
			clearTimeout(submenuCloseTimeout);
			submenuCloseTimeout = null;
		}
	}

	function scheduleSubmenuClose() {
		clearSubmenuCloseTimeout();
		submenuCloseTimeout = setTimeout(() => {
			contextMenu.closeSubmenu();
			submenuCloseTimeout = null;
		}, 120);
	}

	function rootRef(node: HTMLButtonElement, index: number) {
		itemRefs[index] = node;
		let currentIndex = index;
		return {
			update(newIndex: number) {
				if (newIndex !== currentIndex) {
					if (itemRefs[currentIndex] === node) {
						itemRefs[currentIndex] = null;
					}
					currentIndex = newIndex;
					itemRefs[currentIndex] = node;
				}
			},
			destroy() {
				if (itemRefs[currentIndex] === node) {
					itemRefs[currentIndex] = null;
				}
			}
		};
	}

	function submenuRef(node: HTMLButtonElement, index: number) {
		submenuItemRefs[index] = node;
		let currentIndex = index;
		return {
			update(newIndex: number) {
				if (newIndex !== currentIndex) {
					if (submenuItemRefs[currentIndex] === node) {
						submenuItemRefs[currentIndex] = null;
					}
					currentIndex = newIndex;
					submenuItemRefs[currentIndex] = node;
				}
			},
			destroy() {
				if (submenuItemRefs[currentIndex] === node) {
					submenuItemRefs[currentIndex] = null;
				}
			}
		};
	}

	function focusRootItem(index: number | null) {
		if (index == null) return;
		const el = itemRefs[index];
		if (el && !el.disabled) el.focus();
	}

	function focusFirstSubmenuItem() {
		const el = submenuItemRefs.find((item) => item && !item.disabled) ?? null;
		el?.focus();
	}

	function moveFocus(items: (HTMLButtonElement | null)[], startIndex: number, delta: number) {
		const len = items.length;
		if (!len) return;
		let idx = startIndex;
		for (let i = 0; i < len; i += 1) {
			idx = (idx + delta + len) % len;
			const el = items[idx];
			if (el && !el.disabled) {
				el.focus();
				return;
			}
		}
	}

	async function updatePosition() {
		if (typeof window === 'undefined') return;
		await tick();
		const pad = 8;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const rect = menuEl ? menuEl.getBoundingClientRect() : ({ width: 220, height: 200 } as any);
		posX = clamp(($contextMenu as any).x, pad, vw - rect.width - pad);
		posY = clamp(($contextMenu as any).y, pad, vh - rect.height - pad);
		const cm = $contextMenu as any;
		if (cm?.openSubmenuIndex != null) {
			updateSubmenuPosition();
		}
	}

	async function updateSubmenuPosition() {
		if (typeof window === 'undefined') return;
		await tick();
		const cm = $contextMenu as any;
		const parentIndex: number | null = cm.openSubmenuIndex;
		if (parentIndex == null) return;
		const trigger = itemRefs[parentIndex];
		if (!trigger) return;
		const pad = 8;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const triggerRect = trigger.getBoundingClientRect();
		const fallback = { width: 220, height: 200 };
		const submenuRect = submenuEl ? submenuEl.getBoundingClientRect() : (fallback as DOMRect);
		let nextX = triggerRect.right;
		let nextY = triggerRect.top;
		const width = submenuRect?.width ?? fallback.width;
		const height = submenuRect?.height ?? fallback.height;
		if (nextX + width + pad > vw) {
			nextX = triggerRect.left - width;
		}
		nextX = clamp(nextX, pad, vw - width - pad);
		if (nextY + height + pad > vh) {
			nextY = vh - height - pad;
		}
		nextY = clamp(nextY, pad, vh - height - pad);
		submenuX = nextX;
		submenuY = nextY;
	}

	function openSubmenu(index: number, { focus = false }: { focus?: boolean } = {}) {
		const cm = $contextMenu as any;
		if (cm.openSubmenuIndex !== index) {
			contextMenu.openSubmenu(index);
		}
		clearSubmenuCloseTimeout();
		submenuItemRefs = [];
		Promise.resolve()
			.then(tick)
			.then(() => {
				updateSubmenuPosition();
				if (focus) {
					focusFirstSubmenuItem();
				}
			});
	}

        function handleTriggerEnter(index: number, item: ContextMenuItem) {
                if (!isActionItem(item)) return;
                if (!item.children?.length || item.disabled) return;
                openSubmenu(index);
        }

	function handleTriggerLeave(index: number) {
		const cm = $contextMenu as any;
		if (cm.openSubmenuIndex === index) {
			scheduleSubmenuClose();
		}
	}

        function handleItemClick(event: MouseEvent, item: ContextMenuItem, index: number) {
                if (!isActionItem(item)) {
                        event.preventDefault();
                        return;
                }
                const actionItem = item;
                if (actionItem.disabled) {
                        event.preventDefault();
                        return;
                }
                if (actionItem.children?.length) {
                        event.preventDefault();
                        openSubmenu(index, { focus: event.detail === 0 });
                        return;
                }
                contextMenu.close();
                if (actionItem.action) {
                        Promise.resolve().then(actionItem.action);
                }
        }

        function handleSubmenuItemClick(item: ContextMenuActionItem) {
                if (item.disabled) return;
                contextMenu.close();
                if (item.action) {
                        Promise.resolve().then(item.action);
                }
        }

	function onRootKeydown(event: KeyboardEvent) {
		const cm = $contextMenu as any;
		const target = event.target as HTMLButtonElement | null;
		const items = itemRefs;
		const index = target ? items.indexOf(target) : -1;
		switch (event.key) {
			case 'ArrowDown': {
				event.preventDefault();
				event.stopPropagation();
				if (cm.openSubmenuIndex != null) {
					contextMenu.closeSubmenu();
				}
				moveFocus(items, index === -1 ? items.length - 1 : index, 1);
				break;
			}
			case 'ArrowUp': {
				event.preventDefault();
				event.stopPropagation();
				if (cm.openSubmenuIndex != null) {
					contextMenu.closeSubmenu();
				}
				moveFocus(items, index === -1 ? 0 : index, -1);
				break;
			}
			case 'ArrowRight': {
				if (index >= 0) {
                                        const maybeItem = cm.items[index] as ContextMenuItem | undefined;
                                        if (
                                                maybeItem &&
                                                isActionItem(maybeItem) &&
                                                maybeItem.children?.length &&
                                                !maybeItem.disabled
                                        ) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                openSubmenu(index, { focus: true });
                                        }
                                }
				break;
			}
			case 'ArrowLeft':
			case 'Escape': {
				if (cm.openSubmenuIndex != null) {
					event.preventDefault();
					event.stopPropagation();
					const parentIndex = cm.openSubmenuIndex;
					contextMenu.closeSubmenu();
					Promise.resolve()
						.then(tick)
						.then(() => focusRootItem(parentIndex));
				} else if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					contextMenu.close();
				}
				break;
			}
		}
	}

	function onSubmenuKeydown(event: KeyboardEvent) {
		const cm = $contextMenu as any;
		const parentIndex: number | null = cm.openSubmenuIndex;
		if (parentIndex == null) return;
		const items = submenuItemRefs;
		const target = event.target as HTMLButtonElement | null;
		const index = target ? items.indexOf(target) : -1;
		switch (event.key) {
			case 'ArrowDown': {
				event.preventDefault();
				event.stopPropagation();
				moveFocus(items, index === -1 ? items.length - 1 : index, 1);
				break;
			}
			case 'ArrowUp': {
				event.preventDefault();
				event.stopPropagation();
				moveFocus(items, index === -1 ? 0 : index, -1);
				break;
			}
			case 'ArrowLeft':
			case 'Escape': {
				event.preventDefault();
				event.stopPropagation();
				contextMenu.closeSubmenu();
				Promise.resolve()
					.then(tick)
					.then(() => focusRootItem(parentIndex));
				break;
			}
		}
	}

	function onGlobalKey(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		const cm = $contextMenu as any;
		if (cm.openSubmenuIndex != null) {
			event.preventDefault();
			event.stopPropagation();
			const parentIndex = cm.openSubmenuIndex;
			contextMenu.closeSubmenu();
			Promise.resolve()
				.then(tick)
				.then(() => focusRootItem(parentIndex));
			return;
		}
		contextMenu.close();
	}

	// Re-clamp position whenever menu opens or its target coords change
	$effect(() => {
		const cm = $contextMenu as any;
		if (cm?.open) {
			updatePosition();
		}
	});

	// Update submenu placement whenever its open index changes
	$effect(() => {
		const cm = $contextMenu as any;
		if (cm?.openSubmenuIndex != null) {
			updateSubmenuPosition();
		} else {
			submenuItemRefs = [];
			clearSubmenuCloseTimeout();
		}
	});

        // Reset refs when menu closes
        $effect(() => {
                const cm = $contextMenu as any;
                if (!cm?.open) {
                        itemRefs = [];
                        submenuItemRefs = [];
                        clearSubmenuCloseTimeout();
                        sliderValues = {};
                }
        });

        const submenuItems = $derived(getOpenSubmenuItems());
</script>

<svelte:window
        onkeydown={onGlobalKey}
        onpointerdown={(event) => {
                if (event.defaultPrevented) return;
                if (event.pointerType === 'touch' || event.button === 0 || event.button === -1) {
                        contextMenu.close();
                }
        }}
        onresize={() => {
                updatePosition();
                updateSubmenuPosition();
        }}
/>

{#if $contextMenu.open}
	<div class="pointer-events-none fixed inset-0 z-[1000]">
		<div
			bind:this={menuEl}
			class="pointer-events-auto absolute"
			role="menu"
			tabindex="-1"
			style={`left:${posX}px; top:${posY}px`}
			onpointerdown={(e) => e.stopPropagation()}
			oncontextmenu={(e) => e.stopPropagation()}
			onkeydown={onRootKeydown}
		>
			<div class="rounded-lg backdrop-blur-md">
				<div class="panel max-w-[260px] min-w-[200px] rounded-md p-1">
                                        {#each $contextMenu.items as it, index}
                                                {#if isSliderItem(it)}
                                                        <div class={`px-3 py-2 ${it.disabled ? 'opacity-50' : ''}`}>
                                                                <label
                                                                        for={sliderInputId(index)}
                                                                        class="flex items-center justify-between text-xs font-medium text-[var(--muted)]"
                                                                >
                                                                        <span class="truncate">{it.label}</span>
                                                                        <span>{sliderDisplay(sliderValue(index, it))}</span>
                                                                </label>
                                                                <input
                                                                        type="range"
                                                                        min={it.min ?? 0}
                                                                        max={it.max ?? 1}
                                                                        step={it.step ?? 0.05}
                                                                        value={sliderValue(index, it)}
                                                                        id={sliderInputId(index)}
                                                                        class="mt-2 w-full accent-[var(--brand)]"
                                                                        disabled={it.disabled}
                                                                        onpointerdown={(event) => event.stopPropagation()}
                                                                        onpointerup={(event) => event.stopPropagation()}
                                                                        onclick={(event) => event.stopPropagation()}
                                                                        oninput={(event) => handleSliderInput(index, it, event)}
                                                                />
                                                        </div>
                                                {:else}
                                                        <button
                                                                use:rootRef={index}
                                                                class={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-[var(--panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                                                                        it.danger ? 'text-red-400' : ''
                                                                } ${it.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                                                                role="menuitem"
                                                                type="button"
                                                                aria-haspopup={it.children?.length ? 'menu' : undefined}
                                                                aria-expanded={it.children?.length
                                                                        ? $contextMenu.openSubmenuIndex === index
                                                                        : undefined}
                                                                disabled={it.disabled}
                                                                onpointerenter={() => handleTriggerEnter(index, it)}
                                                                onpointerleave={() => handleTriggerLeave(index)}
                                                                onclick={(event) => handleItemClick(event, it, index)}
                                                        >
                                                                <span class="truncate">{it.label}</span>
                                                                {#if it.children?.length || it.icon}
                                                                        <span class="flex items-center gap-2 pl-2 text-[var(--fg-muted)]">
                                                                                {#if it.children?.length}
                                                                                        <span aria-hidden="true" class="text-xs opacity-70">›</span>
                                                                                {/if}
                                                                                {#if it.icon}
                                                                                        {@const Icon = it.icon}
                                                                                        <Icon class="h-4 w-4 shrink-0 opacity-80" />
                                                                                {/if}
                                                                        </span>
                                                                {/if}
                                                        </button>
                                                {/if}
                                        {/each}
                                </div>
                        </div>
                </div>
                {#if $contextMenu.openSubmenuIndex != null}
                        {#if submenuItems.length}
                                <div
                                        bind:this={submenuEl}
                                        class="pointer-events-auto absolute"
                                        role="menu"
                                        tabindex="-1"
					style={`left:${submenuX}px; top:${submenuY}px`}
					onpointerenter={clearSubmenuCloseTimeout}
					onpointerleave={scheduleSubmenuClose}
					onpointerdown={(e) => e.stopPropagation()}
					oncontextmenu={(e) => e.stopPropagation()}
					onkeydown={onSubmenuKeydown}
				>
					<div class="rounded-lg backdrop-blur-md">
						<div class="panel max-w-[260px] min-w-[200px] rounded-md p-1">
							{#each submenuItems as child, childIndex}
                                                        <button
                                                                use:submenuRef={childIndex}
                                                                class={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-[var(--panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                                                                                child.danger ? 'text-red-400' : ''
                                                                        } ${child.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
									role="menuitem"
									type="button"
									disabled={child.disabled}
									onclick={() => handleSubmenuItemClick(child)}
								>
                                                                        <span class="truncate">{child.label}</span>
                                                                        {#if child.icon}
                                                                                {@const Icon = child.icon}
                                                                                <Icon class="h-4 w-4 shrink-0 text-[var(--fg-muted)] opacity-80" />
                                                                        {/if}
                                                                </button>
                                                        {/each}
                                                </div>
                                        </div>
				</div>
			{/if}
		{/if}
	</div>
{/if}
