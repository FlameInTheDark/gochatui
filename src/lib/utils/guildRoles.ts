import type { DtoRole } from '$lib/api';
import { auth } from '$lib/stores/auth';

const guildRolesResolved = new Map<string, DtoRole[]>();
const guildRolesInFlight = new Map<string, Promise<DtoRole[]>>();

function toApiSnowflake(value: string): any {
        try {
                return BigInt(value) as any;
        } catch {
                return value as any;
        }
}

export async function loadGuildRolesCached(guildId: string): Promise<DtoRole[]> {
        const key = String(guildId);
        if (!key) return [];

        const cached = guildRolesResolved.get(key);
        if (cached) return cached;

        let pending = guildRolesInFlight.get(key);
        if (!pending) {
                pending = auth.api.guildRoles
                        .guildGuildIdRolesGet({ guildId: toApiSnowflake(key) })
                        .then((res) => {
                                const list = ((res as any)?.data ?? res ?? []) as DtoRole[];
                                guildRolesResolved.set(key, list);
                                guildRolesInFlight.delete(key);
                                return list;
                        })
                        .catch((err) => {
                                guildRolesInFlight.delete(key);
                                throw err;
                        });
                guildRolesInFlight.set(key, pending);
        }

        return pending;
}

export function invalidateGuildRolesCache(guildId?: string) {
        if (!guildId) {
                guildRolesResolved.clear();
                guildRolesInFlight.clear();
                return;
        }
        const key = String(guildId);
        guildRolesResolved.delete(key);
        guildRolesInFlight.delete(key);
}
