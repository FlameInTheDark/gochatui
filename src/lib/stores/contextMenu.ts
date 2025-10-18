import { writable } from 'svelte/store';

export const CUSTOM_CONTEXT_MENU_ATTR = 'data-has-custom-context-menu';

function nodeSupportsCustomContextMenu(node: unknown): boolean {
        if (typeof Element === 'undefined') return false;
        if (!(node instanceof Element)) return false;
        return node.hasAttribute(CUSTOM_CONTEXT_MENU_ATTR);
}

export function eventSupportsCustomContextMenu(event: MouseEvent): boolean {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
        if (Array.isArray(path)) {
                for (const item of path) {
                        if (nodeSupportsCustomContextMenu(item)) {
                                return true;
                        }
                }
        }

        const NodeCtor: typeof Node | undefined = typeof Node !== 'undefined' ? Node : undefined;
        let current: Node | null =
                NodeCtor && event.target instanceof NodeCtor ? event.target : null;
        while (current) {
                if (nodeSupportsCustomContextMenu(current)) {
                        return true;
                }
                current = current.parentNode;
        }

        return false;
}

export type ContextMenuAction = () => void | Promise<void>;

export type ContextMenuItem = {
	label: string;
	action?: ContextMenuAction;
	danger?: boolean;
	disabled?: boolean;
	children?: ContextMenuItem[];
};

export type ContextMenuState = {
	open: boolean;
	x: number;
	y: number;
	items: ContextMenuItem[];
	openSubmenuIndex: number | null;
};

function createInitialState(): ContextMenuState {
	return { open: false, x: 0, y: 0, items: [], openSubmenuIndex: null };
}

const state = writable<ContextMenuState>(createInitialState());

export const contextMenu = {
	subscribe: state.subscribe,
	openAt(clientX: number, clientY: number, items: ContextMenuItem[]) {
		// Store raw cursor position; component will clamp based on actual menu size
		state.set({ open: true, x: clientX, y: clientY, items, openSubmenuIndex: null });
	},
	openFromEvent(e: MouseEvent, items: ContextMenuItem[]) {
		e.preventDefault();
		e.stopPropagation();
		contextMenu.openAt(e.clientX, e.clientY, items);
	},
	openSubmenu(index: number | null) {
		state.update((current) => ({ ...current, openSubmenuIndex: index }));
	},
	closeSubmenu() {
		state.update((current) => ({ ...current, openSubmenuIndex: null }));
	},
	close() {
		state.set(createInitialState());
	}
};

export async function copyToClipboard(text: string) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		try {
			document.execCommand('copy');
		} catch {
			/* empty */
		}
		document.body.removeChild(ta);
	}
}
