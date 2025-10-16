import { describe, expect, it } from 'vitest';

import { PERMISSION_ADMINISTRATOR } from '$lib/utils/permissions';

import { applyViewChannelOverrides, finalChannelAccessDecision } from './channelOverrides';

const VIEW_CHANNEL = 1 << 0;

describe('channel overrides', () => {
	it('allows members with role-specific overrides despite @everyone deny', () => {
		const guildId = '1111';
		const allowedRoleId = '2231767118620131328';
		const overrides = {
			[guildId]: { accept: 0, deny: VIEW_CHANNEL },
			[allowedRoleId]: { accept: VIEW_CHANNEL, deny: 0 }
		};

		const baseAllowed = false;

		const allowedMember = applyViewChannelOverrides(
			baseAllowed,
			[allowedRoleId],
			guildId,
			overrides,
			VIEW_CHANNEL
		);
		const deniedMember = applyViewChannelOverrides(
			baseAllowed,
			[],
			guildId,
			overrides,
			VIEW_CHANNEL
		);

		const finalAllowed = finalChannelAccessDecision(
			allowedMember,
			0,
			PERMISSION_ADMINISTRATOR,
			null,
			null,
			true
		);
		const finalDenied = finalChannelAccessDecision(
			deniedMember,
			0,
			PERMISSION_ADMINISTRATOR,
			null,
			null,
			true
		);

		expect(finalAllowed).toBe(true);
		expect(finalDenied).toBe(false);
	});

	it('keeps administrators visible even when channel overrides deny access', () => {
		const guildId = 'guild';
		const overrides = {
			[guildId]: { accept: 0, deny: VIEW_CHANNEL }
		};

		const basePermissions = PERMISSION_ADMINISTRATOR;

		const overridden = applyViewChannelOverrides(true, [], guildId, overrides, VIEW_CHANNEL);

		const finalAllowed = finalChannelAccessDecision(
			overridden,
			basePermissions,
			PERMISSION_ADMINISTRATOR,
			null,
			null,
			true
		);

		expect(finalAllowed).toBe(true);
	});
});
