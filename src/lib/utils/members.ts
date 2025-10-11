import type { DtoMember, DtoRole } from '$lib/api';
import { m } from '$lib/paraglide/messages.js';
import { colorIntToHex } from './color';
import { collectMemberRoleIds as baseCollectMemberRoleIds } from './currentUserRoleIds';

export function toSnowflakeString(value: unknown): string | null {
        if (value == null) return null;
        try {
                if (typeof value === 'string') return value;
                if (typeof value === 'bigint') return value.toString();
                if (typeof value === 'number') return BigInt(value).toString();
                return String(value);
        } catch {
                try {
                        return String(value);
                } catch {
                        return null;
                }
        }
}

export function memberPrimaryName(member: DtoMember | null | undefined): string {
        if (!member) return m.user_default_name();
        const nickname = (member as any)?.username;
        if (typeof nickname === 'string' && nickname.trim()) return nickname.trim();
        const userName = (member as any)?.user?.name;
        if (typeof userName === 'string' && userName.trim()) return userName.trim();
        const id = toSnowflakeString((member as any)?.user?.id);
        if (id) return `${m.user_default_name()} ${id}`;
        return m.user_default_name();
}

export function memberSecondaryName(member: DtoMember | null | undefined): string {
        if (!member) return '';
        const primary = memberPrimaryName(member);
        const userName = (member as any)?.user?.name;
        if (typeof userName === 'string') {
                const trimmed = userName.trim();
                if (trimmed && trimmed !== primary) {
                        return trimmed;
                }
        }
        const discriminator = (member as any)?.user?.discriminator;
        if (typeof discriminator === 'string' && discriminator.trim()) {
                return discriminator.trim();
        }
        return '';
}

export function memberInitial(member: DtoMember | null | undefined): string {
        const primary = memberPrimaryName(member);
        return primary.trim().charAt(0).toUpperCase() || '?';
}

export function collectMemberRoleIds(
        member: DtoMember | null | undefined,
        guildId: string | null
): string[] {
        const seen = new Set<string>();
        const result: string[] = [];

        const rawRoles = Array.isArray((member as any)?.roles) ? (member as any).roles : [];
        for (const entry of rawRoles) {
                const nestedId = toSnowflakeString((entry as any)?.role?.id);
                if (!nestedId || seen.has(nestedId)) continue;
                seen.add(nestedId);
                result.push(nestedId);
        }

        for (const roleId of baseCollectMemberRoleIds(member ?? undefined)) {
                if (seen.has(roleId)) continue;
                seen.add(roleId);
                result.push(roleId);
        }

        if (guildId && !seen.has(guildId)) {
                seen.add(guildId);
                result.push(guildId);
        }

        return result;
}

export function buildRoleMap(list: DtoRole[]): Record<string, DtoRole> {
        const map: Record<string, DtoRole> = {};
        for (const role of list) {
                const id = toSnowflakeString((role as any)?.id);
                if (!id) continue;
                map[id] = role;
        }
        return map;
}

export function resolveMemberRoleColor(
        member: DtoMember | null | undefined,
        guildId: string | null,
        roleMap: Record<string, DtoRole>
): string | null {
        const roleIds = collectMemberRoleIds(member, guildId);
        if (!roleIds.length) return null;

        const orderedRoleIds: string[] = [];
        const seen = new Set<string>();
        const appendUnique = (value: string | null | undefined) => {
                if (value == null) return;
                const normalized = String(value);
                if (!normalized || seen.has(normalized)) return;
                seen.add(normalized);
                orderedRoleIds.push(normalized);
        };

        for (const id of roleIds) {
                appendUnique(id);
        }
        appendUnique(guildId);

        for (const id of orderedRoleIds) {
                const role = roleMap[id];
                if (!role) continue;
                const rawColor = (role as any)?.color;
                if (rawColor == null) continue;
                return colorIntToHex(rawColor as number | string | bigint | null);
        }

        return null;
}
