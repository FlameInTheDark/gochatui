import { describe, expect, it } from 'vitest';

import { collectMemberRoleIds, resolveCurrentUserRoleIds } from '$lib/utils/currentUserRoleIds';

describe('resolveCurrentUserRoleIds', () => {
	const guildId = '1234';
	const currentUserId = '5678';

	it('uses fallback roles when member data is unavailable', () => {
		const fallbackRoles = ['9999'];

		const result = resolveCurrentUserRoleIds({
			guildId,
			members: undefined,
			currentUserId,
			fallbackRoleIds: fallbackRoles
		});

		expect(Array.from(result).sort()).toEqual(['1234', '9999']);
		expect(result.has('9999')).toBe(true);
	});

	it('merges fallback roles with roles from the member list', () => {
		const fallbackRoles = ['1111'];
		const members = [
			{
				user: { id: currentUserId },
				roles: ['2222', { id: '3333' }, { role_id: '1111' }]
			}
		] as any;

		const result = resolveCurrentUserRoleIds({
			guildId,
			members,
			currentUserId,
			fallbackRoleIds: fallbackRoles
		});

		expect(Array.from(result).sort()).toEqual(['1111', '1234', '2222', '3333']);
	});

        it('normalizes mixed identifier types and removes duplicates', () => {
                const fallbackRoles = new Set<unknown>(['4444', 5555, 6666n]);
                const members = [
                        {
                                user: { id: currentUserId },
				roles: ['4444', { id: 5555 }, { role_id: 7777n }]
			}
		] as any;

		const result = resolveCurrentUserRoleIds({
			guildId,
			members,
			currentUserId,
			fallbackRoleIds: fallbackRoles
		});

                expect(Array.from(result).sort()).toEqual(['1234', '4444', '5555', '6666', '7777']);
        });

        it('collectMemberRoleIds handles roleId properties on role objects', () => {
                const member = {
                        user: { id: currentUserId },
                        roles: [
                                { roleId: '8888' },
                                { id: '9999' },
                                { role_id: '7777' },
                                '6666'
                        ]
                } as any;

                const result = collectMemberRoleIds(member);

                expect(result.sort()).toEqual(['6666', '7777', '8888', '9999']);
        });

        it('collectMemberRoleIds handles nested role objects', () => {
                const member = {
                        user: { id: currentUserId },
                        roles: [{ role: { id: '5005' } }]
                } as any;

                const result = collectMemberRoleIds(member);

                expect(result).toEqual(['5005']);
        });
});
