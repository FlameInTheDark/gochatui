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
import { channelAllowListedRoleIds, invalidateChannelRoleIds } from '$lib/utils/channelRoles';

describe('channel role access normalization', () => {
        const guildId = '1001';
        const channelId = '2002';

        beforeEach(() => {
                invalidateChannelRoleIds(guildId);
                invalidateGuildRolesCache();
                channelRolesByGuild.set({});
        });

        afterEach(() => {
                vi.restoreAllMocks();
                invalidateChannelRoleIds(guildId);
                invalidateGuildRolesCache();
                channelRolesByGuild.set({});
        });

        it('retains all role IDs from API responses in loadChannelRoleIds', async () => {
                const roleA = '3003';
                const roleB = '4004';
                const everyone = guildId;
                vi.spyOn(auth.api.guildRoles, 'guildGuildIdChannelChannelIdRolesGet').mockResolvedValue({
                        data: [
                                { role_id: everyone, accept: 0, deny: 1 },
                                { role_id: roleB, accept: 0, deny: 1 },
                                { role_id: roleA, accept: 1, deny: 0 }
                        ]
                } as any);

                const roleIds = await loadChannelRoleIds(guildId, channelId);

                expect(roleIds).toEqual([everyone, roleB, roleA]);
                const store = get(channelRolesByGuild);
                expect(store[guildId]?.[channelId]).toEqual([everyone, roleB, roleA]);
        });

        it('normalizes primitive role IDs from inline channel data', () => {
                const inlineChannel = {
                        id: channelId,
                        guild_id: guildId,
                        roles: ['11011', 12012, 13013n, { role: { id: '14014' } }]
                } as any;

                const result = channelAllowListedRoleIds(guildId, inlineChannel);

                expect(result).toEqual(['11011', '12012', '13013', '14014']);
        });

        it('falls back to inline channel role allow-lists when API data is unavailable', () => {
                const inlineChannel = {
                        id: channelId,
                        guild_id: guildId,
                        roles: [
                                '11011',
                                { role: { id: '12012' } },
                                { role_id: '13013' },
                                14014n
                        ]
                } as any;

                const result = channelAllowListedRoleIds(guildId, inlineChannel);

                expect(result).toEqual(['11011', '12012', '13013', '14014']);
        });
});
