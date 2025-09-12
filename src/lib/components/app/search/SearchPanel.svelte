<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedGuildId, searchOpen, searchAnchor, selectedChannelId } from '$lib/stores/appState';
  type SearchResult = { id: string; channel_id?: string };
  import { tick } from 'svelte';
  import { m } from '$lib/paraglide/messages.js';

  let query = '';
  let loading = false;
  let results: SearchResult[] = [];
  let error: string | null = null;
  let page = 0;
  let pages = 0;
  let pageItems: (number | string)[] = [];

  let panelEl: HTMLDivElement | null = null;
  let posX = 0; let posY = 0;
  function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v));}
  async function updatePosition(){
    if (typeof window==='undefined') return; await tick();
    const pad=8; const vw=window.innerWidth; const vh=window.innerHeight;
    const rect = panelEl ? panelEl.getBoundingClientRect() : ({width:480,height:320} as any);
    const anchor = $searchAnchor || { x: vw - pad, y: 56 };
    posX = clamp(anchor.x, pad, vw - rect.width - pad);
    posY = clamp(anchor.y, pad, vh - rect.height - pad);
  }

  async function doSearch() {
    if (!$selectedGuildId || !query.trim()) return;
    loading = true; error = null; results = [];
    try {
      const ch = $selectedChannelId ? String($selectedChannelId).replace(/[^0-9]/g, '') : '';
      const body = `{"content":${JSON.stringify(query)},${ch ? `\"channel_id\":${ch},` : ''}\"page\":${page}}`;
      const res = await auth.api.search.searchGuildIdMessagesPost({ guildId: $selectedGuildId as any, searchMessageSearchRequest: body as any });
      const data: any = res.data;
      let ids: (string | number)[] = [];
      if (Array.isArray(data)) {
        ids = ([] as (string | number)[]).concat(...data.map((p: any) => p?.ids ?? []));
        const pmax = Math.max(0, ...data.map((p:any)=>Number(p?.pages ?? 0)).filter((n:number)=>!Number.isNaN(n)));
        pages = pmax || pages;
      } else if (data && Array.isArray(data.ids)) {
        ids = data.ids;
        pages = Number(data.pages ?? pages) || pages;
      }
      results = (ids ?? []).map((id) => ({ id: String(id), channel_id: $selectedChannelId ?? undefined }));
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Search failed';
    } finally {
      loading = false;
    }
  }

  function openMessage(m: SearchResult) {
    if (!m.channel_id) return;
    selectedChannelId.set(String(m.channel_id));
    searchOpen.set(false);
  }

  $: if ($searchOpen) { updatePosition(); }

  const MAX_PAGER_BUTTONS = 9; // total slots, including first/last and ellipses
  function visiblePageItems(total: number, current: number, maxButtons = MAX_PAGER_BUTTONS): (number | string)[] {
    total = Number(total) || 0;
    current = Number(current) || 0;
    if (total <= 0) return [];
    if (total <= maxButtons) return Array.from({ length: total }, (_, i) => i);
    const items: (number | string)[] = [];
    const first = 0;
    const last = total - 1;
    const middleCount = maxButtons - 2; // minus first/last
    let start = Math.max(1, current - Math.floor(middleCount / 2));
    let end = start + middleCount - 1;
    if (end > last - 1) {
      end = last - 1;
      start = end - middleCount + 1;
    }
    items.push(first);
    if (start > 1) items.push('...');
    for (let i = start; i <= end; i++) items.push(i);
    if (end < last - 1) items.push('...');
    items.push(last);
    return items;
  }
  $: pageItems = visiblePageItems(pages, page);
</script>

{#if $searchOpen}
  <div class="fixed inset-0 z-[1000]" on:click={() => searchOpen.set(false)}>
    <div bind:this={panelEl} class="absolute panel w-[min(80vw,640px)] p-4" style={`left:${posX}px; top:${posY}px`} on:click|stopPropagation>
      <div class="flex gap-2">
        <input class="flex-1 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" placeholder={m.search_placeholder()} bind:value={query} on:keydown={(e)=>{ if(e.key==='Enter') { page = 0; doSearch(); } }} />
        <button class="px-3 py-2 rounded-md bg-[var(--brand)] text-[var(--bg)]" on:click={() => { page = 0; doSearch(); }}>{m.search()}</button>
      </div>
      {#if error}<div class="mt-2 text-red-500 text-sm">{error}</div>{/if}

      <div class="mt-3 max-h-[60vh] overflow-y-auto space-y-2">
        {#if loading}
          <div class="text-sm text-[var(--muted)]">{m.searching()}</div>
        {:else if results.length === 0}
          <div class="text-sm text-[var(--muted)]">{m.no_results()}</div>
        {:else}
          {#each results as m}
            <div class="p-2 rounded hover:bg-[var(--panel)] cursor-pointer" on:click={() => openMessage(m)}>
              <div class="text-xs text-[var(--muted)]">{m.channel_id ? `in # ${m.channel_id}` : ''}</div>
              <div class="truncate">Message ID: {m.id}</div>
            </div>
          {/each}
        {/if}
      </div>

      {#if pages > 0}
        <div class="mt-3 flex items-center justify-center gap-1">
          <button
            class="px-2 py-1 rounded-md border border-[var(--stroke)] disabled:opacity-50"
            aria-label={m.pager_prev()}
            disabled={loading || page <= 0}
            on:click={() => { if (page > 0) { page -= 1; doSearch(); } }}
          >
            &lsaquo;
          </button>

          {#each pageItems as p}
            {#if typeof p === 'string'}
              <span class="px-2 text-[var(--muted)] select-none">{p}</span>
            {:else}
              <button
                class={`min-w-[2rem] px-2 py-1 rounded-md border border-[var(--stroke)] ${p===page ? 'bg-[var(--panel)]' : ''}`}
                aria-current={p===page ? 'page' : undefined}
                on:click={() => { if (!loading && p !== page) { page = p; doSearch(); } }}
                disabled={loading}
              >
                {p + 1}
              </button>
            {/if}
          {/each}

          <button
            class="px-2 py-1 rounded-md border border-[var(--stroke)] disabled:opacity-50"
            aria-label={m.pager_next()}
            disabled={loading || (pages ? page >= pages - 1 : false)}
            on:click={() => { if (!pages || page < pages - 1) { page += 1; doSearch(); } }}
          >
            &rsaquo;
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
