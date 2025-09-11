<script lang="ts">
  import { selectedChannelId, channelsByGuild, selectedGuildId, searchOpen, searchAnchor } from '$lib/stores/appState';
  import { tick } from 'svelte';
  import MessageList from './MessageList.svelte';
  import MessageInput from './MessageInput.svelte';
  import { channelReady } from '$lib/stores/appState';
  let listRef: any = null;

  function currentChannel() {
    const gid = $selectedGuildId ?? '';
    return ($channelsByGuild[gid] ?? []).find((c) => String((c as any).id) === $selectedChannelId);
  }
  function channelName() {
    const ch = currentChannel();
    return ch?.name ?? 'Channel';
  }

  function channelTopic() {
    const ch = currentChannel() as any;
    const t = (ch?.topic ?? '').toString().trim();
    return t;
  }
</script>

<div class="flex flex-col h-full min-h-0">
  <div class="h-[var(--header-h)] flex-shrink-0 border-b border-[var(--stroke)] flex items-center justify-between px-3 font-semibold overflow-hidden box-border">
    <div class="flex items-center gap-2 min-w-0">
      <div class="truncate leading-none"># {channelName()}</div>
      {#if channelTopic()}
        <div class="text-sm font-normal text-[var(--muted)] truncate leading-none">&mdash; {channelTopic()}</div>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <button class="w-8 h-8 grid place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
              title="Search"
              aria-label="Search"
              on:click={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                searchAnchor.set({ x: r.right, y: r.bottom });
                searchOpen.set(true);
              }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm-8 6a8 8 0 1 1 14.32 4.906l3.387 3.387-1.414 1.414-3.387-3.387A8 8 0 0 1 2 10z"/></svg>
      </button>
    </div>
  </div>
  {#if $selectedChannelId && $channelReady && (currentChannel() as any)?.type === 0}
    <MessageList bind:this={listRef} />
    <MessageInput />
  {:else}
    <div class="flex-1 grid place-items-center text-[var(--muted)]">Select a text channel to start chatting.</div>
  {/if}
</div>
