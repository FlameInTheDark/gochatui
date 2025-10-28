<script lang="ts">
	import VoiceVideoTile from './VoiceVideoTile.svelte';
	import { voiceSession } from '$lib/stores/voice';
	import { auth } from '$lib/stores/auth';
	import { presenceByUser } from '$lib/stores/presence';
	import { membersByGuild } from '$lib/stores/appState';
	import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
	import { memberPrimaryName, toSnowflakeString } from '$lib/utils/members';
	import { m } from '$lib/paraglide/messages.js';
	import type { DtoMember } from '$lib/api';

	const props = $props<{ guildId: string; channelId: string }>();

	const voice = voiceSession;
	const me = auth.user;
	const presence = presenceByUser;
	const guildMembers = membersByGuild;

	const normalizedGuildId = $derived.by(() => normalizedId(props.guildId));
	const normalizedChannelId = $derived.by(() => normalizedId(props.channelId));

	function normalizedId(value: string | null | undefined): string {
		return value ? String(value) : '';
	}

	function currentMembers(): DtoMember[] {
		const gid = normalizedGuildId;
		if (!gid) return [];
		const map = $guildMembers as Record<string, DtoMember[]> | undefined;
		if (!map) return [];
		const list = map[gid];
		return Array.isArray(list) ? list : [];
	}

	function displayNameFor(userId: string | null, isSelf: boolean): string {
		const normalized = normalizedId(userId);
		if (isSelf) {
			const self = $me;
			const candidates = [
				(self as any)?.display_name,
				(self as any)?.global_name,
				(self as any)?.name,
				(self as any)?.username
			];
			for (const candidate of candidates) {
				if (typeof candidate === 'string' && candidate.trim()) {
					return candidate.trim();
				}
			}
			return normalized || m.user_default_name();
		}
		if (!normalized) {
			return m.user_default_name();
		}
		const member = currentMembers().find(
			(item) => toSnowflakeString((item as any)?.user?.id) === normalized
		);
		if (member) {
			const name = memberPrimaryName(member);
			if (name) return name;
		}
		const presenceEntry = ($presence ?? {}) as Record<string, any>;
		const presenceName = presenceEntry[normalized]?.displayName;
		if (typeof presenceName === 'string' && presenceName.trim()) {
			return presenceName.trim();
		}
		return m.user_default_name();
	}

	function hasLiveVideo(stream: MediaStream | null): boolean {
		if (!stream) return false;
		return stream.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled);
	}

	const isConnected = $derived.by(() => {
		const state = $voice;
		if (state.status !== 'connected') return false;
		return (
			normalizedId(state.guildId) === normalizedGuildId &&
			normalizedId(state.channelId) === normalizedChannelId
		);
	});

	type VideoEntry = {
		id: string;
		stream: MediaStream;
		label: string;
		badge: string | null;
		speaking: boolean;
	};

	const videoEntries = $derived.by<VideoEntry[]>(() => {
		const entries: VideoEntry[] = [];
		if (!isConnected) return entries;
		const state = $voice;
		const speakingSet = new Set(state.speakingUserIds ?? []);
		const seen = new Set<string>();
		const selfId = toSnowflakeString($me?.id) ?? '';

		const localStream = state.localVideoStream ?? null;
		if (state.cameraEnabled && hasLiveVideo(localStream)) {
			const id = 'self';
			const label = displayNameFor(selfId, true);
			entries.push({
				id,
				stream: localStream!,
				label,
				badge: m.voice_self_label(),
				speaking: speakingSet.has(selfId)
			});
			seen.add(id);
		}

		for (const remote of state.remoteStreams ?? []) {
			const stream = remote.stream;
			if (!hasLiveVideo(stream)) continue;
			const userId = toSnowflakeString(remote.userId);
			const labelId = userId || String(remote.id);
			const key = stream?.id ? `${labelId}:${stream.id}` : `${labelId}:${remote.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			entries.push({
				id: key,
				stream,
				label: displayNameFor(userId, false),
				badge: null,
				speaking: userId ? speakingSet.has(userId) : false
			});
		}

		return entries;
	});

	$effect(() => {
		if (!isConnected) return;
		const gid = normalizedGuildId;
		if (!gid) return;
		void ensureGuildMembersLoaded(gid);
	});
</script>

<div class="flex h-full flex-col">
	{#if !isConnected}
		<div class="grid flex-1 place-items-center px-6 text-center text-[var(--muted)]">
			<p class="max-w-md text-sm leading-relaxed">{m.voice_video_not_connected()}</p>
		</div>
	{:else if videoEntries.length === 0}
		<div class="grid flex-1 place-items-center px-6 text-center text-[var(--muted)]">
			<p class="max-w-md text-sm leading-relaxed">{m.voice_video_empty()}</p>
		</div>
	{:else}
		<div class="flex-1 overflow-auto p-4">
			<div class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
				{#each videoEntries as entry (entry.id)}
					<VoiceVideoTile
						stream={entry.stream}
						label={entry.label}
						badge={entry.badge}
						speaking={entry.speaking}
					/>
				{/each}
			</div>
		</div>
	{/if}
</div>
