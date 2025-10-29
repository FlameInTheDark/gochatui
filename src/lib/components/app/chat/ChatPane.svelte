<script lang="ts">
	import {
		selectedChannelId,
		channelsByGuild,
		selectedGuildId,
		searchOpen,
		searchAnchor,
		membersByGuild
	} from '$lib/stores/appState';
	import { m } from '$lib/paraglide/messages.js';
	import MessageList from './MessageList.svelte';
	import MessageInput from './MessageInput.svelte';
	import { channelReady } from '$lib/stores/appState';
	import { Search } from 'lucide-svelte';
	import MemberPane from './MemberPane.svelte';
	import { ensureGuildMembersLoaded } from '$lib/utils/guildMembers';
	import VoiceChannelView from '$lib/components/app/voice/VoiceChannelView.svelte';
	import { voicePanelChannelId } from '$lib/stores/voice';
	let listRef: any = $state(null);

	const voicePanelChannel = voicePanelChannelId;

	function channelById(id: string | null | undefined) {
		const gid = $selectedGuildId ?? '';
		if (!gid || !id) return undefined;
		return ($channelsByGuild[gid] ?? []).find((c) => String((c as any).id) === String(id));
	}
	function currentChannel() {
		return channelById($selectedChannelId);
	}
	function channelName() {
		const ch = activeChannelValue as any;
		return ch?.name ?? 'Channel';
	}

	function channelTopic() {
		const ch = activeChannelValue as any;
		const t = (ch?.topic ?? '').toString().trim();
		if (Number((ch as any)?.type ?? 0) !== 0) return '';
		return t;
	}

	const selectedChannelValue = $derived.by(() => currentChannel() as any);
	const voiceChannelValue = $derived.by(() => channelById($voicePanelChannel) as any);
	const showVoicePanel = $derived.by(
		() => Boolean($voicePanelChannel && Number((voiceChannelValue as any)?.type ?? 0) === 1)
	);
	const activeChannelValue = $derived.by(() => (showVoicePanel ? voiceChannelValue : selectedChannelValue));

	$effect(() => {
		const gid = $selectedGuildId ?? '';
		if (!gid) return;
		const map = $membersByGuild;
		if (map && Object.prototype.hasOwnProperty.call(map, gid)) {
			return;
		}
		ensureGuildMembersLoaded(gid).catch(() => {});
	});
</script>

<div class="flex h-full min-h-0">
	<div class="flex min-w-0 flex-1 flex-col">
		<div
			class="box-border flex h-[var(--header-h)] flex-shrink-0 items-center justify-between overflow-hidden border-b border-[var(--stroke)] px-3 font-semibold"
		>
			<div class="flex min-w-0 items-center gap-2">
				<div class="truncate leading-none"># {channelName()}</div>
				{#if channelTopic()}
					<div class="truncate text-sm leading-none font-normal text-[var(--muted)]">
						&mdash; {channelTopic()}
					</div>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<button
					class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
					aria-label="Search"
					onclick={(e) => {
						e.stopPropagation();
						const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
						searchAnchor.set({ x: r.right, y: r.bottom });
						searchOpen.set(true);
					}}
				>
					<Search class="h-4 w-4" stroke-width={2} />
				</button>
			</div>
		</div>
		{#if showVoicePanel}
			<VoiceChannelView guildId={$selectedGuildId ?? ''} channelId={$voicePanelChannel ?? ''} />
		{:else if $selectedChannelId && $channelReady && (selectedChannelValue?.type ?? 0) === 0}
			<MessageList bind:this={listRef} />
			<MessageInput />
		{:else}
			<div class="grid flex-1 place-items-center text-[var(--muted)]">
				{m.select_text_channel()}
			</div>
		{/if}
	</div>
	<MemberPane />
</div>
