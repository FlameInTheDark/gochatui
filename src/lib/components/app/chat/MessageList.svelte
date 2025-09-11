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
  let initialLoaded = $state(false);

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

  function toDate(s?: string): Date | null { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; }
  function sameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function humanDate(d: Date) {
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  }

  function authorKey(a: any): string | null {
    if (a == null) return null;
    const t = typeof a;
    if (t === 'number' || t === 'string') return String(a);
    if (t === 'object') {
      if ((a as any).id != null) return String((a as any).id);
      if ((a as any).name) return String((a as any).name);
    }
    return null;
  }

  $effect(() => {
    if ($selectedChannelId && $channelReady) {
      const gid = $selectedGuildId ?? '';
      const list = $channelsByGuild[gid] ?? [];
      const chan = list.find((c:any) => String(c?.id) === $selectedChannelId);
      if (!chan) return;
      if ((chan as any)?.type === 2) return;
      messages = [];
      endReached = false;
      (async () => { await loadLatest(); initialLoaded = true; })();
    } else {
      error = null;
      messages = [];
      endReached = false;
    }
  });

  async function loadMore() {
    if (!$selectedChannelId || loading || endReached) return;
    loading = true;
    try {
      const from = messages[0]?.id as any;
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
    loadLatest();
  }

  async function loadLatest() {
    if (!$selectedChannelId) return;
    try {
      const res = await auth.api.message.messageChannelChannelIdGet({ channelId: $selectedChannelId as any, limit: 50 });
      const batch = res.data ?? [];
      messages = [...batch].reverse();
      error = null;
      scrollToBottom(false);
      wasAtBottom = true;
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to load messages';
    }
  }

  export function refresh() {
    loadLatest();
  }

  $effect(() => {
    const ev: any = $wsEvent;
    if (!ev || ev.op !== 0 || !ev.d?.message) return;
    const incoming = ev.d.message as DtoMessage & { author_id?: any };
    if (!incoming.channel_id || String((incoming as any).channel_id) !== $selectedChannelId) return;
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

<div class="relative flex-1 overflow-y-auto scroll-area" bind:this={scroller} on:scroll={() => { wasAtBottom = isNearBottom(); if (wasAtBottom) newCount = 0; }}>
  <div class="sticky top-0 z-10 bg-[var(--bg)]/70 backdrop-blur px-3 py-2 border-b border-[var(--stroke)] flex items-center justify-between">
    <div class="text-xs text-[var(--muted)]">{endReached ? 'Start of history' : 'Load older messages'}</div>
    <button class="px-2 py-1 text-sm rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] disabled:opacity-50" disabled={loading || endReached} on:click={loadMore}>
      {loading ? 'Loading…' : 'Load older'}
    </button>
  </div>
  {#if error}
    <div class="px-4 py-2 text-sm text-red-500 bg-[var(--panel)] border-b border-[var(--stroke)]">{error}</div>
  {/if}
  {#each messages as m, i (m.id)}
    {@const d = (function(){ const t = (m as any)?.id; try { const s = String(t).replace(/[^0-9]/g,''); if(!s) return toDate(m.updated_at); const v = BigInt(s); const EPOCH = Date.UTC(2008,10,10,23,0,0,0); const ms = Number(v >> 22n); return new Date(EPOCH + ms); } catch { return toDate(m.updated_at); } })()}
    {@const prevDateForSep = (function(){ const t = (messages[i-1] as any)?.id; try { const s = String(t).replace(/[^0-9]/g,''); if(!s) return toDate(messages[i-1]?.updated_at); const v = BigInt(s); const EPOCH = Date.UTC(2008,10,10,23,0,0,0); const ms = Number(v >> 22n); return new Date(EPOCH + ms); } catch { return toDate(messages[i-1]?.updated_at); } })()}
    {@const showDate = d && (!messages[i-1] || (prevDateForSep && !sameDay(d!, prevDateForSep!)))}
    {#if showDate}
      <div class="my-3 flex items-center justify-center">
        <div class="px-3 py-0.5 text-xs text-[var(--muted)] border border-[var(--stroke)] bg-[var(--panel)] rounded-full">{humanDate(d!)}</div>
      </div>
    {/if}
    {@const prev = messages[i-1]}
    {@const pk = authorKey((prev as any)?.author)}
    {@const ck = authorKey((m as any)?.author)}
    {@const pd = (function(){ const t = (prev as any)?.id; try { const s = String(t).replace(/[^0-9]/g,''); if(!s) return toDate(prev?.updated_at); const v = BigInt(s); const EPOCH = Date.UTC(2008,10,10,23,0,0,0); const ms = Number(v >> 22n); return new Date(EPOCH + ms); } catch { return toDate(prev?.updated_at); } })()}
    {@const withinMinute = (pd && d) ? (Math.abs((d as Date).getTime() - (pd as Date).getTime()) <= 60000) : false}
    {@const compact = pk != null && ck != null && pk === ck && withinMinute}
    <MessageItem message={m} compact={compact} on:deleted={loadLatest} />
  {/each}
</div>

{#if !wasAtBottom && initialLoaded}
  <div class="pointer-events-none relative">
    <div class="pointer-events-auto absolute right-4 bottom-20">
      <button class="px-3 py-1 rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] text-sm shadow" on:click={() => { scrollToBottom(true); newCount = 0; wasAtBottom = true; }}>
        {newCount > 0 ? `${newCount} new • Jump to present ↓` : 'Jump to present ↓'}
      </button>
    </div>
  </div>
{/if}
