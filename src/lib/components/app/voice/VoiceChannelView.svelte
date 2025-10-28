<script lang="ts">
	import VoiceVideoTile from './VoiceVideoTile.svelte';
	import { voiceSession } from '$lib/stores/voice';
	import { auth } from '$lib/stores/auth';
	import { presenceByUser } from '$lib/stores/presence';
	import { membersByGuild } from '$lib/stores/appState';
        import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
        import { resolveAvatarUrl } from '$lib/utils/avatar';
        import { memberInitial, memberPrimaryName, toSnowflakeString } from '$lib/utils/members';
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

        type ParticipantEntry = {
                id: string;
                userId: string | null;
                stream: MediaStream | null;
                videoActive: boolean;
                label: string;
                badge: string | null;
                speaking: boolean;
                avatarUrl: string | null;
                initial: string;
                isSelf: boolean;
        };

        function fallbackInitial(label: string): string {
                return label.trim().charAt(0).toUpperCase() || '?';
        }

        const participants = $derived.by<ParticipantEntry[]>(() => {
                const results: ParticipantEntry[] = [];
                if (!isConnected) return results;

                const state = $voice;
                const presenceMap = ($presence ?? {}) as Record<string, any>;
                const speakingSet = new Set(state.speakingUserIds ?? []);
                const targetChannel = normalizedChannelId;
                const selfId = toSnowflakeString($me?.id) ?? '';

                const memberMap = new Map<string, DtoMember>();
                for (const member of currentMembers()) {
                        const id = toSnowflakeString((member as any)?.user?.id);
                        if (!id) continue;
                        if (!memberMap.has(id)) {
                                memberMap.set(id, member);
                        }
                }

                const entryMap = new Map<string, ParticipantEntry>();

                function ensureEntry(id: string, userId: string | null): ParticipantEntry {
                        const existing = entryMap.get(id);
                        if (existing) return existing;

                        const normalizedUserId = userId ? String(userId) : '';
                        const isSelf = normalizedUserId ? normalizedUserId === selfId : false;
                        const label = displayNameFor(normalizedUserId || null, isSelf);
                        const badge = isSelf ? m.voice_self_label() : null;
                        let avatarUrl: string | null = null;
                        let initial = fallbackInitial(label);

                        if (isSelf) {
                                avatarUrl = resolveAvatarUrl($me);
                                initial = fallbackInitial(label);
                        } else if (normalizedUserId && memberMap.has(normalizedUserId)) {
                                const member = memberMap.get(normalizedUserId) ?? null;
                                avatarUrl = resolveAvatarUrl(member?.user ?? member ?? undefined);
                                initial = memberInitial(member ?? undefined);
                        } else if (normalizedUserId) {
                                const presenceEntry = presenceMap[normalizedUserId];
                                const presenceAvatar = resolveAvatarUrl(presenceEntry?.user ?? presenceEntry ?? undefined);
                                if (presenceAvatar) {
                                        avatarUrl = presenceAvatar;
                                }
                        }

                        const speaking = normalizedUserId ? speakingSet.has(normalizedUserId) : false;
                        const created: ParticipantEntry = {
                                id,
                                userId: normalizedUserId || null,
                                stream: null,
                                videoActive: false,
                                label,
                                badge,
                                speaking,
                                avatarUrl,
                                initial,
                                isSelf
                        };
                        entryMap.set(id, created);
                        return created;
                }

                for (const [userId, info] of Object.entries(presenceMap)) {
                        const normalized = normalizedId(userId);
                        if (!normalized) continue;
                        if (info?.voiceChannelId !== targetChannel) continue;
                        ensureEntry(normalized, normalized);
                }

                if (selfId) {
                        ensureEntry(selfId, selfId);
                }

                const localStream = state.localVideoStream ?? null;
                if (selfId) {
                        const entry = ensureEntry(selfId, selfId);
                        const active = state.cameraEnabled && hasLiveVideo(localStream);
                        entry.stream = active ? localStream : null;
                        entry.videoActive = active;
                }

                for (const remote of state.remoteStreams ?? []) {
                        const stream = remote.stream ?? null;
                        const userId = toSnowflakeString(remote.userId);
                        const key = userId || `remote:${remote.id}`;
                        const entry = ensureEntry(key, userId ?? null);
                        const active = hasLiveVideo(stream);
                        if (active) {
                                entry.stream = stream;
                                entry.videoActive = true;
                        }
                        if (userId) {
                                entry.speaking = entry.speaking || speakingSet.has(userId);
                        }
                }

                for (const entry of entryMap.values()) {
                        results.push(entry);
                }

                results.sort((a, b) => {
                        const videoScore = Number(b.videoActive) - Number(a.videoActive);
                        if (videoScore !== 0) return videoScore;
                        if (a.isSelf && !b.isSelf) return -1;
                        if (!a.isSelf && b.isSelf) return 1;
                        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
                });

                return results;
        });

        let focusedParticipantId = $state<string | null>(null);

        $effect(() => {
                if (!participants.length) {
                        focusedParticipantId = null;
                        return;
                }
                if (focusedParticipantId && participants.some((entry) => entry.id === focusedParticipantId)) {
                        return;
                }
                const firstVideo = participants.find((entry) => entry.videoActive);
                focusedParticipantId = (firstVideo ?? participants[0]).id;
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
        {:else if participants.length === 0}
                <div class="grid flex-1 place-items-center px-6 text-center text-[var(--muted)]">
                        <p class="max-w-md text-sm leading-relaxed">{m.voice_video_empty()}</p>
                </div>
        {:else}
                {@const activeParticipant =
                        participants.find((entry) => entry.id === focusedParticipantId) ?? participants[0]}
                <div class="flex h-full flex-1 flex-col gap-4 overflow-hidden p-4">
                        <div class="flex-1 min-h-0">
                                <div class="flex h-full min-h-0 items-center justify-center">
                                        <VoiceVideoTile
                                                stream={activeParticipant.stream}
                                                videoActive={activeParticipant.videoActive}
                                                label={activeParticipant.label}
                                                badge={activeParticipant.badge}
                                                speaking={activeParticipant.speaking}
                                                avatarUrl={activeParticipant.avatarUrl}
                                                initial={activeParticipant.initial}
                                                variant="primary"
                                        />
                                </div>
                        </div>
                        {#if participants.length > 1}
                                <div class="flex-shrink-0">
                                        <div
                                                class="grid gap-3"
                                                style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));"
                                        >
                                                {#each participants as entry (entry.id)}
                                                        <button
                                                                type="button"
                                                                class="block rounded-lg p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                                                                aria-pressed={entry.id === activeParticipant.id}
                                                                onclick={() => {
                                                                        focusedParticipantId = entry.id;
                                                                }}
                                                        >
                                                                <VoiceVideoTile
                                                                        stream={entry.stream}
                                                                        videoActive={entry.videoActive}
                                                                        label={entry.label}
                                                                        badge={entry.badge}
                                                                        speaking={entry.speaking}
                                                                        avatarUrl={entry.avatarUrl}
                                                                        initial={entry.initial}
                                                                        variant="thumbnail"
                                                                        interactive
                                                                        selected={entry.id === activeParticipant.id}
                                                                />
                                                        </button>
                                                {/each}
                                        </div>
                                </div>
                        {/if}
                </div>
        {/if}
</div>
