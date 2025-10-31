import { browser } from '$app/environment';

import type {
        DropIntent,
        FolderItem,
        GuildItem,
        ServerBarState,
        ServerItem
} from './types';

export const DEFAULT_STORAGE_KEY = 'serverbar-state-v6';

export function createSeedState(): ServerBarState {
        return {
                items: [
                        createGuild('g-arc', 'Arcane Labs', '#5865F2', true, 0, 'A'),
                        createGuild('g-gam', 'Game Dev', '#e67e22', false, 12, 'G'),
                        createFolder('f-social', 'Social', '#3BA55D', [
                                createGuild('g-music', 'Music Den', '#eb459e', true, 2, 'M'),
                                createGuild('g-cats', 'Cat Pics', '#ed4245', false, 0, 'C'),
                                createGuild('g-js', 'JS Hangout', '#faa61a', true, 0, 'J')
                        ]),
                        createGuild('g-work', 'Work', '#1abc9c', false, 0, 'W'),
                        createGuild('g-oss', 'Open Source', '#7289da', true, 4, 'O')
                ]
        };
}

export function createGuild(
        id: string,
        name: string,
        color: string,
        unread = false,
        mentions = 0,
        letter?: string
): GuildItem {
        return {
                type: 'guild',
                id,
                name,
                color,
                unread,
                mentions,
                letter: letter ?? name.charAt(0).toUpperCase()
        };
}

export function createFolder(
        id: string,
        name: string,
        color: string,
        children: ServerItem[] = [],
        collapsed = true
): FolderItem {
        return {
                type: 'folder',
                id,
                name,
                color,
                children,
                collapsed
        };
}

export function cloneState<T>(value: T): T {
        if (typeof structuredClone === 'function') {
                return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value)) as T;
}

export function loadState(storageKey: string, seed: ServerBarState): ServerBarState {
        if (!browser) return cloneState(seed);
        try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) return cloneState(seed);
                const parsed = JSON.parse(raw) as ServerBarState;
                if (!parsed?.items) return cloneState(seed);
                return parsed;
        } catch (error) {
                console.warn('[server-bar] failed to parse stored state', error);
                return cloneState(seed);
        }
}

export function saveState(storageKey: string, state: ServerBarState) {
        if (!browser) return;
        try {
                localStorage.setItem(storageKey, JSON.stringify(state));
        } catch (error) {
                console.warn('[server-bar] failed to persist state', error);
        }
}

export interface FindResult {
        item: ServerItem;
        parent: FolderItem | null;
        index: number;
        items: ServerItem[];
}

export function findWithParent(
        items: ServerItem[],
        id: string,
        parent: FolderItem | null = null
): FindResult | null {
        for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                if (!item) continue;
                if (item.id === id) {
                        return { item, parent, index, items };
                }
                if (item.type === 'folder') {
                        const result = findWithParent(item.children, id, item);
                        if (result) return result;
                }
        }
        return null;
}

export function findPathTo(
        items: ServerItem[],
        id: string,
        path: string[] = []
): string[] | null {
        for (const item of items) {
                if (item.id === id) {
                        return [...path, item.id];
                }
                if (item.type === 'folder') {
                        const inner = findPathTo(item.children, id, [...path, item.id]);
                        if (inner) return inner;
                }
        }
        return null;
}

export function removeById(
        state: ServerBarState,
        id: string,
        options: { preserveFolder?: boolean } = {}
): ServerItem | null {
        const { preserveFolder = false } = options;
        const result = findWithParent(state.items, id);
        if (!result) return null;
        const removed = result.items.splice(result.index, 1)[0] ?? null;
        if (!removed) return null;

        if (!preserveFolder && result.parent && result.parent.type === 'folder') {
                if (result.parent.children.length === 0) {
                        const parentInfo = findWithParent(state.items, result.parent.id);
                        if (parentInfo) parentInfo.items.splice(parentInfo.index, 1);
                } else if (result.parent.children.length === 1) {
                        const onlyChild = result.parent.children[0];
                        const parentInfo = findWithParent(state.items, result.parent.id);
                        if (parentInfo) parentInfo.items.splice(parentInfo.index, 1, onlyChild);
                }
        }

        return removed;
}

export function normalizeFolders(items: ServerItem[]) {
        for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                if (!item) continue;
                if (item.type === 'folder') {
                        normalizeFolders(item.children);
                        if (item.children.length === 0) {
                                items.splice(index, 1);
                                index -= 1;
                                continue;
                        }
                        if (item.children.length === 1) {
                                items.splice(index, 1, item.children[0]);
                                index -= 1;
                                continue;
                        }
                }
        }
}

export function insertAt<T>(target: T[], index: number, value: T) {
        if (index < 0 || index > target.length) {
                target.splice(target.length, 0, value);
                return;
        }
        target.splice(index, 0, value);
}

export function addToFolder(folder: FolderItem, item: ServerItem, index?: number): boolean {
        if (item.type === 'folder') return false;
        const insertIndex = typeof index === 'number' && index >= 0 ? index : folder.children.length;
        insertAt(folder.children, insertIndex, item);
        return true;
}

export function createFolderFromTwo(
        state: ServerBarState,
        idA: string,
        idB: string,
        insertIndex?: number
) {
        const infoA = findWithParent(state.items, idA);
        const infoB = findWithParent(state.items, idB);
        if (!infoA || !infoB) return;
        if (infoA.item.type !== 'guild' || infoB.item.type !== 'guild') {
                const moved = removeById(state, idA, { preserveFolder: true });
                const targetInfo = findWithParent(state.items, idB);
                const index = targetInfo ? targetInfo.index : state.items.length;
                if (moved) insertAt(state.items, index, moved);
                normalizeFolders(state.items);
                return;
        }

        const guildA = removeById(state, idA, { preserveFolder: true });
        const guildB = removeById(state, idB, { preserveFolder: true });
        if (!guildA || !guildB) {
                if (guildA) insertAt(state.items, state.items.length, guildA);
                if (guildB) insertAt(state.items, state.items.length, guildB);
                return;
        }

        const folder = createFolder(
                `f-${Math.random().toString(36).slice(2, 7)}`,
                'Folder',
                pickColor(),
                [guildB, guildA],
                true
        );
        const index = typeof insertIndex === 'number' ? insertIndex : state.items.length;
        insertAt(state.items, index, folder);
        normalizeFolders(state.items);
}

export function pickColor(): string {
        const palette = [
                '#3BA55D',
                '#ED4245',
                '#5865F2',
                '#FAA61A',
                '#EB459E',
                '#57F287',
                '#FEE75C',
                '#A6D189',
                '#74C7EC'
        ];
        return palette[Math.floor(Math.random() * palette.length)] ?? '#5865F2';
}

export function hexToRgba(hex: string, alpha: number): string {
        if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) {
                return `rgba(255,255,255,${alpha})`;
        }
        const normalized = hex.replace('#', '');
        const r = parseInt(normalized.slice(0, 2), 16);
        const g = parseInt(normalized.slice(2, 4), 16);
        const b = parseInt(normalized.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function computeIntent(y: number, height: number): DropIntent {
        const edge = 18;
        if (y < edge) return 'before';
        if (y > height - edge) return 'after';
        return 'into';
}

export function getDragId(event: DragEvent, fallbackId: string | null): string | null {
        try {
                return (
                        event.dataTransfer?.getData('text/x-serverbar-id') ||
                        event.dataTransfer?.getData('text/plain') ||
                        fallbackId ||
                        null
                );
        } catch {
                return fallbackId;
        }
}
