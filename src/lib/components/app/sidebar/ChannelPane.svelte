<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedGuildId, selectedChannelId, channelsByGuild, lastChannelByGuild, channelReady } from '$lib/stores/appState';
  import type { DtoChannel } from '$lib/api';
  import { subscribeWS } from '$lib/client/ws';
  const guilds = auth.guilds;

  let creatingChannel = false;
  let creatingCategory = false;
  let newChannelName = '';
  let newCategoryName = '';
  let error: string | null = null;
  let filter = $state('');
  let collapsed = $state<Record<string, boolean>>({});
  let creatingChannelParent: string | null = null;

  $effect(() => { error = null });

  function currentGuildChannels(): DtoChannel[] {
    const gid = $selectedGuildId ?? '';
    return $channelsByGuild[gid] ?? [];
  }

  async function refreshChannels() {
    if (!$selectedGuildId) return;
    const res = await auth.api.guild.guildGuildIdChannelGet({ guildId: $selectedGuildId as any });
    const list = res.data ?? [];
    channelsByGuild.update((m) => ({ ...m, [$selectedGuildId!]: list }));
    if (!$selectedChannelId && list.length) {
      const first = list.find((c:any) => (c?.type) === 0) ?? null;
      const firstId = first ? String((first as any).id) : '';
      if (firstId) {
        selectedChannelId.set(firstId);
        if ($selectedGuildId) subscribeWS([$selectedGuildId], firstId);
      }
    }
  }

  function computeSections(channels: DtoChannel[]) {
    const byParent: Record<string, DtoChannel[]> = {};
    const idToChannel: Record<string, DtoChannel> = {};
    const topLevel: DtoChannel[] = [];
    for (const c of channels) {
      if ((c as any).id != null) idToChannel[String((c as any).id)] = c;
    }
    const parentIds = new Set<string>();
    for (const c of channels) {
      if ((c as any).parent_id != null) {
        const pid = String((c as any).parent_id);
        parentIds.add(pid);
        (byParent[pid] ||= []).push(c);
      }
    }
    for (const c of channels) {
      const cid = String((c as any).id);
      if ((c as any).parent_id == null && !parentIds.has(cid)) topLevel.push(c);
    }
    const categories = [...parentIds].map((pid) => ({ cat: idToChannel[pid], items: byParent[pid] ?? [] }));
    return { categories, topLevel };
  }

  function toggleCollapse(id: string) {
    collapsed = { ...collapsed, [id]: !collapsed[id] };
  }

  async function createChannel() {
    if (!newChannelName.trim() || !$selectedGuildId) return;
    try {
      await auth.api.guild.guildGuildIdChannelPost({ guildId: $selectedGuildId as any, guildCreateGuildChannelRequest: { name: newChannelName, parent_id: creatingChannelParent ? (creatingChannelParent as any) : undefined } });
      creatingChannel = false; newChannelName = '';
      creatingChannelParent = null;
      await refreshChannels();
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to create channel';
    }
  }

  function selectChannel(id: string) {
    selectedChannelId.set(id);
    if ($selectedGuildId) {
      subscribeWS([$selectedGuildId], id);
      const g = $selectedGuildId;
      lastChannelByGuild.update((map) => {
        const next = { ...map, [g]: id } as Record<string, string>;
        try { localStorage.setItem('lastChannels', JSON.stringify(next)); } catch {}
        return next;
      });
      channelReady.set(true);
    }
  }

  async function createCategory() {
    if (!newCategoryName.trim() || !$selectedGuildId) return;
    try {
      await auth.api.guild.guildGuildIdCategoryPost({ guildId: $selectedGuildId as any, guildCreateGuildChannelCategoryRequest: { name: newCategoryName } });
      creatingCategory = false; newCategoryName = '';
      await refreshChannels();
    } catch (e: any) {
      error = e?.response?.data?.message ?? e?.message ?? 'Failed to create category';
    }
  }

  async function deleteCategory(categoryId: string) {
    if (!$selectedGuildId) return;
    try {
      await auth.api.guild.guildGuildIdCategoryCategoryIdDelete({ guildId: $selectedGuildId as any, categoryId: categoryId as any });
      await refreshChannels();
    } catch (e) {}
  }

  async function deleteChannel(channelId: string) {
    if (!$selectedGuildId) return;
    try {
      await auth.api.guild.guildGuildIdChannelChannelIdDelete({ guildId: $selectedGuildId as any, channelId: channelId as any });
      await refreshChannels();
    } catch (e) {}
  }

  async function leaveGuild() {
    if (!$selectedGuildId) return;
    try {
      await auth.api.user.userMeGuildsGuildIdDelete({ guildId: String($selectedGuildId) });
      await auth.loadGuilds();
      selectedGuildId.set(null);
    } catch (e) {}
  }

  async function renameGuild() {
    if (!$selectedGuildId) return;
    const current = $guilds.find((g) => String((g as any).id) === $selectedGuildId)?.name ?? '';
    const name = prompt('Rename server to:', current);
    if (!name) return;
    try {
      await auth.api.guild.guildGuildIdPatch({ guildId: $selectedGuildId as any, guildUpdateGuildRequest: { name } });
      await auth.loadGuilds();
    } catch (e) {}
  }
</script>

<div class="h-full w-[var(--col2)] border-r border-[var(--stroke)] flex flex-col">
  <div class="h-14 border-b border-[var(--stroke)] flex items-center justify-between px-3">
    <div class="font-semibold truncate">{($guilds.find((g) => String((g as any).id) === $selectedGuildId)?.name) ?? 'Select server'}</div>
    {#if $selectedGuildId}
      <div class="flex items-center gap-2">
        <button class="text-sm underline" on:click={() => (creatingChannel = true)}>+ channel</button>
        <button class="text-sm underline" on:click={() => (creatingCategory = true)}>+ category</button>
        <button class="text-sm underline" on:click={renameGuild}>Rename</button>
        <button class="text-sm text-red-400 underline" on:click={leaveGuild}>Leave</button>
      </div>
    {/if}
  </div>
  <div class="p-2 border-b border-[var(--stroke)]">
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-1 text-sm" placeholder="Filter channels" bind:value={filter} />
  </div>
  {#if error}<div class="p-2 text-red-500 text-sm">{error}</div>{/if}
  <div class="flex-1 overflow-y-auto p-2 space-y-2">
    {#if $selectedGuildId}
      {@const sections = computeSections(currentGuildChannels())}
      {#if sections.topLevel.length}
        <div>
          <div class="text-xs uppercase tracking-wide text-[var(--muted)] px-2">Uncategorized</div>
          {#each sections.topLevel.filter((c)=> (c.name || '').toLowerCase().includes(filter.toLowerCase())) as ch}
            <div class="group px-2 py-1 rounded hover:bg-[var(--panel)] flex items-center justify-between cursor-pointer { $selectedChannelId===String((ch as any).id) ? 'bg-[var(--panel)]' : '' }" on:click={() => selectChannel(String((ch as any).id))}>
              <div class="truncate flex items-center gap-2"><span class="opacity-70">#</span> {ch.name}</div>
              <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                <button class="text-xs text-red-400" title="Delete" on:click|stopPropagation={() => deleteChannel(String((ch as any).id))}>🗑</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#each sections.categories as sec}
        <div class="mt-2">
          <div class="flex items-center justify-between text-xs uppercase tracking-wide text-[var(--muted)] px-2">
            <button class="flex items-center gap-2" on:click={() => toggleCollapse(String((sec.cat as any)?.id))}>
              <span class="inline-block transform transition-transform {collapsed[String((sec.cat as any)?.id)] ? '-rotate-90' : 'rotate-0'}">▾</span>
              <div class="truncate">{sec.cat?.name ?? 'Category'}</div>
            </button>
            <div class="flex items-center gap-2">
              <button class="text-xs" title="New channel" on:click={() => { creatingChannel = true; creatingChannelParent = String((sec.cat as any)?.id); }}>＋</button>
              <button class="text-xs text-red-400" title="Delete category" on:click={() => deleteCategory(String((sec.cat as any)?.id))}>🗑</button>
            </div>
          </div>
          {#if !collapsed[String((sec.cat as any)?.id)]}
            {#each sec.items.filter((c)=> (c.name || '').toLowerCase().includes(filter.toLowerCase())) as ch}
              <div class="group px-2 py-1 rounded hover/bg-[var(--panel)] flex items-center justify-between cursor-pointer { $selectedChannelId===String((ch as any).id) ? 'bg-[var(--panel)]' : '' }" on:click={() => { const id = String((ch as any).id); selectedChannelId.set(id); if ($selectedGuildId) { subscribeWS([$selectedGuildId], id); const g = $selectedGuildId; import('$lib/stores/appState').then(m => { m.lastChannelByGuild.update((map)=>({ ...map, [g]: id })); m.channelReady.set(true); try { const snapshot = { .../*store removed*/lastChanMap, [g]: id }; localStorage.setItem('lastChannels', JSON.stringify(snapshot)); } catch {} }); } }}>
                <div class="truncate flex items-center gap-2"><span class="opacity-70">#</span> {ch.name}</div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                  <button class="text-xs text-red-400" title="Delete" on:click|stopPropagation={() => deleteChannel(String((ch as any).id))}>🗑</button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/each}
    {:else}
      <div class="p-4 text-sm text-[var(--muted)]">Select a server to view channels.</div>
    {/if}
  </div>

  {#if creatingChannel}
    <div class="absolute left-[calc(var(--col1)+var(--col2))] top-16 ml-4 panel p-3 w-72">
      <div class="text-sm font-medium mb-2">New Channel</div>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 mb-2" placeholder="Channel name" bind:value={newChannelName} />
      {#if creatingChannelParent}
        <div class="text-xs text-[var(--muted)] mb-2">in category #{creatingChannelParent}</div>
      {/if}
      <div class="flex gap-2 justify-end">
        <button class="px-3 py-1 rounded-md border border-[var(--stroke)]" on:click={() => (creatingChannel = false)}>Cancel</button>
        <button class="px-3 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)]" on:click={createChannel}>Create</button>
      </div>
    </div>
  {/if}

  {#if creatingCategory}
    <div class="absolute left-[calc(var(--col1)+var(--col2))] top-44 ml-4 panel p-3 w-72">
      <div class="text-sm font-medium mb-2">New Category</div>
      <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 mb-2" placeholder="Category name" bind:value={newCategoryName} />
      <div class="flex gap-2 justify-end">
        <button class="px-3 py-1 rounded-md border border-[var(--stroke)]" on:click={() => (creatingCategory = false)}>Cancel</button>
        <button class="px-3 py-1 rounded-md bg-[var(--brand)] text-[var(--bg)]" on:click={createCategory}>Create</button>
      </div>
    </div>
  {/if}
</div>

