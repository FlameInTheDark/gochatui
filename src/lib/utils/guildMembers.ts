import { get } from 'svelte/store';
import type { DtoMember } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { membersByGuild } from '$lib/stores/appState';

function toApiSnowflake(value: string): any {
	try {
		return BigInt(value) as any;
	} catch {
		return value as any;
	}
}

const inflightLoads = new Map<string, Promise<DtoMember[]>>();

export function ensureGuildMembersLoaded(guildId: string): Promise<DtoMember[]> {
	const gid = String(guildId ?? '');
	if (!gid) {
		return Promise.resolve([]);
	}

	const cached = get(membersByGuild);
	if (cached && Object.prototype.hasOwnProperty.call(cached, gid)) {
		return Promise.resolve((cached[gid] ?? []) as DtoMember[]);
	}

	const existing = inflightLoads.get(gid);
	if (existing) {
		return existing;
	}

	const wrapped = Promise.resolve(
		auth.api.guild.guildGuildIdMembersGet({ guildId: toApiSnowflake(gid) })
	)
		.then((res) => {
			const list = ((res as any)?.data ?? res ?? []) as DtoMember[];
			membersByGuild.update((value) => ({ ...value, [gid]: list }));
			return list;
		})
		.then(
			(list) => {
				inflightLoads.delete(gid);
				return list;
			},
			(err) => {
				inflightLoads.delete(gid);
				throw err;
			}
		);

	inflightLoads.set(gid, wrapped);
	return wrapped;
}
