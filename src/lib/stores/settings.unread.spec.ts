import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derived, get, writable } from 'svelte/store';

vi.mock('$app/environment', () => ({
        browser: false
}));

vi.mock(
        '$lib/paraglide/runtime',
        () => ({
                setLocale: vi.fn()
        }),
        { virtual: true }
);

const userMeSettingsGet = vi.fn();
const userMeSettingsPost = vi.fn();

vi.mock('$lib/stores/auth', () => {
        const token = writable<string | null>(null);
        const guilds = writable<any[]>([]);
        const isAuthenticated = derived(token, (value) => Boolean(value));
        const ingestGuilds = vi.fn((list: unknown) => {
                const next = Array.isArray(list) ? list : [];
                guilds.set(next as any);
                return next as any;
        });

        return {
                auth: {
                        token,
                        guilds,
                        isAuthenticated,
                        ingestGuilds,
                        api: {
                                user: {
                                        userMeSettingsGet,
                                        userMeSettingsPost
                                }
                        }
                }
        };
});

describe('settings unread snapshot integration', () => {
        beforeEach(async () => {
                userMeSettingsGet.mockReset();
                userMeSettingsPost.mockReset();
                const { auth } = await import('$lib/stores/auth');
                auth.token.set(null);
                auth.guilds.set([]);
                const { updateUnreadSnapshot } = await import('$lib/stores/unreadSeed');
                updateUnreadSnapshot(null);
        });

        afterEach(async () => {
                const { auth } = await import('$lib/stores/auth');
                auth.token.set(null);
                const { updateUnreadSnapshot } = await import('$lib/stores/unreadSeed');
                updateUnreadSnapshot(null);
        });

        it('prefers guilds_last_messages payloads for unread snapshot seeding', async () => {
                const guildsLastMessages = {
                        '111': {
                                '222': '333'
                        }
                };
                userMeSettingsGet.mockResolvedValueOnce({
                        status: 200,
                        data: {
                                guilds_last_messages: guildsLastMessages,
                                settings: null
                        }
                });

                const { unreadSnapshot } = await import('$lib/stores/unreadSeed');
                const { auth } = await import('$lib/stores/auth');
                await import('./settings');

                auth.token.set('token');
                await new Promise((resolve) => setTimeout(resolve, 0));

                expect(userMeSettingsGet).toHaveBeenCalledTimes(1);
                expect(get(unreadSnapshot)).toEqual(guildsLastMessages);
        });
});
