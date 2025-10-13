import { get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import {
        activeView,
        channelReady,
        channelsByGuild,
        lastChannelByGuild,
        selectedChannelId,
        selectedGuildId
} from '$lib/stores/appState';
import { appSettings, updateGuildSelectedChannel, type AppSettings } from '$lib/stores/settings';
import { subscribeWS } from '$lib/client/ws';
import { refreshGuildEffectivePermissions } from '$lib/utils/guildPermissionSync';
import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
import {
	loadGuildRolesCached,
	primeGuildChannelRoles,
	pruneChannelRoleCache
} from '$lib/utils/guildRoles';

function toApiSnowflake(value: string): any {
	try {
		return BigInt(value) as any;
	} catch {
		return value as any;
	}
}

function findGuildSelectedChannel(settings: AppSettings, guildId: string): string | null {
        for (const item of settings.guildLayout) {
                if (item.kind === 'guild') {
                        if (item.guildId === guildId) {
                                return item.selectedChannelId ?? null;
			}
			continue;
		}
		const match = item.guilds.find((guild) => guild.guildId === guildId);
		if (match) {
			return match.selectedChannelId ?? null;
		}
	}
        return null;
}

let switchToken = 0;

export async function selectGuild(guildId: string | number | bigint | null | undefined) {
	if (guildId == null) return;
	const gid = String(guildId);
	if (!gid) return;

	const myToken = ++switchToken;

	activeView.set('guild');
        channelReady.set(false);
        selectedChannelId.set(null);
        selectedGuildId.set(gid);

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

		const runtime = get(lastChannelByGuild);
		let remembered = runtime[gid] || '';
		if (!remembered) {
			const stored = findGuildSelectedChannel(get(appSettings), gid);
			if (stored) {
				remembered = stored;
				lastChannelByGuild.update((map) => ({ ...map, [gid]: stored }));
			}
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
			updateGuildSelectedChannel(gid, targetId);
		}
	} catch {
		// ignore errors fetching guild channels
	}
}
