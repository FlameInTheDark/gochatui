import { writable } from 'svelte/store';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
export type TooltipAlign = 'center' | 'start' | 'end';

export interface TooltipAnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface TooltipState {
	id: number | null;
	visible: boolean;
	content: string;
	placement: TooltipPlacement;
	align: TooltipAlign;
	anchor: TooltipAnchorRect | null;
	getRect: (() => DOMRect | null) | null;
}

const initialState: TooltipState = {
	id: null,
	visible: false,
	content: '',
	placement: 'top',
	align: 'center',
	anchor: null,
	getRect: null
};

function toAnchorRect(rect: DOMRect | null | undefined): TooltipAnchorRect | null {
	if (!rect) return null;
	return {
		left: rect.left,
		top: rect.top,
		right: rect.right,
		bottom: rect.bottom,
		width: rect.width,
		height: rect.height
	};
}

const store = writable<TooltipState>(initialState);

let counter = 0;
let activeId: number | null = null;

export const tooltipState = {
	subscribe: store.subscribe
};

export interface TooltipShowOptions {
	content: string;
	placement?: TooltipPlacement;
	align?: TooltipAlign;
	getRect?: () => DOMRect | null;
}

export interface TooltipUpdateOptions {
	content?: string;
	placement?: TooltipPlacement;
	align?: TooltipAlign;
	getRect?: () => DOMRect | null;
}

export function showTooltip(options: TooltipShowOptions): number {
	const id = ++counter;
	activeId = id;
	const anchor = toAnchorRect(options.getRect?.() ?? null);
	store.set({
		id,
		visible: true,
		content: options.content,
		placement: options.placement ?? 'top',
		align: options.align ?? 'center',
		anchor,
		getRect: options.getRect ?? null
	});
	return id;
}

export function updateTooltip(id: number, options: TooltipUpdateOptions) {
	if (id !== activeId) return;
	store.update((state) => {
		if (state.id !== id) return state;
		const nextGetRect = options.getRect ?? state.getRect;
		const anchor = toAnchorRect(nextGetRect?.() ?? null);
		return {
			id,
			visible: true,
			content: options.content ?? state.content,
			placement: options.placement ?? state.placement,
			align: options.align ?? state.align,
			anchor,
			getRect: nextGetRect ?? null
		} satisfies TooltipState;
	});
}

export function hideTooltip(id?: number) {
	if (id != null && id !== activeId) return;
	activeId = null;
	store.set(initialState);
}

export function repositionTooltip() {
	store.update((state) => {
		if (!state.visible) return state;
		const anchor = toAnchorRect(state.getRect?.() ?? null);
		return {
			...state,
			anchor
		} satisfies TooltipState;
	});
}
