import { describe, expect, it } from 'vitest';
import { memberHasChannelAccess } from '$lib/utils/memberChannelAccess';
import { collectMemberRoleIds } from '$lib/utils/currentUserRoleIds';
import { PERMISSION_VIEW_CHANNEL, PERMISSION_ADMINISTRATOR } from '$lib/utils/permissions';

describe('memberHasChannelAccess', () => {
	const guildId = '1001';
	const baseChannel = { private: true } as const;
	const baseGuild = { owner: '9999' } as const;

	it('denies members without allow-listed roles in a private channel', () => {
		const member = { user: { id: '101' } } as any;
		const roleIds = ['2002', guildId];
		const result = memberHasChannelAccess({
			member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			roleIds,
			basePermissions: PERMISSION_VIEW_CHANNEL,
			channelOverrides: {},
			allowListedRoleIds: ['3003'],
			viewPermissionBit: PERMISSION_VIEW_CHANNEL
		});

		expect(result).toBe(false);
	});

	it('allows members with an allow-listed role in a private channel', () => {
		const member = { user: { id: '102' } } as any;
		const roleIds = ['3003', guildId];
		const result = memberHasChannelAccess({
			member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			roleIds,
			basePermissions: PERMISSION_VIEW_CHANNEL,
			channelOverrides: {},
			allowListedRoleIds: ['3003'],
			viewPermissionBit: PERMISSION_VIEW_CHANNEL
		});

		expect(result).toBe(true);
	});

        it('allows administrators even without allow-listed roles', () => {
                const member = { user: { id: '103' } } as any;
                const roleIds = ['4004', guildId];
                const result = memberHasChannelAccess({
                        member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			roleIds,
			basePermissions: PERMISSION_ADMINISTRATOR,
			channelOverrides: {},
			allowListedRoleIds: ['3003'],
			viewPermissionBit: PERMISSION_VIEW_CHANNEL
		});

        expect(result).toBe(true);
        });

        it('allows members whose roles are provided as objects with roleId fields', () => {
                const member = {
                        user: { id: '104' },
                        roles: [{ roleId: '5005' }]
                } as any;
                const roleIds = [...collectMemberRoleIds(member), guildId];

                const result = memberHasChannelAccess({
                        member,
                        channel: baseChannel,
                        guild: baseGuild,
                        guildId,
                        roleIds,
                        basePermissions: PERMISSION_VIEW_CHANNEL,
                        channelOverrides: {},
                        allowListedRoleIds: ['5005'],
                        viewPermissionBit: PERMISSION_VIEW_CHANNEL
                });

                expect(result).toBe(true);
        });

        it('allows members whose roles provide nested role.id fields', () => {
                const member = {
                        user: { id: '105' },
                        roles: [{ role: { id: '6006' } }]
                } as any;
                const roleIds = [...collectMemberRoleIds(member), guildId];

                const result = memberHasChannelAccess({
                        member,
                        channel: baseChannel,
                        guild: baseGuild,
                        guildId,
                        roleIds,
                        basePermissions: PERMISSION_VIEW_CHANNEL,
                        channelOverrides: {},
                        allowListedRoleIds: ['6006'],
                        viewPermissionBit: PERMISSION_VIEW_CHANNEL
                });

                expect(result).toBe(true);
        });
});
