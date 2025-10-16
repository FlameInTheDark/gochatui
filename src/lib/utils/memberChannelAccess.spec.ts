import { describe, expect, it } from 'vitest';
import { memberHasChannelAccess } from '$lib/utils/memberChannelAccess';
import { collectMemberRoleIds } from '$lib/utils/currentUserRoleIds';

describe('memberHasChannelAccess', () => {
	const guildId = '1001';
	const baseChannel = { private: true } as const;
	const baseGuild = { owner: '9999' } as const;

	it('denies members without allow-listed roles in a private channel', () => {
		const member = { user: { id: '101' } } as any;
		const memberRoleIds = ['2002', guildId];
		const result = memberHasChannelAccess({
			member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			memberRoleIds,
			channelRoleIds: ['3003']
		});

		expect(result).toBe(false);
	});

	it('allows members with an allow-listed role in a private channel', () => {
		const member = { user: { id: '102' } } as any;
		const memberRoleIds = ['3003', guildId];
		const result = memberHasChannelAccess({
			member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			memberRoleIds,
			channelRoleIds: ['3003']
		});

		expect(result).toBe(true);
	});

	it('allows administrators even without allow-listed roles', () => {
		const member = { user: { id: '103' }, administrator: true } as any;
		const memberRoleIds = ['4004', guildId];
		const result = memberHasChannelAccess({
			member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			memberRoleIds,
			channelRoleIds: ['3003']
		});

		expect(result).toBe(true);
	});

	it('allows members whose roles are provided as objects with roleId fields', () => {
		const member = {
			user: { id: '104' },
			roles: [{ roleId: '5004' }]
		} as any;
		const memberRoleIds = [...collectMemberRoleIds(member), guildId];

		const result = memberHasChannelAccess({
			member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			memberRoleIds,
			channelRoleIds: ['5004']
		});

		expect(result).toBe(true);
	});

	it('allows members whose roles provide nested role.id fields', () => {
		const member = {
			user: { id: '105' },
			roles: [{ role: { id: '5005' } }]
		} as any;
		const baseRoleIds = collectMemberRoleIds(member);
		expect(baseRoleIds).toEqual(['5005']);
		const memberRoleIds = [...baseRoleIds, guildId];
		expect(memberRoleIds).toEqual(['5005', guildId]);

		const result = memberHasChannelAccess({
			member,
			channel: baseChannel,
			guild: baseGuild,
			guildId,
			memberRoleIds,
			channelRoleIds: ['5005']
		});

		expect(result).toBe(true);
	});
});
