import type { Action } from 'svelte/action';
import { CUSTOM_CONTEXT_MENU_ATTR } from '$lib/stores/contextMenu';

type SupportedNode = HTMLElement | SVGElement;

export const customContextMenuTarget: Action<SupportedNode> = (node) => {
        node.setAttribute(CUSTOM_CONTEXT_MENU_ATTR, '');
        return {
                destroy() {
                        node.removeAttribute(CUSTOM_CONTEXT_MENU_ATTR);
                }
        };
};
