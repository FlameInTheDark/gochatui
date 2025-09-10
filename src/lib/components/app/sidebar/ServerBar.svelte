<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedGuildId, channelsByGuild, selectedChannelId, lastChannelByGuild, channelReady } from '$lib/stores/appState';
  import { subscribeWS } from '$lib/client/ws';
  const guilds = auth.guilds;
  import { onMount } from 'svelte';
  onMount(() => {
    const unsub = guilds.subscribe((arr) => {
      if (!$selectedGuildId && (arr?.length ?? 0) > 0) {
        let target = '';
        try { const saved = localStorage.getItem('lastGuild'); if (saved) target = saved; } catch {}
        const exists = target && arr.some((g:any) => String(g?.id) === target);
        const pick = exists ? target : String((arr[0] as any)?.id || '');
        if (pick) { selectGuild(pick); try { localStorage.setItem('lastGuild', pick); } catch {} }
      }
    });
    return () => unsub();
  });

  let creating = false;
  let newGuildName = '';
  let error: string | null = null;

  async function selectGuild(id: string | undefined | null) {
    if (!id) return;
    selectedGuildId.set(id);
    try { localStorage.setItem('lastGuild', id); } catch {}
    // Clear channel until we resolve the first/last channel for this guild
    selectedChannelId.set(null);
    channelReady.set(false);
    try {
      const res = await auth.api.guild.guildGuildIdChannelGet({ guildId: id as any });
      const list = res.data ?? [];
      channelsByGuild.update((m) => ({ ...m, [id as string]: list }));
      // Filter text channels only (type === 0)
      const textChannels = list.filter((c:any) => (c?.type) === 0);

      // Prefer last visited channel for this guild, if still present and is text
      let targetId: string | null = null;
      let remembered = '';
      try {
        const raw = localStorage.getItem('lastChannels');
        const saved = raw ? JSON.parse(raw) : {};
        remembered = saved?.[id] || '';
      } catch {}
      if (!remembered) {
        const map = $lastChannelByGuild; remembered = map[id];
      }
      const rememberedOk = remembered && textChannels.some((c:any) => String(c?.id) === remembered);
      if (rememberedOk) {
        targetId = remembered;
      } else if (textChannels.length > 0) {
        // Auto-select first text channel
        targetId = String((textChannels[0] as any).id);
      } else {
        // No text channels; do not select any
        targetId = null;
      }
      if (targetId) {
        selectedChannelId.set(targetId);
        subscribeWS([id], targetId);
        // Remember this as last visited for next time
        lastChannelByGuild.update((map) => ({ ...map, [id]: targetId! }));
        channelReady.set(true);
        try {
          const snapshot = { ...$lastChannelByGuild, [id]: targetId };
          localStorage.setItem('lastChannels', JSON.stringify(snapshot));
        } catch {}
      }
    } catch (e) {
      // ignore
    }
  }

  async function createGuild() {
    if (!newGuildName.trim()) return;
    try {
      await auth.api.guild.guildPost({ guildCreateGuildRequest: { name: newGuildName } });
      creating = false; newGuildName = ''; error = null;
      await auth.loadGuilds();
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to create guild';
    }
  }
</script>

<div class="h-full w-[var(--col1)] flex flex-col items-center gap-3 p-3 border-r border-[var(--stroke)]">
  <div class="text-xs text-[var(--muted)]">Servers</div>
  <div class="flex-1 flex flex-col gap-2 overflow-y-auto">
    {#each $guilds as g}
      <button
        class="w-12 h-12 rounded-full bg-[var(--panel-strong)] border border-[var(--stroke)] hover:ring-2 hover:ring-[var(--brand)] flex items-center justify-center { $selectedGuildId===String((g as any).id) ? 'ring-2 ring-[var(--brand)]' : '' }"
        title={g.name}
        on:click={() => selectGuild(String((g as any).id))}
      >
        <span class="font-bold">{(g.name ?? '?').slice(0, 2).toUpperCase()}</span>
      </button>
    {/each}
  </div>
  <div>
    <button class="w-12 h-12 rounded-full bg-[var(--brand)] text-[var(--bg)] text-2xl" on:click={() => (creating = !creating)}>+</button>
  </div>

  {#if creating}
    <div class="fixed inset-0 z-50" on:click={() => (creating = false)} on:keydown={(e) => { if (e.key==='Escape') creating=false }}>
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="absolute left-[var(--col1)] ml-4 bottom-6 panel p-3 w-64" on:click|stopPropagation>
        <div class="text-sm font-medium mb-2">New Server</div>
        {#if error}<div class="text-red-500 text-sm mb-2">{error}</div>{/if}
        <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 mb-2" placeholder="Server name" bind:value={newGuildName} />
        <div class="flex gap-2 justify-end">
          <button class="px-3 py-1 rounded-md border border-[var(--stroke)]" on:click={() => (creating = false)}>Cancel</button>
          <button class="px-3 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)]" on:click={createGuild}>Create</button>
        </div>
      </div>
    </div>
  {/if}
</div>
