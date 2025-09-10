<script lang="ts">
  import type { DtoMessage } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { selectedChannelId, channelsByGuild, selectedGuildId, channelReady } from '$lib/stores/appState';
  import MessageItem from './MessageItem.svelte';
  import { wsEvent } from '$lib/client/ws';

  let messages = $state<DtoMessage[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let endReached = $state(false);

  let scroller: HTMLDivElement | null = null;
  let wasAtBottom = $state(false);
  let newCount = $state(0);

  function isNearBottom() {
    if (!scroller) return true;
    const distance = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
    return distance < 80;
  }

  function scrollToBottom(smooth = false) {
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller!.scrollTo({ top: scroller!.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  $effect(() => {
    if ($selectedChannelId && $channelReady) {
      // Only load if selectedChannelId exists within current guild's channels
      const gid = $selectedGuildId ?? '';
      const list = $channelsByGuild[gid] ?? [];
      const chan = list.find((c:any) => String(c?.id) === $selectedChannelId);
      if (!chan) return;
      if ((chan as any)?.type === 2) return; // never fetch for category
      messages = [];
      endReached = false;
      (async () => { await loadLatest(); })();
    } else {
      // Clear any stale errors when channel is not ready/selected
      error = null;
      messages = [];
      endReached = false;
    }
  });

  async function loadMore() {
    if (!$selectedChannelId || loading || endReached) return;
    loading = true;
    try {
      const from = messages[0]?.id as any; // oldest loaded id for before (string-safe)
      const res = await auth.api.message.messageChannelChannelIdGet({
        channelId: $selectedChannelId as any,
        from,
        direction: from ? 'before' : undefined,
        limit: 50
      });
      const batch = res.data ?? [];
      if (batch.length === 0) endReached = true;
      messages = [...batch.reverse(), ...messages];
      error = null;
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to load messages';
    } finally {
      loading = false;
    }
  }

  function onSent() {
    // reload latest
    loadLatest();
  }

  async function loadLatest() {
    if (!$selectedChannelId) return;
    try {
      const res = await auth.api.message.messageChannelChannelIdGet({ channelId: $selectedChannelId as any, limit: 50 });
      const batch = res.data ?? [];
      // API returns newest first; display oldest at top, newest at bottom
      messages = [...batch].reverse();
      error = null;
      // On initial load of a channel, stick to bottom
      scrollToBottom(false);
      wasAtBottom = true;
      // On initial load of a channel, stick to bottom
      scrollToBottom(false);
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to load messages';
    }
  }

  export function refresh() {
    loadLatest();
  }

  // Append live messages from websocket when they belong to current channel
  $effect(() => {
    const ev: any = $wsEvent;
    if (!ev || ev.op !== 0 || !ev.d?.message) return;
    const incoming = ev.d.message as DtoMessage & { author_id?: any };
    if (!incoming.channel_id || String((incoming as any).channel_id) !== $selectedChannelId) return;
    // map author if provided under author_id
    if (!incoming.author && (incoming as any).author_id) {
      (incoming as any).author = (incoming as any).author_id;
    }
    const stick = wasAtBottom;
    if (!messages.find((m) => String((m as any).id) === String((incoming as any).id))) {
      messages = [...messages, incoming];
      if (stick) scrollToBottom(true);
      else newCount += 1;
    }
  });
</script>

<div class="relative flex-1 overflow-y-auto" bind:this={scroller} on:scroll={() => { wasAtBottom = isNearBottom(); if (wasAtBottom) newCount = 0; }}>
  <div class="sticky top-0 z-10 bg-[var(--bg)]/70 backdrop-blur px-3 py-2 border-b border-[var(--stroke)]">
    <button class="text-sm underline" disabled={loading || endReached} on:click={loadMore}>
      {endReached ? 'No more messages' : (loading ? 'Loading…' : 'Load older')}
    </button>
  </div>
  {#if error}
    <div class="px-4 text-sm text-red-500">{error}</div>
  {/if}
  {#each messages as m (m.id)}
    <MessageItem message={m} on:deleted={loadLatest} />
  {/each}
</div>

{#if newCount > 0}
  <div class="pointer-events-none relative">
    <div class="pointer-events-auto absolute right-4 bottom-20">
      <button class="px-3 py-1 rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] text-sm shadow" on:click={() => { scrollToBottom(true); newCount = 0; wasAtBottom = true; }}>
        {newCount} new message{newCount === 1 ? '' : 's'} ↓
      </button>
    </div>
  </div>
{/if}
