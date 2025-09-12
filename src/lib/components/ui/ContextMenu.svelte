<script lang="ts">
	import { contextMenu } from '$lib/stores/contextMenu';
	import type { ContextMenuItem } from '$lib/stores/contextMenu';
	import { tick } from 'svelte';

	let menuEl: HTMLDivElement | null = null;
	let posX = $state(0);
	let posY = $state(0);

	function clamp(v: number, min: number, max: number) {
		return Math.max(min, Math.min(max, v));
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
	}

	function onGlobalKey(e: KeyboardEvent) {
		if (e.key === 'Escape') contextMenu.close();
	}

	// Re-clamp position whenever menu opens or its target coords change
	$effect(() => {
		const cm = $contextMenu as any;
		if (cm?.open) {
			updatePosition();
		}
	});
</script>

<svelte:window
	onkeydown={onGlobalKey}
	onclick={() => contextMenu.close()}
	onresize={updatePosition}
/>

{#if $contextMenu.open}
	<div class="pointer-events-none fixed inset-0 z-[1000]">
		<div
			bind:this={menuEl}
			class="pointer-events-auto absolute"
			role="menu"
			tabindex="-1"
			style={`left:${posX}px; top:${posY}px`}
			onclick={(e) => e.stopPropagation()}
			oncontextmenu={(e) => e.stopPropagation()}
		>
			<div class="rounded-lg backdrop-blur-md">
				<div class="panel max-w-[260px] min-w-[200px] rounded-md p-1">
					{#each $contextMenu.items as it}
						<button
							class={`w-full px-3 py-2 text-left text-sm hover:bg-[var(--panel)] ${it.danger ? 'text-red-400' : ''} ${it.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
							disabled={it.disabled}
							onclick={() => {
								contextMenu.close();
								Promise.resolve().then(it.action);
							}}
						>
							{it.label}
						</button>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}
