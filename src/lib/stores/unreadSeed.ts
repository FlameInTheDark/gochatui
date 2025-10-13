import { writable } from 'svelte/store';

const initialSnapshot: unknown = null;

export const unreadSnapshot = writable<unknown>(initialSnapshot);

export function updateUnreadSnapshot(snapshot: unknown): void {
        unreadSnapshot.set(snapshot ?? null);
}
