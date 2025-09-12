import { writable } from 'svelte/store';

export type ContextMenuItem = {
	label: string;
	action: () => void | Promise<void>;
	danger?: boolean;
	disabled?: boolean;
};

export type ContextMenuState = {
	open: boolean;
	x: number;
	y: number;
	items: ContextMenuItem[];
};

const state = writable<ContextMenuState>({ open: false, x: 0, y: 0, items: [] });

export const contextMenu = {
	subscribe: state.subscribe,
	openAt(clientX: number, clientY: number, items: ContextMenuItem[]) {
		// Store raw cursor position; component will clamp based on actual menu size
		state.set({ open: true, x: clientX, y: clientY, items });
	},
	openFromEvent(e: MouseEvent, items: ContextMenuItem[]) {
		e.preventDefault();
		e.stopPropagation();
		contextMenu.openAt(e.clientX, e.clientY, items);
	},
	close() {
		state.set({ open: false, x: 0, y: 0, items: [] });
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
