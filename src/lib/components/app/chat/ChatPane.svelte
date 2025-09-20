<script lang="ts">
  import { selectedChannelId, channelsByGuild, selectedGuildId, searchOpen, searchAnchor } from '$lib/stores/appState';
  import { tick } from 'svelte';
  import { m } from '$lib/paraglide/messages.js';
  import MessageList from './MessageList.svelte';
  import MessageInput from './MessageInput.svelte';
  import { channelReady } from '$lib/stores/appState';
  import { Search } from 'lucide-svelte';
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
        <Search class="h-4 w-4" stroke-width={2} />
      </button>
    </div>
  </div>
  {#if $selectedChannelId && $channelReady && (currentChannel() as any)?.type === 0}
    <MessageList bind:this={listRef} />
    <MessageInput />
  {:else}
    <div class="flex-1 grid place-items-center text-[var(--muted)]">{m.select_text_channel()}</div>
  {/if}
</div>
