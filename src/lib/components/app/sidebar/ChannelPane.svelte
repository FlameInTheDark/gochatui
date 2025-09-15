<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import {
		selectedGuildId,
		selectedChannelId,
		channelsByGuild,
		lastChannelByGuild,
		channelReady
	} from '$lib/stores/appState';
	import type { DtoChannel, GuildChannelOrder } from '$lib/api';
	import { subscribeWS, wsEvent } from '$lib/client/ws';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	import { m } from '$lib/paraglide/messages.js';
	import UserPanel from '$lib/components/app/user/UserPanel.svelte';
	const guilds = auth.guilds;

	let creatingChannel = $state(false);
	let creatingCategory = $state(false);
	let newChannelName = $state('');
	let newCategoryName = $state('');
	let channelError: string | null = $state(null);
	let categoryError: string | null = $state(null);
	let filter = $state('');
	let collapsed = $state<Record<string, boolean>>({});
	let creatingChannelParent: string | null = $state(null);
	let dragging: { id: string; parent: string | null; type: number } | null = null;
	let dragIndicator = $state<{
		target: string | null;
		parent: string | null;
		mode: 'before' | 'inside';
	} | null>(null);

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
		const textChannels = list.filter((c: any) => c?.type === 0);
		const sel = $selectedChannelId ? String($selectedChannelId) : '';
		const selValid = sel && textChannels.some((c: any) => String((c as any).id) === sel);
		if (!selValid) {
			const first = textChannels[0] as any;
			const firstId = first ? String(first.id) : '';
			if (firstId && $selectedGuildId === gid) {
				selectedChannelId.set(firstId);
				subscribeWS([gid], firstId);
				// persist last visited for this guild
				lastChannelByGuild.update((map) => {
					const next = { ...map, [gid]: firstId } as Record<string, string>;
					try {
						localStorage.setItem('lastChannels', JSON.stringify(next));
					} catch {}
					return next;
				});
			} else {
				// no valid text channels; keep selection empty
				selectedChannelId.set(null);
			}
		}
	}

	function startDrag(ch: DtoChannel, parent: string | null) {
		dragging = { id: String((ch as any).id), parent, type: (ch as any)?.type ?? 0 };
	}

	function dragOverChannel(id: string, parent: string | null) {
		dragIndicator = { target: id, parent, mode: 'before' };
	}

	function dragOverContainer(parent: string | null) {
		dragIndicator = { target: null, parent, mode: 'inside' };
	}

	function dropOnChannel(targetId: string, parent: string | null) {
		if (!dragging) return;
		moveChannel(dragging.id, dragging.parent, parent, targetId);
		dragging = null;
		dragIndicator = null;
	}

	function dropOnContainer(parent: string | null) {
		if (!dragging) return;
		moveChannel(dragging.id, dragging.parent, parent, null);
		dragging = null;
		dragIndicator = null;
	}

	function dropOnCategoryHeader(targetId: string) {
		if (!dragging) return;
		if (dragging.type === 2) {
			moveChannel(dragging.id, dragging.parent, null, targetId);
		} else {
			moveChannel(dragging.id, dragging.parent, targetId, null);
		}
		dragging = null;
		dragIndicator = null;
	}

	async function moveChannel(
		id: string,
		from: string | null,
		to: string | null,
		beforeId: string | null
	) {
		const gid = $selectedGuildId ? String($selectedGuildId) : '';
		if (!gid) return;
		const list = [...($channelsByGuild[gid] ?? [])];
		const idx = list.findIndex((c) => String((c as any).id) === id);
		if (idx === -1) return;
		const [moving] = list.splice(idx, 1);
		(moving as any).parent_id = to ? String(to) : null;

		let insertIndex = list.length;
		if (beforeId) {
			const targetIdx = list.findIndex((c) => String((c as any).id) === beforeId);
			if (targetIdx !== -1) insertIndex = targetIdx;
		}
		list.splice(insertIndex, 0, moving);
		channelsByGuild.update((m) => ({ ...m, [gid]: list }));

		if (from !== to) {
			await auth.api.guild.guildGuildIdChannelChannelIdPatch({
				guildId: BigInt(gid) as any,
				channelId: BigInt(id) as any,
				guildPatchGuildChannelRequest: { parent_id: to ? (BigInt(to) as any) : undefined } as any
			});
		}

		const channels: GuildChannelOrder[] = list.map(
			(c, index) => ({ id: BigInt((c as any).id), position: index }) as any
		);
		await auth.api.guild.guildGuildIdChannelOrderPatch({
			guildId: BigInt(gid) as any,
			guildPatchGuildChannelOrderRequest: { channels } as any
		});
	}

	$effect(() => {
		const ev = $wsEvent as any;
		if (
			ev?.op === 0 &&
			ev?.t === 108 &&
			ev?.d?.guild_id != null &&
			Array.isArray(ev?.d?.channels)
		) {
			const gid = String(ev.d.guild_id);
			channelsByGuild.update((map) => {
				const list = [...(map[gid] ?? [])];
				const pos = new Map<string, number>();
				for (const ch of ev.d.channels) {
					pos.set(String(ch.id), ch.position ?? 0);
				}
				for (const ch of list) {
					const p = pos.get(String((ch as any).id));
					if (p != null) (ch as any).position = p;
				}
				list.sort((a: any, b: any) => ((a as any).position ?? 0) - ((b as any).position ?? 0));
				return { ...map, [gid]: list };
			});
		}
	});

	function computeSections(channels: DtoChannel[]) {
		const byParent: Record<string, DtoChannel[]> = {};
		for (const c of channels) {
			if ((c as any).parent_id != null) {
				const pid = String((c as any).parent_id);
				(byParent[pid] ||= []).push(c);
			}
		}
		for (const pid in byParent) {
			byParent[pid].sort(
				(a: any, b: any) => ((a as any).position ?? 0) - ((b as any).position ?? 0)
			);
		}
		const topLevel = channels
			.filter((c) => (c as any).parent_id == null)
			.sort((a: any, b: any) => ((a as any).position ?? 0) - ((b as any).position ?? 0));
		const ordered: (
			| { type: 'channel'; ch: DtoChannel }
			| { type: 'category'; cat: DtoChannel; items: DtoChannel[] }
		)[] = [];
		for (const c of topLevel) {
			const id = String((c as any).id);
			if ((c as any).type === 2) {
				ordered.push({ type: 'category', cat: c, items: byParent[id] ?? [] });
			} else {
				ordered.push({ type: 'channel', ch: c });
			}
		}
		return ordered;
	}

	function toggleCollapse(id: string) {
		collapsed = { ...collapsed, [id]: !collapsed[id] };
	}

	async function createChannel() {
		if (!newChannelName.trim() || !$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdChannelPost({
				guildId: $selectedGuildId as any,
				guildCreateGuildChannelRequest: {
					name: newChannelName,
					parent_id: creatingChannelParent ? (creatingChannelParent as any) : undefined,
					type: 0
				}
			});
			creatingChannel = false;
			newChannelName = '';
			creatingChannelParent = null;
			channelError = null;
			await refreshChannels();
		} catch (e: any) {
			channelError = e?.response?.data?.message ?? e?.message ?? 'Failed to create channel';
		}
	}

	function selectChannel(id: string) {
		const gid = $selectedGuildId ? String($selectedGuildId) : '';
		if (!gid) return;
		// validate the channel belongs to current guild and is a text channel
		const list = $channelsByGuild[gid] ?? [];
		const ok = list.some(
			(c: any) => String((c as any).id) === String(id) && (c as any)?.type === 0
		);
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
			{ label: m.copy_channel_id(), action: () => copyToClipboard(id), disabled: !id },
			{ label: m.open_channel(), action: () => selectChannel(id), disabled: !isText },
			{
				label: m.delete_channel(),
				action: () => deleteChannel(id),
				danger: true,
				disabled: !isText
			}
		];
		contextMenu.openFromEvent(e, items);
	}

	function openPaneMenu(e: MouseEvent) {
		const items = [
			{
				label: m.new_channel(),
				action: () => {
					creatingChannel = true;
					channelError = null;
					creatingChannelParent = null;
				}
			},
			{
				label: m.new_category(),
				action: () => {
					creatingCategory = true;
					categoryError = null;
				}
			}
		];
		contextMenu.openFromEvent(e, items);
	}

	async function createCategory() {
		if (!newCategoryName.trim() || !$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdCategoryPost({
				guildId: $selectedGuildId as any,
				guildCreateGuildChannelCategoryRequest: {
					name: newCategoryName,
					type: 2
				} as any
			});
			creatingCategory = false;
			newCategoryName = '';
			categoryError = null;
			await refreshChannels();
		} catch (e: any) {
			categoryError = e?.response?.data?.message ?? e?.message ?? 'Failed to create category';
		}
	}

	async function deleteCategory(categoryId: string) {
		if (!$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdCategoryCategoryIdDelete({
				guildId: $selectedGuildId as any,
				categoryId: categoryId as any
			});
			await refreshChannels();
		} catch (e) {}
	}

	async function deleteChannel(channelId: string) {
		if (!$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdChannelChannelIdDelete({
				guildId: $selectedGuildId as any,
				channelId: channelId as any
			});
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
		const name = prompt(m.rename_server_prompt(), current);
		if (!name) return;
		try {
			await auth.api.guild.guildGuildIdPatch({
				guildId: $selectedGuildId as any,
				guildUpdateGuildRequest: { name }
			});
			await auth.loadGuilds();
		} catch (e) {}
	}
</script>

<div class="flex h-full w-[var(--col2)] flex-col border-r border-[var(--stroke)]">
	<div
		class="box-border flex h-[var(--header-h)] flex-shrink-0 items-center justify-between overflow-hidden border-b border-[var(--stroke)] px-3"
	>
		<div class="truncate font-semibold">
			{$guilds.find((g) => String((g as any).id) === $selectedGuildId)?.name ?? m.select_server()}
		</div>
		{#if $selectedGuildId}
			<div class="flex items-center gap-2">
				<button
					class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
					onclick={() => {
						creatingChannel = true;
						channelError = null;
						creatingChannelParent = null;
					}}
					title={m.new_channel()}
					aria-label={m.new_channel()}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="currentColor"><path d="M11 5h2v14h-2z" /><path d="M5 11h14v2H5z" /></svg
					>
				</button>
				<button
					class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
					onclick={() => {
						creatingCategory = true;
						categoryError = null;
					}}
					title={m.new_category()}
					aria-label={m.new_category()}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="currentColor"
						><path d="M4 6h8l2 2h6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /><path
							d="M8 11h8v2H8z"
						/></svg
					>
				</button>
				<button
					class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
					onclick={renameGuild}
					title={m.rename_server()}
					aria-label={m.rename_server()}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="currentColor"
						><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" /><path
							d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
						/></svg
					>
				</button>
				<button
					class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] text-red-400 hover:bg-[var(--panel)]"
					onclick={leaveGuild}
					title={m.leave_server()}
					aria-label={m.leave_server()}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="currentColor"
						><path d="M10 17l5-5-5-5v10z" /><path d="M4 4h8v2H6v12h6v2H4z" /></svg
					>
				</button>
			</div>
		{/if}
	</div>
	<div class="border-b border-[var(--stroke)] p-2">
		<input
			class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-1 text-sm"
			placeholder={m.filter_channels()}
			bind:value={filter}
		/>
	</div>
	<div
		class="scroll-area flex-1 space-y-2 overflow-y-auto p-2"
		role="region"
		oncontextmenu={(e) => {
			e.preventDefault();
			openPaneMenu(e);
		}}
	>
		{#if $selectedGuildId}
			{@const sections = computeSections(currentGuildChannels())}
			<div
				ondragover={(e) => {
					e.preventDefault();
					dragOverContainer(null);
				}}
				ondrop={() => dropOnContainer(null)}
				role="list"
			>
				{#each sections as sec (String(sec.type === 'category' ? (sec.cat as any)?.id : (sec.ch as any)?.id))}
					{#if sec.type === 'channel'}
                                                {#if (sec.ch.name || '').toLowerCase().includes(filter.toLowerCase())}
                                                        <div
                                                                role="listitem"
                                                                ondragover={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        dragOverChannel(String((sec.ch as any).id), null);
                                                                }}
                                                                ondrop={(e) => {
                                                                        e.stopPropagation();
                                                                        dropOnChannel(String((sec.ch as any).id), null);
                                                                }}
                                                        >
                                                                {#if dragIndicator?.mode === 'before' &&
                                                                dragIndicator.target === String((sec.ch as any).id) &&
                                                                dragIndicator.parent === null}
                                                                        <div class="my-1 h-0.5 rounded-full bg-[var(--brand)] pointer-events-none"></div>
                                                                {/if}
                                                                <div
                                                                        class="group flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-[var(--panel)] {$selectedChannelId ===
                                                                        String((sec.ch as any).id)
                                                                                ? 'bg-[var(--panel)]'
                                                                                : ''}"
                                                                        role="button"
                                                                        tabindex="0"
                                                                        draggable="true"
                                                                        ondragstart={() => startDrag(sec.ch, null)}
                                                                        onclick={() => selectChannel(String((sec.ch as any).id))}
                                                                        onkeydown={(e) =>
                                                                                (e.key === 'Enter' || e.key === ' ') && selectChannel(String((sec.ch as any).id))}
                                                                        oncontextmenu={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                openChannelMenu(e, sec.ch);
                                                                        }}
                                                                >
                                                                        <div class="flex items-center gap-2 truncate">
                                                                                <span class="opacity-70">#</span>
                                                                                {sec.ch.name}
                                                                        </div>
                                                                        <div
                                                                                class="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100"
                                                                        >
                                                                                <button
                                                                                        class="text-xs text-red-400"
                                                                                        title="Delete"
                                                                                        onclick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                deleteChannel(String((sec.ch as any).id));
                                                                                        }}>✕</button
                                                                                >
                                                                        </div>
                                                                </div>
                                                        </div>
                                                {/if}
					{:else}
						<div
							class="mt-2"
							ondragover={(e) => {
								e.preventDefault();
								dragOverContainer(String((sec.cat as any)?.id));
							}}
							ondrop={() => dropOnContainer(String((sec.cat as any)?.id))}
							role="list"
                                                 >
                                                        {#if dragIndicator?.mode === 'before' &&
                                                        dragIndicator.target === String((sec.cat as any)?.id) &&
                                                        dragIndicator.parent === null}
                                                                <div class="my-1 h-0.5 rounded-full bg-[var(--brand)] pointer-events-none"></div>
                                                        {/if}
                                                        <div
                                                                  class="flex items-center justify-between px-2 text-xs tracking-wide text-[var(--muted)] uppercase {dragIndicator?.mode === 'inside' &&
                                                                  dragIndicator.parent === String((sec.cat as any)?.id)
                                                                          ? 'rounded-md ring-2 ring-[var(--brand)]'
                                                                          : ''}"
								role="button"
								tabindex="0"
								draggable="true"
								ondragstart={() => startDrag(sec.cat, null)}
								ondragover={(e) => {
									e.preventDefault();
									e.stopPropagation();
									if (dragging && dragging.type === 2) {
										dragOverChannel(String((sec.cat as any)?.id), null);
									} else {
										dragOverContainer(String((sec.cat as any)?.id));
									}
								}}
								ondrop={(e) => {
									e.stopPropagation();
									dropOnCategoryHeader(String((sec.cat as any)?.id));
								}}
							>
								<button
									class="flex items-center gap-2"
									onclick={() => toggleCollapse(String((sec.cat as any)?.id))}
								>
									<span class="inline-block"
										>{collapsed[String((sec.cat as any)?.id)] ? '▸' : '▾'}</span
									>
									<div class="truncate">{sec.cat?.name ?? 'Category'}</div>
								</button>
								<div class="flex items-center gap-2">
									<button
										class="text-xs"
										title={m.new_channel()}
										onclick={() => {
											creatingChannel = true;
											channelError = null;
											creatingChannelParent = String((sec.cat as any)?.id);
										}}>+</button
									>
									<button
										class="text-xs text-red-400"
										title="Delete category"
										onclick={() => deleteCategory(String((sec.cat as any)?.id))}>✕</button
									>
								</div>
							</div>
							{#if !collapsed[String((sec.cat as any)?.id)]}
								{#each sec.items.filter((c) => (c.name || '')
										.toLowerCase()
										.includes(filter.toLowerCase())) as ch (String((ch as any).id))}
                                                                          <div
                                                                                  role="listitem"
                                                                                  ondragover={(e) => {
                                                                                          e.preventDefault();
                                                                                          e.stopPropagation();
                                                                                          dragOverChannel(String((ch as any).id), String((sec.cat as any)?.id));
                                                                                  }}
                                                                                  ondrop={(e) => {
                                                                                          e.stopPropagation();
                                                                                          dropOnChannel(String((ch as any).id), String((sec.cat as any)?.id));
                                                                                  }}
                                                                          >
                                                                                  {#if dragIndicator?.mode === 'before' &&
                                                                                  dragIndicator.target === String((ch as any).id) &&
                                                                                  dragIndicator.parent === String((sec.cat as any)?.id)}
                                                                                          <div class="my-1 h-0.5 rounded-full bg-[var(--brand)] pointer-events-none"></div>
                                                                                  {/if}
                                                                                  <div
                                                                                          class="group flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-[var(--panel)] {$selectedChannelId ===
                                                                                          String((ch as any).id)
                                                                                                  ? 'bg-[var(--panel)]'
                                                                                                  : ''}"
                                                                                          role="button"
                                                                                          tabindex="0"
                                                                                          draggable="true"
                                                                                          ondragstart={() => startDrag(ch, String((sec.cat as any)?.id))}
                                                                                          onclick={() => selectChannel(String((ch as any).id))}
                                                                                          onkeydown={(e) =>
                                                                                                  (e.key === 'Enter' || e.key === ' ') && selectChannel(String((ch as any).id))}
                                                                                          oncontextmenu={(e) => {
                                                                                                  e.preventDefault();
                                                                                                  e.stopPropagation();
                                                                                                  openChannelMenu(e, ch);
                                                                                          }}
                                                                                  >
                                                                                          <div class="flex items-center gap-2 truncate">
                                                                                                  <span class="opacity-70">#</span>
                                                                                                  {ch.name}
                                                                                          </div>
                                                                                          <div
                                                                                                  class="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100"
                                                                                          >
                                                                                                  <button
                                                                                                          class="text-xs text-red-400"
                                                                                                          title="Delete"
                                                                                                          onclick={(e) => {
                                                                                                                  e.stopPropagation();
                                                                                                                  deleteChannel(String((ch as any).id));
                                                                                                          }}>✕</button
                                                                                                  >
                                                                                          </div>
                                                                                  </div>
                                                                          </div>
								{/each}
							{/if}
							<div
								class="h-4"
								role="listitem"
								ondragover={(e) => {
									e.preventDefault();
									dragOverContainer(String((sec.cat as any)?.id));
								}}
								ondrop={() => dropOnContainer(String((sec.cat as any)?.id))}
							></div>
						</div>
					{/if}
				{/each}
				<div
					class="h-4"
					role="listitem"
					ondragover={(e) => {
						e.preventDefault();
						dragOverContainer(null);
					}}
					ondrop={() => dropOnContainer(null)}
				></div>
			</div>
		{:else}
			<div class="p-4 text-sm text-[var(--muted)]">Select a server to view channels.</div>
		{/if}
	</div>

	<UserPanel />

	{#if creatingChannel}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onpointerdown={() => (creatingChannel = false)}
			onkeydown={(e) => {
				if (e.key === 'Escape') creatingChannel = false;
				if (e.key === 'Enter') createChannel();
			}}
		>
			<div class="absolute inset-0 bg-black/40"></div>
			<div
				class="panel absolute top-1/2 left-1/2 w-72 -translate-x-1/2 -translate-y-1/2 p-3"
				role="document"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="mb-2 text-sm font-medium">{m.new_channel()}</div>
				{#if channelError}
					<div class="mb-2 text-sm text-red-500">{channelError}</div>
				{/if}
				<input
					class="mb-2 w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					placeholder={m.channel_name()}
					bind:value={newChannelName}
				/>
				{#if creatingChannelParent}
					<div class="mb-2 text-xs text-[var(--muted)]">in category #{creatingChannelParent}</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						class="rounded-md border border-[var(--stroke)] px-3 py-1"
						onclick={() => (creatingChannel = false)}>{m.cancel()}</button
					>
					<button
						class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)]"
						onclick={createChannel}>{m.create()}</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if creatingCategory}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onpointerdown={() => (creatingCategory = false)}
			onkeydown={(e) => {
				if (e.key === 'Escape') creatingCategory = false;
				if (e.key === 'Enter') createCategory();
			}}
		>
			<div class="absolute inset-0 bg-black/40"></div>
			<div
				class="panel absolute top-1/2 left-1/2 w-72 -translate-x-1/2 -translate-y-1/2 p-3"
				role="document"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="mb-2 text-sm font-medium">{m.new_category()}</div>
				{#if categoryError}
					<div class="mb-2 text-sm text-red-500">{categoryError}</div>
				{/if}
				<input
					class="mb-2 w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					placeholder={m.category_name()}
					bind:value={newCategoryName}
				/>
				<div class="flex justify-end gap-2">
					<button
						class="rounded-md border border-[var(--stroke)] px-3 py-1"
						onclick={() => (creatingCategory = false)}>{m.cancel()}</button
					>
					<button
						class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)]"
						onclick={createCategory}>{m.create()}</button
					>
				</div>
			</div>
		</div>
	{/if}
</div>
