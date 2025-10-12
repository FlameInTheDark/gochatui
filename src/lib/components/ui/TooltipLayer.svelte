<script lang="ts">
	import { tooltipState, repositionTooltip } from '$lib/stores/tooltip';
	import type { TooltipState as TooltipData } from '$lib/stores/tooltip';
	import { tick } from 'svelte';

	let tooltipEl: HTMLDivElement | null = null;
	let position = { left: 0, top: 0 };
	let renderedPlacement: 'top' | 'bottom' = 'top';

	function clamp(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}

	async function updatePosition(current: TooltipData) {
		if (!current.visible || !tooltipEl || !current.anchor) {
			return;
		}
		await tick();
		if (!tooltipEl) return;

		const tooltipRect = tooltipEl.getBoundingClientRect();
		let placement = current.placement;
		const anchor = current.anchor;
		const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : tooltipRect.width;
		const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : tooltipRect.height;
		const offset = 10;

		let left: number;
		if (current.align === 'start') {
			left = anchor.left;
		} else if (current.align === 'end') {
			left = anchor.right - tooltipRect.width;
		} else {
			left = anchor.left + anchor.width / 2 - tooltipRect.width / 2;
		}

		let top =
			placement === 'bottom' ? anchor.bottom + offset : anchor.top - tooltipRect.height - offset;

		if (
			placement === 'top' &&
			top < 8 &&
			anchor.bottom + offset + tooltipRect.height <= viewportHeight - 8
		) {
			placement = 'bottom';
			top = anchor.bottom + offset;
		} else if (
			placement === 'bottom' &&
			top + tooltipRect.height > viewportHeight - 8 &&
			anchor.top - offset - tooltipRect.height >= 8
		) {
			placement = 'top';
			top = anchor.top - tooltipRect.height - offset;
		}

		left = clamp(left, 8, viewportWidth - tooltipRect.width - 8);
		top = clamp(top, 8, viewportHeight - tooltipRect.height - 8);

		position = { left: Math.round(left), top: Math.round(top) };
		renderedPlacement = placement;
	}

	$: if ($tooltipState.visible) {
		void updatePosition($tooltipState);
	}

	function handleWindowChange() {
		repositionTooltip();
		if ($tooltipState.visible) {
			void updatePosition($tooltipState);
		}
	}
</script>

<svelte:window onresize={handleWindowChange} onscroll={handleWindowChange} />

{#if $tooltipState.visible}
	<div class="pointer-events-none fixed inset-0 z-[1200]">
		<div class="absolute" style={`left:${position.left}px; top:${position.top}px;`}>
			<div
				bind:this={tooltipEl}
				class="pointer-events-none relative max-w-xs rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)]/90 px-3 py-1.5 text-xs font-medium text-[var(--text)] shadow-[var(--shadow-2)] backdrop-blur-md"
				role="tooltip"
			>
				{$tooltipState.content}
				<span
					class={`pointer-events-none absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border border-[var(--stroke)] bg-[var(--panel-strong)]/90 ${
						renderedPlacement === 'top'
							? 'bottom-[-5px] border-t-0 border-l-0'
							: 'top-[-5px] border-r-0 border-b-0'
					}`}
				></span>
			</div>
		</div>
	</div>
{/if}
