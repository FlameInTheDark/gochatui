import { get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import {
        channelReady,
        channelsByGuild,
        lastChannelByGuild,
        selectedChannelId,
        selectedGuildId
} from '$lib/stores/appState';
import { subscribeWS } from '$lib/client/ws';
import { refreshGuildEffectivePermissions } from '$lib/utils/guildPermissionSync';
import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
import { loadGuildRolesCached } from '$lib/utils/guildRoles';
import { primeGuildChannelRoles, pruneChannelRoleCache } from '$lib/utils/channelRoles';

function toApiSnowflake(value: string): any {
        try {
                return BigInt(value) as any;
        } catch {
                return value as any;
        }
}

function readLastChannels(): Record<string, string> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem('lastChannels');
		const obj = raw ? JSON.parse(raw) : {};
		const out: Record<string, string> = {};
		for (const key in obj) {
			out[String(key)] = String(obj[key]);
		}
		return out;
	} catch {
		return {};
	}
}

function writeLastChannel(guildId: string, channelId: string) {
	if (typeof localStorage === 'undefined') return;
	try {
		const saved = readLastChannels();
		saved[String(guildId)] = String(channelId);
		localStorage.setItem('lastChannels', JSON.stringify(saved));
	} catch {
		/* ignore */
	}
}

function rememberLastGuild(guildId: string) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem('lastGuild', guildId);
	} catch {
		/* ignore */
	}
}

let switchToken = 0;

export async function selectGuild(guildId: string | number | bigint | null | undefined) {
	if (guildId == null) return;
	const gid = String(guildId);
	if (!gid) return;

	const myToken = ++switchToken;

	channelReady.set(false);
	selectedChannelId.set(null);
	selectedGuildId.set(gid);
	rememberLastGuild(gid);

        try {
                const channelRequest = auth.api.guild.guildGuildIdChannelGet({
                        guildId: toApiSnowflake(gid)
                });
                const rolesPromise = loadGuildRolesCached(gid).catch(() => []);
                const membersPromise = ensureGuildMembersLoaded(gid).catch(() => []);

                const res = await channelRequest;
                await Promise.all([rolesPromise, membersPromise]);

                const list = res.data ?? [];

                if (get(selectedGuildId) !== gid || myToken !== switchToken) return;

                channelsByGuild.update((map) => ({ ...map, [gid]: list }));
                pruneChannelRoleCache(gid, list);
                await primeGuildChannelRoles(gid, list).catch(() => {});

                void refreshGuildEffectivePermissions(gid);

		const textChannels = list.filter((channel: any) => channel?.type === 0);

		const saved = readLastChannels();
		let remembered = saved[gid] || '';
		if (!remembered) {
			const map = get(lastChannelByGuild);
			remembered = map[gid];
		}

		const rememberedOk =
			!!remembered &&
			textChannels.some((channel: any) => String(channel?.id) === String(remembered));

		let targetId: string | null = null;
		if (rememberedOk) {
			targetId = String(remembered);
		} else if (textChannels.length > 0) {
			targetId = String((textChannels[0] as any)?.id ?? '');
		}

		if (targetId && get(selectedGuildId) === gid && myToken === switchToken) {
			selectedChannelId.set(targetId);
			subscribeWS([gid], targetId);
			lastChannelByGuild.update((map) => ({ ...map, [gid]: targetId! }));
			channelReady.set(true);
			writeLastChannel(gid, targetId);
		}
	} catch {
		// ignore errors fetching guild channels
	}
}
