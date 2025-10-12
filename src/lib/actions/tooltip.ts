import type { Action } from 'svelte/action';
import {
	hideTooltip,
	repositionTooltip,
	showTooltip,
	type TooltipAlign,
	type TooltipPlacement,
	updateTooltip
} from '$lib/stores/tooltip';

export type TooltipContent = string | (() => string);

export interface TooltipOptions {
	content: TooltipContent;
	placement?: TooltipPlacement;
	align?: TooltipAlign;
	delay?: number;
	hideDelay?: number;
}

interface TooltipState {
	id: number | null;
	options: TooltipOptions;
	showTimeout: ReturnType<typeof setTimeout> | null;
	hideTimeout: ReturnType<typeof setTimeout> | null;
}

function resolveContent(content: TooltipContent): string {
	return typeof content === 'function' ? (content() ?? '') : (content ?? '');
}

function cleanupTimeout(handle: ReturnType<typeof setTimeout> | null) {
	if (handle) {
		clearTimeout(handle);
	}
}

export const tooltip: Action<HTMLElement, TooltipOptions | TooltipContent> = (node, params) => {
	const state: TooltipState = {
		id: null,
		options: normalizeOptions(params),
		showTimeout: null,
		hideTimeout: null
	};
	const pointerDownOptions = { capture: true } as const;

	function normalizeOptions(value: TooltipOptions | TooltipContent): TooltipOptions {
		if (typeof value === 'string' || typeof value === 'function') {
			return { content: value };
		}
		return value ?? { content: '' };
	}

	function show(now = false) {
		cleanupTimeout(state.hideTimeout);
		const delay = now ? 0 : (state.options.delay ?? 120);
		cleanupTimeout(state.showTimeout);
		state.showTimeout = setTimeout(() => {
			const content = resolveContent(state.options.content);
			if (!content) return;
			const id = showTooltip({
				content,
				placement: state.options.placement,
				align: state.options.align,
				getRect: () => node.getBoundingClientRect()
			});
			state.id = id;
			node.setAttribute('data-has-tooltip', 'true');
		}, delay);
	}

	function hide() {
		cleanupTimeout(state.showTimeout);
		const delay = state.options.hideDelay ?? 80;
		cleanupTimeout(state.hideTimeout);
		state.hideTimeout = setTimeout(() => {
			if (state.id != null) {
				hideTooltip(state.id);
				state.id = null;
				node.removeAttribute('data-has-tooltip');
			}
		}, delay);
	}

	function updateContent() {
		if (state.id == null) return;
		const content = resolveContent(state.options.content);
		if (!content) {
			hideTooltip(state.id);
			state.id = null;
			node.removeAttribute('data-has-tooltip');
			return;
		}
		updateTooltip(state.id, {
			content,
			placement: state.options.placement,
			align: state.options.align,
			getRect: () => node.getBoundingClientRect()
		});
		repositionTooltip();
	}

	function handlePointerEnter() {
		show();
	}

	function handlePointerLeave() {
		hide();
	}

	function handleFocus() {
		show(true);
	}

	function handleBlur() {
		hide();
	}

	function handlePointerDown() {
		cleanupTimeout(state.showTimeout);
		cleanupTimeout(state.hideTimeout);
		if (state.id != null) {
			hideTooltip(state.id);
			state.id = null;
			node.removeAttribute('data-has-tooltip');
		}
	}

	node.addEventListener('pointerenter', handlePointerEnter);
	node.addEventListener('pointerleave', handlePointerLeave);
	node.addEventListener('pointerdown', handlePointerDown, pointerDownOptions);
	node.addEventListener('focus', handleFocus);
	node.addEventListener('blur', handleBlur);

	return {
		update(value) {
			state.options = normalizeOptions(value);
			updateContent();
		},
		destroy() {
			cleanupTimeout(state.showTimeout);
			cleanupTimeout(state.hideTimeout);
			if (state.id != null) {
				hideTooltip(state.id);
			}
			node.removeAttribute('data-has-tooltip');
			node.removeEventListener('pointerenter', handlePointerEnter);
			node.removeEventListener('pointerleave', handlePointerLeave);
			node.removeEventListener('pointerdown', handlePointerDown, pointerDownOptions);
			node.removeEventListener('focus', handleFocus);
			node.removeEventListener('blur', handleBlur);
		}
	};
};
