<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedGuildId, searchOpen } from '$lib/stores/appState';
  type SearchResult = { id: string; channel_id?: string };
  import { selectedChannelId } from '$lib/stores/appState';

  let query = '';
  let loading = false;
  let results: SearchResult[] = [];
  let error: string | null = null;

  async function doSearch() {
    if (!$selectedGuildId || !query.trim()) return;
    loading = true; error = null; results = [];
    try {
      const ch = $selectedChannelId ? String($selectedChannelId).replace(/[^0-9]/g, '') : '';
      const body = `{"content":${JSON.stringify(query)},${ch ? `\"channel_id\":${ch},` : ''}\"page\":0}`;
      const res = await auth.api.search.searchGuildIdMessagesPost({ guildId: $selectedGuildId as any, searchMessageSearchRequest: body as any });
      const data: any = res.data;
      let ids: (string | number)[] = [];
      if (Array.isArray(data)) {
        ids = ([] as (string | number)[]).concat(...data.map((p: any) => p?.ids ?? []));
      } else if (data && Array.isArray(data.ids)) {
        ids = data.ids;
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
</script>

{#if $searchOpen}
  <div class="fixed inset-0 bg-black/40 backdrop-blur-sm grid place-items-start pt-20 px-8 z-50" on:click={() => searchOpen.set(false)}>
    <div class="panel w-full max-w-3xl p-4" on:click|stopPropagation>
      <div class="flex gap-2">
        <input class="flex-1 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2" placeholder="Search messages" bind:value={query} on:keydown={(e)=>{ if(e.key==='Enter') doSearch(); }} />
        <button class="px-3 py-2 rounded-md bg-[var(--brand)] text-[var(--bg)]" on:click={doSearch}>Search</button>
      </div>
      {#if error}<div class="mt-2 text-red-500 text-sm">{error}</div>{/if}
      <div class="mt-3 max-h-[60vh] overflow-y-auto space-y-2">
        {#if loading}
          <div class="text-sm text-[var(--muted)]">Searching…</div>
        {:else if results.length === 0}
          <div class="text-sm text-[var(--muted)]">No results</div>
        {:else}
          {#each results as m}
            <div class="p-2 rounded hover:bg-[var(--panel)] cursor-pointer" on:click={() => openMessage(m)}>
              <div class="text-xs text-[var(--muted)]">{m.channel_id ? `in # ${m.channel_id}` : ''}</div>
              <div class="truncate">Message ID: {m.id}</div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

