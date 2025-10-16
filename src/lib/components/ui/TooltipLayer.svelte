<script lang="ts">
	import { tooltipState, repositionTooltip } from '$lib/stores/tooltip';
	import type { TooltipState as TooltipData } from '$lib/stores/tooltip';
	import { tick } from 'svelte';

	let tooltipEl: HTMLDivElement | null = null;
	let position = { left: 0, top: 0 };
	let renderedPlacement: TooltipData['placement'] = 'top';

	function clamp(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}

	function arrowClasses(placement: TooltipData['placement']) {
		switch (placement) {
			case 'top':
				return 'left-1/2 -translate-x-1/2 bottom-[-5px] border-t-0 border-l-0';
			case 'bottom':
				return 'left-1/2 -translate-x-1/2 top-[-5px] border-r-0 border-b-0';
			case 'right':
				return 'top-1/2 -translate-y-1/2 left-[-5px] border-t-0 border-r-0';
			case 'left':
				return 'top-1/2 -translate-y-1/2 right-[-5px] border-b-0 border-l-0';
			default:
				return '';
		}
	}

	async function updatePosition(current: TooltipData) {
		if (!current.visible || !current.anchor) {
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
		let top: number;

		if (placement === 'top' || placement === 'bottom') {
			if (current.align === 'start') {
				left = anchor.left;
			} else if (current.align === 'end') {
				left = anchor.right - tooltipRect.width;
			} else {
				left = anchor.left + anchor.width / 2 - tooltipRect.width / 2;
			}

			top =
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
		} else {
			left =
				placement === 'right' ? anchor.right + offset : anchor.left - tooltipRect.width - offset;

			if (current.align === 'start') {
				top = anchor.top;
			} else if (current.align === 'end') {
				top = anchor.bottom - tooltipRect.height;
			} else {
				top = anchor.top + anchor.height / 2 - tooltipRect.height / 2;
			}

			if (
				placement === 'right' &&
				left + tooltipRect.width > viewportWidth - 8 &&
				anchor.left - offset - tooltipRect.width >= 8
			) {
				placement = 'left';
				left = anchor.left - tooltipRect.width - offset;
			} else if (
				placement === 'left' &&
				left < 8 &&
				anchor.right + offset + tooltipRect.width <= viewportWidth - 8
			) {
				placement = 'right';
				left = anchor.right + offset;
			}

			left = clamp(left, 8, viewportWidth - tooltipRect.width - 8);
			top = clamp(top, 8, viewportHeight - tooltipRect.height - 8);
		}

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
					class={`pointer-events-none absolute h-2 w-2 rotate-45 border border-[var(--stroke)] bg-[var(--panel-strong)]/90 ${arrowClasses(renderedPlacement)}`}
				></span>
			</div>
		</div>
	</div>
{/if}
