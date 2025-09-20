/// <reference types="vitest" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildGuildIconUrl,
	getGuildInitials,
	getGuildName,
	getInviteUnavailableMessage,
	getMemberCountLabel,
	joinGuild,
	type JoinGuildDeps
} from './invite-utils';

vi.mock('$lib/runtime/api', () => ({
	computeApiBase: () => 'https://api.test'
}));

describe('invite-utils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('computes guild initials and member counts', () => {
		const invite = {
			guild: { name: 'Design Collective', icon: 42 },
			members_count: 1250
		} as any;

		expect(getGuildName(invite)).toBe('Design Collective');
		expect(getGuildInitials(invite)).toBe('DC');
		expect(getMemberCountLabel(invite)).toBe('1,250 members');
	});

	it('falls back when guild metadata is missing', () => {
		const invite = { guild: {}, members_count: null } as any;
		expect(getGuildName(invite)).toBe('GoChat community');
		expect(getGuildInitials(invite)).toBe('GC');
		expect(getMemberCountLabel(invite)).toBe('Member count unavailable');
	});

	it('builds the guild icon URL when an icon is present', () => {
		const inviteWithIcon = { guild: { icon: 77 } } as any;
		const inviteWithoutIcon = { guild: {} } as any;

		expect(buildGuildIconUrl(inviteWithIcon)).toBe('https://api.test/attachments/77');
		expect(buildGuildIconUrl(inviteWithoutIcon)).toBeNull();
	});

	it('provides invite availability messaging', () => {
		expect(getInviteUnavailableMessage('ok')).toBeNull();
		expect(getInviteUnavailableMessage('not-found')).toContain('no longer available');
		expect(getInviteUnavailableMessage('error')).toContain('try again later');
	});

	it('joins the guild through the provided dependencies', async () => {
		const deps: JoinGuildDeps = {
			acceptInvite: vi.fn().mockResolvedValue(undefined),
			loadGuilds: vi.fn().mockResolvedValue(undefined),
			goto: vi.fn().mockResolvedValue(undefined)
		};

		const result = await joinGuild('creative', '/app', deps);

		expect(result).toEqual({ success: true });
		expect(deps.acceptInvite).toHaveBeenCalledWith({ inviteCode: 'creative' });
		expect(deps.loadGuilds).toHaveBeenCalled();
		expect(deps.goto).toHaveBeenCalledWith('/app');
	});

	it('returns the API error message when joining fails', async () => {
		const deps: JoinGuildDeps = {
			acceptInvite: vi.fn().mockRejectedValue({
				response: { data: { message: 'Invite expired' } }
			}),
			loadGuilds: vi.fn(),
			goto: vi.fn()
		};

		const result = await joinGuild('expired', '/app', deps);

		expect(result).toEqual({ success: false, message: 'Invite expired' });
		expect(deps.goto).not.toHaveBeenCalled();
	});
});
