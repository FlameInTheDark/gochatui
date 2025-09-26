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
import { filterViewableRoleIds } from '$lib/utils/channelRolePermissions';
import { channelAllowListedRoleIds } from '$lib/utils/channelRoles';
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

        it('accepts primitive role IDs when filtering allow-lists', () => {
                const result = filterViewableRoleIds([
                        '5005',
                        6006,
                        7007n,
                        { role_id: '8008', accept: PERMISSION_VIEW_CHANNEL },
                        { roleId: '9009', accept: 0 },
                        { id: '10010', accept: PERMISSION_VIEW_CHANNEL }
                ] as any);

                expect(result).toEqual(['5005', '6006', '7007', '8008', '10010']);
        });

        it('defaults missing accept masks to allow while respecting explicit denies', () => {
                const result = filterViewableRoleIds([
                        { role_id: '13013' },
                        { role_id: '14014', accept: null },
                        { role_id: '15015', accept: undefined },
                        { role_id: '16016', deny: PERMISSION_VIEW_CHANNEL },
                        { role_id: '17017', accept: 0 }
                ] as any);

                expect(result).toEqual(['13013', '14014', '15015']);
        });

        it('falls back to inline channel role allow-lists when API data is unavailable', () => {
                const inlineChannel = {
                        id: channelId,
                        guild_id: guildId,
                        roles: ['11011', { role_id: '12012', accept: PERMISSION_VIEW_CHANNEL }, 13013n]
                } as any;

                const result = channelAllowListedRoleIds(guildId, inlineChannel);

                expect(result).toEqual(['11011', '12012', '13013']);
        });
});
