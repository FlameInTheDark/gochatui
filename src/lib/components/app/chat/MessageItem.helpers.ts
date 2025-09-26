import type { DtoMember, DtoMessage } from '$lib/api';

export function toSnowflake(value: unknown): string | null {
        if (value == null) return null;
        if (typeof value === 'string') return value;
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'number') {
                try {
                        return BigInt(value).toString();
                } catch {
                        return String(value);
                }
        }
        return null;
}

function normalizeRoleEntry(value: unknown): string | null {
        const candidates: unknown[] = [];

        if (value && typeof value === 'object') {
                const obj = value as any;
                candidates.push(obj?.id, obj?.role_id, obj?.roleId, obj?.role?.id);
        }

        candidates.push(value);

        for (const candidate of candidates) {
                const normalized = toSnowflake(candidate);
                if (normalized) {
                        return normalized;
                }
        }

        for (const candidate of candidates) {
                if (candidate == null) {
                        continue;
                }

                try {
                        const coerced = String(candidate);
                        if (coerced) {
                                return coerced;
                        }
                } catch {
                        // ignore
                }
        }

        return null;
}

export function collectMemberRoleIds(
        member: DtoMember | null | undefined,
        guildId: string | null
): string[] {
        const ids = new Set<string>();
        const roles = (member as any)?.roles;
        const list = Array.isArray(roles) ? roles : [];

        for (const entry of list) {
                const id = normalizeRoleEntry(entry);
                if (id) {
                        ids.add(id);
                }
        }

        if (guildId) {
                ids.add(guildId);
        }

        return Array.from(ids);
}

export function extractAuthorRoleIds(msg: DtoMessage | null | undefined): string[] {
        if (!msg) return [];
        const anyMsg = msg as any;
        const candidates = [
                anyMsg?.member?.roles,
                anyMsg?.member_roles,
                anyMsg?.member?.role_ids,
                anyMsg?.member?.roleIds,
                anyMsg?.memberRoles
        ];

        for (const candidate of candidates) {
                if (!candidate) continue;

                const list = Array.isArray(candidate)
                        ? candidate
                        : typeof candidate[Symbol.iterator] === 'function'
                                ? Array.from(candidate as Iterable<unknown>)
                                : [];

                if (!list.length) continue;

                const normalized: string[] = [];
                for (const value of list) {
                        const id = normalizeRoleEntry(value);
                        if (id) {
                                normalized.push(id);
                        }
                }

                if (normalized.length) {
                        return normalized;
                }
        }

        return [];
}

