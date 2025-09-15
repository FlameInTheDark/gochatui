<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import {
		selectedGuildId,
		selectedChannelId,
		channelsByGuild,
		lastChannelByGuild,
		channelReady,
		guildSettingsOpen
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
	let newChannelPrivate = $state(false);
	let newCategoryName = $state('');
	let channelError: string | null = $state(null);
	let categoryError: string | null = $state(null);
	let filter = $state('');
	let collapsed = $state<Record<string, boolean>>({});
	let creatingChannelParent: string | null = $state(null);
	let editingChannel: DtoChannel | null = $state(null);
	let editingCategory: DtoChannel | null = $state(null);
	let editChannelName = $state('');
	let editChannelTopic = $state('');
	let editChannelPrivate = $state(false);
	let editChannelError: string | null = $state(null);
	let editCategoryName = $state('');
	let editCategoryError: string | null = $state(null);
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
		const res = await auth.api.guild.guildGuildIdChannelGet({
			guildId: BigInt(gid) as any
		});
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
		if (dragging.id === targetId) return;
		if (dragging.type === 2 && parent !== null) return;
		moveChannel(dragging.id, dragging.parent, parent, targetId);
		dragging = null;
		dragIndicator = null;
	}

	function dropOnContainer(parent: string | null) {
		if (!dragging) return;
		if (dragging.type === 2 && parent !== null) return;
		if (dragging.id === parent) return;
		moveChannel(dragging.id, dragging.parent, parent, null);
		dragging = null;
		dragIndicator = null;
	}

	function dropOnCategoryHeader(targetId: string, before: boolean) {
		if (!dragging) return;
		if (dragging.id === targetId) return;
		if (dragging.type === 2 || before) {
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
		if ((moving as any).type === 2 && to !== null) {
			return;
		}
		(moving as any).parent_id = to ? String(to) : null;

		let insertIndex = list.length;
		if (beforeId) {
			if (beforeId === id) return;
			const targetIdx = list.findIndex((c) => String((c as any).id) === beforeId);
			if (targetIdx !== -1) insertIndex = targetIdx;
		}
		list.splice(insertIndex, 0, moving);
		channelsByGuild.update((m) => ({ ...m, [gid]: list }));

		if (from !== to) {
			await auth.api.guild.guildGuildIdChannelChannelIdPatch({
				guildId: BigInt(gid) as any,
				channelId: BigInt(id) as any,
				guildPatchGuildChannelRequest: { parent_id: BigInt(to ?? 0) as any } as any
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
		if (ev?.op === 0 && ev?.d?.guild_id != null) {
			if (ev?.t === 108 && Array.isArray(ev?.d?.channels)) {
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

			if ((ev?.t === 106 || ev?.t === 107) && ev?.d?.channel) {
				const gid = String(ev.d.guild_id);
				const updated = ev.d.channel;
				channelsByGuild.update((map) => {
					const list = [...(map[gid] ?? [])];
					const id = String(updated.id);
					const idx = list.findIndex((c) => String((c as any).id) === id);
					if (idx !== -1) {
						const target = list[idx] as any;
						Object.assign(target, updated);
						target.parent_id = updated.parent_id != null ? String(updated.parent_id) : null;
						if (updated.position != null) target.position = updated.position;
					} else {
						list.push({
							...updated,
							parent_id: updated.parent_id != null ? String(updated.parent_id) : null
						} as any);
					}
					list.sort((a: any, b: any) => ((a as any).position ?? 0) - ((b as any).position ?? 0));
					return { ...map, [gid]: list };
				});
			}
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
				guildId: BigInt($selectedGuildId) as any,
				guildCreateGuildChannelRequest: {
					name: newChannelName,
					parent_id: creatingChannelParent ? (BigInt(creatingChannelParent) as any) : undefined,
					type: 0,
					private: newChannelPrivate
				}
			});
			creatingChannel = false;
			newChannelName = '';
			newChannelPrivate = false;
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
		const id = String(ch?.id ?? '');
		const type = (ch as any)?.type;
		const items = [
			{ label: m.copy_channel_id(), action: () => copyToClipboard(id), disabled: !id },
			{ label: m.open_channel(), action: () => selectChannel(id), disabled: type !== 0 },
			{ label: m.edit_channel(), action: () => openEditChannel(ch) },
			{ label: m.delete_channel(), action: () => deleteChannel(id), danger: true }
		];
		contextMenu.openFromEvent(e, items);
	}

	function openCategoryMenu(e: MouseEvent, cat: any) {
		const id = String(cat?.id ?? '');
		const items = [
			{
				label: m.new_channel(),
				action: () => {
					creatingChannel = true;
					channelError = null;
					creatingChannelParent = id;
				}
			},
			{ label: m.edit_category(), action: () => openEditCategory(cat) },
			{ label: m.delete_category(), action: () => deleteCategory(id), danger: true }
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

	function openEditChannel(ch: DtoChannel) {
		editingChannel = ch;
		editChannelName = ch.name ?? '';
		editChannelTopic = (ch as any).topic ?? '';
		editChannelPrivate = !!(ch as any).private;
		editChannelError = null;
	}

	async function saveEditChannel() {
		if (!editingChannel || !$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdChannelChannelIdPatch({
				guildId: BigInt($selectedGuildId) as any,
				channelId: BigInt((editingChannel as any).id) as any,
				guildPatchGuildChannelRequest: {
					name: editChannelName,
					topic: editChannelTopic,
					private: editChannelPrivate
				} as any
			});
			editingChannel = null;
			await refreshChannels();
		} catch (e: any) {
			editChannelError = e?.response?.data?.message ?? e?.message ?? 'Failed to update channel';
		}
	}

	function openEditCategory(cat: DtoChannel) {
		editingCategory = cat;
		editCategoryName = cat.name ?? '';
		editCategoryError = null;
	}

	async function saveEditCategory() {
		if (!editingCategory || !$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdChannelChannelIdPatch({
				guildId: BigInt($selectedGuildId) as any,
				channelId: BigInt((editingCategory as any).id) as any,
				guildPatchGuildChannelRequest: { name: editCategoryName } as any
			});
			editingCategory = null;
			await refreshChannels();
		} catch (e: any) {
			editCategoryError = e?.response?.data?.message ?? e?.message ?? 'Failed to update category';
		}
	}

	async function createCategory() {
		if (!newCategoryName.trim() || !$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdCategoryPost({
				guildId: BigInt($selectedGuildId) as any,
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
				guildId: BigInt($selectedGuildId) as any,
				categoryId: BigInt(categoryId) as any
			});
			await refreshChannels();
		} catch (e) {}
	}

	async function deleteChannel(channelId: string) {
		if (!$selectedGuildId) return;
		try {
			await auth.api.guild.guildGuildIdChannelChannelIdDelete({
				guildId: BigInt($selectedGuildId) as any,
				channelId: BigInt(channelId) as any
			});
			await refreshChannels();
		} catch (e) {}
	}

	async function leaveGuild() {
		if (!$selectedGuildId) return;
		try {
			await auth.api.user.userMeGuildsGuildIdDelete({
				guildId: BigInt($selectedGuildId) as any
			});
			await auth.loadGuilds();
			selectedGuildId.set(null);
		} catch (e) {}
	}
</script>

<div
	class="flex h-full min-h-0 w-[var(--col2)] flex-col overflow-hidden border-r border-[var(--stroke)]"
>
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
					onclick={() => guildSettingsOpen.set(true)}
					title={m.server_settings()}
					aria-label={m.server_settings()}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="currentColor"
					>
						<path
							d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.007 7.007 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.5 2h-3a.5.5 0 0 0-.49.42l-.36 2.54a6.978 6.978 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L3.1 8.14a.5.5 0 0 0 .12.64l2.03 1.58c-.05.31-.07.63-.07.94 0 .31.02.63.07.94L3.22 13.82a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.44.34.7.22l2.39-.96c.5.39 1.05.72 1.63.94l.36 2.54c.04.26.25.42.49.42h3a.5.5 0 0 0 .49-.42l.36-2.54a7.007 7.007 0 0 0 1.63-.94l2.39.96c.26.11.56.02.7-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5S10.07 8.5 12 8.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
						/>
					</svg>
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
		oncontextmenu={(e: MouseEvent) => {
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
								class="relative"
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
								{#if dragIndicator?.mode === 'before' && dragIndicator.target === String((sec.ch as any).id) && dragIndicator.parent === null}
									<div
										class="pointer-events-none absolute top-0 right-0 left-0 h-0.5 -translate-y-1/2 rounded-full bg-[var(--brand)]"
									></div>
								{/if}
								<div
									class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-[var(--panel)] {$selectedChannelId ===
									String((sec.ch as any).id)
										? 'bg-[var(--panel)]'
										: ''}"
									role="button"
									tabindex="0"
									draggable="true"
									ondragstart={() => startDrag(sec.ch, null)}
									onclick={() => selectChannel(String((sec.ch as any).id))}
									onkeydown={(e) =>
										(e.key === 'Enter' || e.key === ' ') &&
										selectChannel(String((sec.ch as any).id))}
									oncontextmenu={(e: MouseEvent) => {
										e.preventDefault();
										e.stopPropagation();
										openChannelMenu(e, sec.ch);
									}}
								>
									<div class="flex items-center gap-2 truncate">
										<span class="opacity-70">#</span>
										{sec.ch.name}
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
							<div class="relative">
								{#if dragIndicator?.mode === 'before' && dragIndicator.target === String((sec.cat as any)?.id) && dragIndicator.parent === null}
									<div
										class="pointer-events-none absolute top-0 right-0 left-0 h-0.5 -translate-y-1/2 rounded-full bg-[var(--brand)]"
									></div>
								{/if}
								<div
									class="flex items-center px-2 text-xs tracking-wide text-[var(--muted)] uppercase {dragIndicator?.mode ===
										'inside' && dragIndicator.parent === String((sec.cat as any)?.id)
										? 'rounded-md ring-2 ring-[var(--brand)]'
										: ''}"
									role="button"
									tabindex="0"
									draggable="true"
									ondragstart={() => startDrag(sec.cat, null)}
									ondragover={(e) => {
										e.preventDefault();
										e.stopPropagation();
										const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
										const before = e.clientY < rect.top + rect.height / 2;
										if (dragging?.type === 2 || before) {
											dragOverChannel(String((sec.cat as any)?.id), null);
										} else {
											dragOverContainer(String((sec.cat as any)?.id));
										}
									}}
									ondrop={(e) => {
										e.stopPropagation();
										const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
										const before = e.clientY < rect.top + rect.height / 2;
										dropOnCategoryHeader(String((sec.cat as any)?.id), before);
									}}
									oncontextmenu={(e: MouseEvent) => {
										e.preventDefault();
										e.stopPropagation();
										openCategoryMenu(e, sec.cat);
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
								</div>
							</div>
							{#if !collapsed[String((sec.cat as any)?.id)]}
								{#each sec.items.filter((c) => (c.name || '')
										.toLowerCase()
										.includes(filter.toLowerCase())) as ch (String((ch as any).id))}
									<div
										role="listitem"
										class="relative"
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
										{#if dragIndicator?.mode === 'before' && dragIndicator.target === String((ch as any).id) && dragIndicator.parent === String((sec.cat as any)?.id)}
											<div
												class="pointer-events-none absolute top-0 right-0 left-0 h-0.5 -translate-y-1/2 rounded-full bg-[var(--brand)]"
											></div>
										{/if}
										<div
											class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-[var(--panel)] {$selectedChannelId ===
											String((ch as any).id)
												? 'bg-[var(--panel)]'
												: ''}"
											role="button"
											tabindex="0"
											draggable="true"
											ondragstart={() => startDrag(ch, String((sec.cat as any)?.id))}
											onclick={() => selectChannel(String((ch as any).id))}
											onkeydown={(e) =>
												(e.key === 'Enter' || e.key === ' ') &&
												selectChannel(String((ch as any).id))}
											oncontextmenu={(e: MouseEvent) => {
												e.preventDefault();
												e.stopPropagation();
												openChannelMenu(e, ch);
											}}
										>
											<div class="flex items-center gap-2 truncate">
												<span class="opacity-70">#</span>
												{ch.name}
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

	{#if editingChannel}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onpointerdown={() => (editingChannel = null)}
			onkeydown={(e) => {
				if (e.key === 'Escape') editingChannel = null;
				if (e.key === 'Enter') saveEditChannel();
			}}
		>
			<div class="absolute inset-0 bg-black/40"></div>
			<div
				class="panel absolute top-1/2 left-1/2 w-72 -translate-x-1/2 -translate-y-1/2 p-3"
				role="document"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="mb-2 text-sm font-medium">{m.edit_channel()}</div>
				{#if editChannelError}
					<div class="mb-2 text-sm text-red-500">{editChannelError}</div>
				{/if}
				<input
					class="mb-2 w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					placeholder={m.channel_name()}
					bind:value={editChannelName}
				/>
				<input
					class="mb-2 w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					placeholder={m.channel_topic()}
					bind:value={editChannelTopic}
				/>
				<label class="mb-2 flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={editChannelPrivate} />
					{m.channel_private()}
				</label>
				<div class="flex justify-end gap-2">
					<button
						class="rounded-md border border-[var(--stroke)] px-3 py-1"
						onclick={() => (editingChannel = null)}>{m.cancel()}</button
					>
					<button
						class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)]"
						onclick={saveEditChannel}>{m.save()}</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if editingCategory}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onpointerdown={() => (editingCategory = null)}
			onkeydown={(e) => {
				if (e.key === 'Escape') editingCategory = null;
				if (e.key === 'Enter') saveEditCategory();
			}}
		>
			<div class="absolute inset-0 bg-black/40"></div>
			<div
				class="panel absolute top-1/2 left-1/2 w-72 -translate-x-1/2 -translate-y-1/2 p-3"
				role="document"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="mb-2 text-sm font-medium">{m.edit_category()}</div>
				{#if editCategoryError}
					<div class="mb-2 text-sm text-red-500">{editCategoryError}</div>
				{/if}
				<input
					class="mb-2 w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					placeholder={m.category_name()}
					bind:value={editCategoryName}
				/>
				<div class="flex justify-end gap-2">
					<button
						class="rounded-md border border-[var(--stroke)] px-3 py-1"
						onclick={() => (editingCategory = null)}>{m.cancel()}</button
					>
					<button
						class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)]"
						onclick={saveEditCategory}>{m.save()}</button
					>
				</div>
			</div>
		</div>
	{/if}

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
				<label class="mb-2 flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={newChannelPrivate} />
					{m.channel_private()}
				</label>
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
