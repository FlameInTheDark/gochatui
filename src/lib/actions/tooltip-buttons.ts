import type { Action } from 'svelte/action';
import { tooltip, type TooltipOptions } from './tooltip';
import type { TooltipAlign, TooltipPlacement } from '$lib/stores/tooltip';

interface TooltipInstance {
        destroy?: () => void;
        update?: (options: TooltipOptions) => void;
}

const placementValues = new Set<TooltipPlacement>(['top', 'bottom', 'left', 'right']);
const alignValues = new Set<TooltipAlign>(['center', 'start', 'end']);

function sanitize(text: string | null | undefined): string | null {
        if (!text) return null;
        const trimmed = text.replace(/\s+/g, ' ').trim();
        if (!trimmed) return null;
        if (trimmed.length > 240) {
                return `${trimmed.slice(0, 237)}…`;
        }
        return trimmed;
}

function parsePlacement(value: string | null | undefined): TooltipPlacement | undefined {
        if (!value) return undefined;
        const normalized = value.toLowerCase() as TooltipPlacement;
        return placementValues.has(normalized) ? normalized : undefined;
}

function parseAlign(value: string | null | undefined): TooltipAlign | undefined {
        if (!value) return undefined;
        const normalized = value.toLowerCase() as TooltipAlign;
        return alignValues.has(normalized) ? normalized : undefined;
}

function parseDelay(value: string | null | undefined): number | undefined {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
}

function findButton(node: Node | null): HTMLButtonElement | null {
        if (!node) return null;
        if (node instanceof HTMLButtonElement) return node;
        if (node instanceof HTMLElement) {
                const closestButton = node.closest('button');
                if (closestButton) {
                        return closestButton;
                }
        }
        return null;
}

function computeOptions(button: HTMLButtonElement): TooltipOptions | null {
        if (button.dataset.tooltipDisabled != null) return null;

        const placement = parsePlacement(button.dataset.tooltipPlacement);
        const align = parseAlign(button.dataset.tooltipAlign);
        const delay = parseDelay(button.dataset.tooltipDelay);
        const hideDelay = parseDelay(button.dataset.tooltipHideDelay);

        function makeOptions(content: string | null): TooltipOptions | null {
                const sanitized = sanitize(content);
                if (!sanitized) return null;
                return {
                        content: sanitized,
                        placement,
                        align,
                        delay,
                        hideDelay
                } satisfies TooltipOptions;
        }

        const dataContent = makeOptions(button.dataset.tooltip ?? null);
        if (dataContent) return dataContent;

        const ariaLabel = makeOptions(button.getAttribute('aria-label'));
        if (ariaLabel) return ariaLabel;

        const title = makeOptions(button.getAttribute('title'));
        if (title) {
                button.removeAttribute('title');
                return title;
        }

        return null;
}

function applyTooltip(button: HTMLButtonElement, instances: Map<HTMLButtonElement, TooltipInstance>) {
        const options = computeOptions(button);
        if (!options) {
                const existing = instances.get(button);
                existing?.destroy?.();
                instances.delete(button);
                return;
        }

        const existing = instances.get(button);
        if (existing) {
                existing.update?.(options);
                return;
        }

        const action = tooltip(button, options);
        instances.set(button, action ?? {});
}

function removeTooltip(button: HTMLButtonElement, instances: Map<HTMLButtonElement, TooltipInstance>) {
        const existing = instances.get(button);
        if (!existing) return;
        existing.destroy?.();
        instances.delete(button);
}

function walkButtons(root: Node, callback: (button: HTMLButtonElement) => void) {
        if (root instanceof HTMLButtonElement) {
                callback(root);
        }
        if (!(root instanceof HTMLElement || root instanceof DocumentFragment)) return;
        const buttons = root.querySelectorAll('button');
        for (const button of buttons) {
                callback(button);
        }
}

export const tooltipButtons: Action<HTMLElement, void> = (node) => {
        const instances = new Map<HTMLButtonElement, TooltipInstance>();

        function handleAdd(root: Node) {
                walkButtons(root, (button) => applyTooltip(button, instances));
        }

        function handleRemove(root: Node) {
                walkButtons(root, (button) => removeTooltip(button, instances));
        }

        handleAdd(node);

        const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                        if (mutation.type === 'childList') {
                                for (const added of mutation.addedNodes) {
                                        handleAdd(added);
                                }
                                for (const removed of mutation.removedNodes) {
                                        handleRemove(removed);
                                }
                        } else if (mutation.type === 'attributes') {
                                const target = findButton(mutation.target);
                                if (target) {
                                        applyTooltip(target, instances);
                                }
                        } else if (mutation.type === 'characterData') {
                                const target = findButton(mutation.target.parentNode);
                                if (target) {
                                        applyTooltip(target, instances);
                                }
                        }
                }
        });

        observer.observe(node, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
                attributeFilter: [
                        'data-tooltip',
                        'data-tooltip-placement',
                        'data-tooltip-align',
                        'data-tooltip-delay',
                        'data-tooltip-hide-delay',
                        'data-tooltip-disabled',
                        'aria-label',
                        'title'
                ]
        });

        return {
                destroy() {
                        observer.disconnect();
                        for (const [, instance] of instances) {
                                instance.destroy?.();
                        }
                        instances.clear();
                }
        };
};
