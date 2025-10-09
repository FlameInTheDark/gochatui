import { get, writable } from 'svelte/store';
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
        browser: false
}));

vi.mock('$lib/stores/settings', () => {
        return {
                __esModule: true,
                guildChannelReadStateLookup: writable({})
        };
});

vi.mock('$lib/stores/unreadSeed', () => {
        const unreadSnapshot = writable(null);
        return {
                __esModule: true,
                unreadSnapshot,
                updateUnreadSnapshot: unreadSnapshot.set.bind(unreadSnapshot)
        };
});

describe('unread store selection handling', () => {
        beforeEach(async () => {
                vi.resetModules();
                const { selectedGuildId, selectedChannelId, channelsByGuild } = await import(
                        '$lib/stores/appState'
                );
                selectedGuildId.set(null);
                selectedChannelId.set(null);
                channelsByGuild.set({});
        });

        it('keeps channels unread when selecting until acknowledge', async () => {
                const { markChannelUnread, acknowledgeChannelRead, unreadChannelsByGuild } = await import(
                        './unread'
                );
                const { selectedGuildId, selectedChannelId } = await import('$lib/stores/appState');

                markChannelUnread('111', '222', '333');

                expect(get(unreadChannelsByGuild)).toEqual({
                        '111': {
                                '222': { latestMessageId: '333' }
                        }
                });

                selectedGuildId.set('111');
                selectedChannelId.set('222');

                expect(get(unreadChannelsByGuild)).toEqual({
                        '111': {
                                '222': { latestMessageId: '333' }
                        }
                });

                acknowledgeChannelRead('111', '222');

                expect(get(unreadChannelsByGuild)).toEqual({});
        });
});
