import { writable } from 'svelte/store';

export type MentionSnapshot = {
        mentions: unknown;
        channelMentions: unknown;
} | null;

const initialSnapshot: MentionSnapshot = null;

export const mentionSnapshot = writable<MentionSnapshot>(initialSnapshot);

export function updateMentionSnapshot(mentions: unknown, channelMentions: unknown): void {
        if (mentions == null && channelMentions == null) {
                mentionSnapshot.set(null);
                return;
        }
        mentionSnapshot.set({
                mentions: mentions ?? null,
                channelMentions: channelMentions ?? null
        });
}
