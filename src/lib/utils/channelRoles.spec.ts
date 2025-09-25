import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/stores/auth', () => {
        const guildRoles = {
                guildGuildIdChannelChannelIdRolesGet: vi.fn()
        };
        return {
                auth: {
                        api: { guildRoles },
                        guilds: { subscribe: () => () => {} },
                        user: { subscribe: () => () => {} }
                }
        };
});

import { auth } from '$lib/stores/auth';
import { channelRolesByGuild } from '$lib/stores/appState';
import { loadChannelRoleIds, invalidateGuildRolesCache } from '$lib/utils/guildRoles';
import { PERMISSION_VIEW_CHANNEL } from '$lib/utils/permissions';

describe('channel role access filtering', () => {
        const guildId = '1001';
        const channelId = '2002';

        beforeEach(() => {
                invalidateGuildRolesCache();
                channelRolesByGuild.set({});
        });

        afterEach(() => {
                vi.restoreAllMocks();
                invalidateGuildRolesCache();
                channelRolesByGuild.set({});
        });

        it('prevents canAccessChannel from whitelisting roles denied VIEW_CHANNEL', async () => {
                const allowedRoleId = '3003';
                const deniedRoleId = '4004';
                vi.spyOn(auth.api.guildRoles, 'guildGuildIdChannelChannelIdRolesGet').mockResolvedValue({
                        data: [
                                { role_id: guildId, accept: 0, deny: PERMISSION_VIEW_CHANNEL },
                                { role_id: deniedRoleId, accept: 0, deny: PERMISSION_VIEW_CHANNEL },
                                { role_id: allowedRoleId, accept: PERMISSION_VIEW_CHANNEL, deny: 0 }
                        ]
                } as any);

                const roleIds = await loadChannelRoleIds(guildId, channelId);

                expect(roleIds).toEqual([allowedRoleId]);
                const store = get(channelRolesByGuild);
                expect(store[guildId]?.[channelId]).toEqual([allowedRoleId]);
        });
});
