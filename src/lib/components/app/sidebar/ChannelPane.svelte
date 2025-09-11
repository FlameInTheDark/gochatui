<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { selectedGuildId, selectedChannelId, channelsByGuild, lastChannelByGuild, channelReady } from '$lib/stores/appState';
  import type { DtoChannel } from '$lib/api';
  import { subscribeWS } from '$lib/client/ws';
  import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
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
    const gid = $selectedGuildId ? String($selectedGuildId) : '';
    if (!gid) return;
    const res = await auth.api.guild.guildGuildIdChannelGet({ guildId: gid as any });
    const list = res.data ?? [];
    channelsByGuild.update((m) => ({ ...m, [gid]: list }));
    // If selected channel is not present in this guild or not a text channel, auto-fix.
    const textChannels = list.filter((c:any) => (c?.type) === 0);
    const sel = $selectedChannelId ? String($selectedChannelId) : '';
    const selValid = sel && textChannels.some((c:any) => String((c as any).id) === sel);
    if (!selValid) {
      const first = textChannels[0] as any;
      const firstId = first ? String(first.id) : '';
      if (firstId && $selectedGuildId === gid) {
        selectedChannelId.set(firstId);
        subscribeWS([gid], firstId);
        // persist last visited for this guild
        lastChannelByGuild.update((map) => {
          const next = { ...map, [gid]: firstId } as Record<string, string>;
          try { localStorage.setItem('lastChannels', JSON.stringify(next)); } catch {}
          return next;
        });
      } else {
        // no valid text channels; keep selection empty
        selectedChannelId.set(null);
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
    const gid = $selectedGuildId ? String($selectedGuildId) : '';
    if (!gid) return;
    // validate the channel belongs to current guild and is a text channel
    const list = $channelsByGuild[gid] ?? [];
    const ok = list.some((c:any) => String((c as any).id) === String(id) && (c as any)?.type === 0);
    if (!ok) return;
    selectedChannelId.set(String(id));
    subscribeWS([gid], id);
    lastChannelByGuild.update((map) => ({ ...map, [gid]: String(id) }));
    try {
      const raw = localStorage.getItem('lastChannels');
      const saved = raw ? JSON.parse(raw) : {};
      saved[gid] = String(id);
      localStorage.setItem('lastChannels', JSON.stringify(saved));
    } catch {}
    channelReady.set(true);
  }

  function openChannelMenu(e: MouseEvent, ch: any) {
    const gid = $selectedGuildId ? String($selectedGuildId) : '';
    const id = String(ch?.id ?? '');
    const type = (ch as any)?.type;
    const isText = type === 0;
    const items = [
      { label: 'Copy channel ID', action: () => copyToClipboard(id), disabled: !id },
      { label: 'Open channel', action: () => selectChannel(id), disabled: !isText },
      { label: 'Delete channel', action: () => deleteChannel(id), danger: true, disabled: !isText }
    ];
    contextMenu.openFromEvent(e, items);
  }

  function openPaneMenu(e: MouseEvent) {
    const items = [
      { label: 'New channel', action: () => { creatingChannel = true; creatingChannelParent = null; } },
      { label: 'New category', action: () => { creatingCategory = true; } }
    ];
    contextMenu.openFromEvent(e, items);
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
  <div class="h-[var(--header-h)] flex-shrink-0 border-b border-[var(--stroke)] flex items-center justify-between px-3 box-border overflow-hidden">
    <div class="font-semibold truncate">{($guilds.find((g) => String((g as any).id) === $selectedGuildId)?.name) ?? 'Select server'}</div>
    {#if $selectedGuildId}
      <div class="flex items-center gap-2">
        <button class="w-8 h-8 grid place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]" on:click={() => (creatingChannel = true)} title="New channel" aria-label="New channel">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11 5h2v14h-2z"/><path d="M5 11h14v2H5z"/></svg>
        </button>
        <button class="w-8 h-8 grid place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]" on:click={() => (creatingCategory = true)} title="New category" aria-label="New category">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 6h8l2 2h6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M8 11h8v2H8z"/></svg>
        </button>
        <button class="w-8 h-8 grid place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]" on:click={renameGuild} title="Rename server" aria-label="Rename server">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="w-8 h-8 grid place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)] text-red-400" on:click={leaveGuild} title="Leave server" aria-label="Leave server">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 17l5-5-5-5v10z"/><path d="M4 4h8v2H6v12h6v2H4z"/></svg>
        </button>
      </div>
    {/if}
  </div>
  <div class="p-2 border-b border-[var(--stroke)]">
    <input class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-1 text-sm" placeholder="Filter channels" bind:value={filter} />
  </div>
  {#if error}<div class="p-2 text-red-500 text-sm">{error}</div>{/if}
  <div class="flex-1 overflow-y-auto scroll-area p-2 space-y-2" on:contextmenu|preventDefault={openPaneMenu}>
    {#if $selectedGuildId}
      {@const sections = computeSections(currentGuildChannels())}
      {#if sections.topLevel.length}
        <div>
          <div class="text-xs uppercase tracking-wide text-[var(--muted)] px-2">Uncategorized</div>
          {#each sections.topLevel.filter((c)=> (c.name || '').toLowerCase().includes(filter.toLowerCase())) as ch}
            <div class="group px-2 py-1 rounded hover:bg-[var(--panel)] flex items-center justify-between cursor-pointer { $selectedChannelId===String((ch as any).id) ? 'bg-[var(--panel)]' : '' }" on:click={() => selectChannel(String((ch as any).id))} on:contextmenu|preventDefault={(e)=>openChannelMenu(e,ch)}>
              <div class="truncate flex items-center gap-2"><span class="opacity-70">#</span> {ch.name}</div>
              <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                <button class="text-xs text-red-400" title="Delete" on:click|stopPropagation={() => deleteChannel(String((ch as any).id))}>✕</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#each sections.categories as sec}
        <div class="mt-2">
          <div class="flex items-center justify-between text-xs uppercase tracking-wide text-[var(--muted)] px-2">
            <button class="flex items-center gap-2" on:click={() => toggleCollapse(String((sec.cat as any)?.id))}>
              <span class="inline-block">{collapsed[String((sec.cat as any)?.id)] ? '▸' : '▾'}</span>
              <div class="truncate">{sec.cat?.name ?? 'Category'}</div>
            </button>
            <div class="flex items-center gap-2">
              <button class="text-xs" title="New channel" on:click={() => { creatingChannel = true; creatingChannelParent = String((sec.cat as any)?.id); }}>+</button>
              <button class="text-xs text-red-400" title="Delete category" on:click={() => deleteCategory(String((sec.cat as any)?.id))}>✕</button>
            </div>
          </div>
          {#if !collapsed[String((sec.cat as any)?.id)]}
            {#each sec.items.filter((c)=> (c.name || '').toLowerCase().includes(filter.toLowerCase())) as ch}
              <div class="group px-2 py-1 rounded hover:bg-[var(--panel)] flex items-center justify-between cursor-pointer { $selectedChannelId===String((ch as any).id) ? 'bg-[var(--panel)]' : '' }" on:click={() => selectChannel(String((ch as any).id))} on:contextmenu|preventDefault={(e)=>openChannelMenu(e,ch)}>
                <div class="truncate flex items-center gap-2"><span class="opacity-70">#</span> {ch.name}</div>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                  <button class="text-xs text-red-400" title="Delete" on:click|stopPropagation={() => deleteChannel(String((ch as any).id))}>✕</button>
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
