<script lang="ts">
        import type { DtoMember } from '$lib/api';
        import { presenceByUser, type PresenceInfo } from '$lib/stores/presence';
        import { membersByGuild } from '$lib/stores/appState';
        import { auth } from '$lib/stores/auth';
        import {
                voiceSession,
                setRemoteUserMuted,
                setRemoteUserVolume
        } from '$lib/stores/voice';
        import { resolveAvatarUrl } from '$lib/utils/avatar';
        import { memberPrimaryName, memberInitial, toSnowflakeString } from '$lib/utils/members';
        import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
        import { m } from '$lib/paraglide/messages.js';
        import { contextMenu, type ContextMenuItem } from '$lib/stores/contextMenu';
        import { customContextMenuTarget } from '$lib/actions/customContextMenuTarget';

        const props = $props<{ guildId: string; channelId: string; indentClass?: string }>();

        const presenceMap = presenceByUser;
        const guildMembers = membersByGuild;
        const me = auth.user;
        const voice = voiceSession;

        const indentClass = $derived(props.indentClass ?? 'ml-8');

        type ParticipantEntry = {
                userId: string;
                displayName: string;
                avatarUrl: string | null;
                initial: string;
                isSelf: boolean;
                speaking: boolean;
                canControl: boolean;
                volume: number;
                muted: boolean;
        };

        function normalizedId(value: string | null | undefined): string {
                return value ? String(value) : '';
        }

        function currentGuildMembers(): DtoMember[] {
                const gid = normalizedId(props.guildId);
                if (!gid) return [];
                const map = $guildMembers as Record<string, DtoMember[]> | undefined;
                if (!map) return [];
                const list = map[gid];
                return Array.isArray(list) ? list : [];
        }

        function findMember(userId: string): DtoMember | null {
                const list = currentGuildMembers();
                return (
                        list.find((member) => toSnowflakeString((member as any)?.user?.id) === userId) ?? null
                );
        }

        function getParticipants(): ParticipantEntry[] {
                const targetChannel = normalizedId(props.channelId);
                if (!targetChannel) return [];
                const presence = ($presenceMap ?? {}) as Record<string, PresenceInfo>;
                const voiceState = $voice;
                const speakingSet = new Set(voiceState.speakingUserIds ?? []);
                const connectedGuild = normalizedId(voiceState.guildId);
                const connectedChannel = normalizedId(voiceState.channelId);
                const isConnected =
                        voiceState.status === 'connected' &&
                        connectedGuild === normalizedId(props.guildId) &&
                        connectedChannel === targetChannel;
                const remoteSettings = voiceState.remoteSettings ?? {};
                const currentUserId = toSnowflakeString($me?.id);
                const participantMap = new Map<string, ParticipantEntry>();

                function register(userId: string) {
                        const normalized = normalizedId(userId);
                        if (!normalized || participantMap.has(normalized)) return;
                        const member = findMember(normalized);
                        const displayName = memberPrimaryName(member) || `User ${normalized}`;
                        const avatarUrl = resolveAvatarUrl(member?.user, 64);
                        const initial = memberInitial(member);
                        const settings = remoteSettings[normalized] ?? { volume: 1, muted: false };
                        participantMap.set(normalized, {
                                userId: normalized,
                                displayName,
                                avatarUrl,
                                initial,
                                isSelf: normalized === currentUserId,
                                speaking: speakingSet.has(normalized),
                                canControl: isConnected && normalized !== currentUserId,
                                volume: settings.volume ?? 1,
                                muted: settings.muted ?? false
                        });
                }

                for (const [userId, info] of Object.entries(presence)) {
                        if (info?.voiceChannelId !== targetChannel) continue;
                        register(userId);
                }

                return Array.from(participantMap.values()).sort((a, b) =>
                        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
                );
        }

        const participants = $derived(getParticipants());

        $effect(() => {
                const gid = normalizedId(props.guildId);
                if (!gid) return;
                if (participants.length) {
                        void ensureGuildMembersLoaded(gid);
                }
        });

        function openParticipantMenu(event: MouseEvent, entry: ParticipantEntry) {
                if (!entry.canControl) return;
                const items: ContextMenuItem[] = [
                        {
                                type: 'slider',
                                label: m.voice_volume_for({ name: entry.displayName }),
                                value: entry.volume,
                                min: 0,
                                max: 1,
                                step: 0.05,
                                onChange: (value: number) => setRemoteUserVolume(entry.userId, value)
                        },
                        {
                                label: entry.muted ? m.voice_unmute_for_me() : m.voice_mute_for_me(),
                                action: () => setRemoteUserMuted(entry.userId, !entry.muted)
                        }
                ];
                contextMenu.openFromEvent(event, items);
        }
</script>

{#if participants.length}
        <div class={`flex flex-col gap-1 ${indentClass}`}>
                {#each participants as participant (participant.userId)}
                        <button
                                type="button"
                                class={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors ${
                                        participant.canControl ? 'cursor-pointer hover:bg-[var(--panel)]' : 'cursor-default'
                                }`}
                                use:customContextMenuTarget
                                tabindex={participant.canControl ? 0 : -1}
                                aria-disabled={!participant.canControl}
                                oncontextmenu={(event) => openParticipantMenu(event, participant)}
                        >
                                <div
                                        class={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--panel-strong)] text-sm font-semibold text-[var(--fg-muted)] ${
                                                participant.speaking
                                                        ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[var(--sidebar)] outline outline-2 outline-offset-2 outline-[rgba(16,185,129,0.65)]'
                                                        : ''
                                        }`}
                                >
                                        {#if participant.avatarUrl}
                                                <img src={participant.avatarUrl} alt="" class="h-full w-full object-cover" />
                                        {:else}
                                                <span>{participant.initial}</span>
                                        {/if}
                                </div>
                                <div class="min-w-0 flex-1">
                                        <span
                                                class={`truncate ${
                                                        participant.isSelf ? 'font-semibold text-[var(--fg-strong)]' : ''
                                                }`}
                                        >
                                                {participant.displayName}
                                                {#if participant.isSelf}
                                                        <span class="text-[var(--muted)]"> · {m.voice_self_label()}</span>
                                                {/if}
                                        </span>
                                </div>
                        </button>
                {/each}
        </div>
{/if}
