<script lang="ts">
	import { get } from 'svelte/store';
	import { auth } from '$lib/stores/auth';
	import {
		selectedGuildId,
		selectedChannelId,
		channelsByGuild,
		messagesByChannel,
		lastChannelByGuild,
		channelReady,
		guildSettingsOpen
	} from '$lib/stores/appState';
	import type {
		DtoChannel,
		DtoRole,
		GuildChannelOrder,
		GuildChannelRolePermission
	} from '$lib/api';
	import { subscribeWS, wsEvent } from '$lib/client/ws';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	import { m } from '$lib/paraglide/messages.js';
	import UserPanel from '$lib/components/app/user/UserPanel.svelte';
	import { Check, FolderPlus, Plus, Settings, Slash, X } from 'lucide-svelte';
	import { loadGuildRolesCached } from '$lib/utils/guildRoles';
	import { CHANNEL_PERMISSION_CATEGORIES } from '$lib/utils/permissionDefinitions';
	import {
		PERMISSION_MANAGE_CHANNELS,
		PERMISSION_MANAGE_GUILD,
		PERMISSION_MANAGE_ROLES,
		hasAnyGuildPermission,
		normalizePermissionValue
	} from '$lib/utils/permissions';
	const guilds = auth.guilds;
	const me = auth.user;

	const canAccessSelectedGuildSettings = $derived.by(() => {
		const gid = $selectedGuildId;
		if (!gid) return false;
		const guild = $guilds.find((g) => String((g as any)?.id) === gid) ?? null;
		return hasAnyGuildPermission(
			guild,
			$me?.id,
			PERMISSION_MANAGE_GUILD,
			PERMISSION_MANAGE_ROLES,
			PERMISSION_MANAGE_CHANNELS
		);
	});

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
	let editChannelTab = $state<'overview' | 'permissions'>('overview');
	let editChannelRoles = $state<DtoRole[]>([]);
	let editChannelRoleToAdd = $state('');
	let editChannelOverrides = $state<Record<string, { accept: number; deny: number }>>({});
	let editChannelOverridesInitial = $state<Record<string, { accept: number; deny: number }>>({});
	let editChannelSelectedOverride = $state<string | null>(null);
	let editChannelOrderedOverrideRoleIds = $state<string[]>([]);
	let editChannelPermissionsLoading = $state(false);
	let editChannelPermissionsError: string | null = $state(null);
	let editCategoryName = $state('');
	let editCategoryError: string | null = $state(null);
	let dragging: { id: string; parent: string | null; type: number } | null = null;
	let dragIndicator = $state<{
		target: string | null;
		parent: string | null;
		mode: 'before' | 'inside';
	} | null>(null);
	let editChannelPermissionsLoadToken = 0;

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

	function toApiSnowflake(value: string): any {
		try {
			return BigInt(value) as any;
		} catch {
			return value as any;
		}
	}

	async function loadChannelPermissions(channelId: string) {
		const gid = $selectedGuildId ? String($selectedGuildId) : '';
		if (!gid || !channelId) {
			editChannelRoles = [];
			editChannelOverrides = {};
			editChannelOverridesInitial = {};
			editChannelRoleToAdd = '';
			editChannelPermissionsError = null;
			editChannelPermissionsLoading = false;
			editChannelSelectedOverride = null;
			editChannelOrderedOverrideRoleIds = [];
			return;
		}
		const token = ++editChannelPermissionsLoadToken;
		editChannelPermissionsLoading = true;
		editChannelPermissionsError = null;
		try {
			const [roles, overridesRes] = await Promise.all([
				loadGuildRolesCached(gid),
				auth.api.guildRoles.guildGuildIdChannelChannelIdRolesGet({
					guildId: toApiSnowflake(gid),
					channelId: toApiSnowflake(channelId)
				})
			]);
			if (token !== editChannelPermissionsLoadToken) {
				return;
			}
			editChannelRoles = roles;
			const list = ((overridesRes as any)?.data ??
				overridesRes ??
				[]) as GuildChannelRolePermission[];
			const map: Record<string, { accept: number; deny: number }> = {};
			for (const entry of list) {
				const roleId = entry?.role_id != null ? String(entry.role_id) : null;
				if (!roleId) continue;
				map[roleId] = {
					accept: normalizePermissionValue(entry.accept),
					deny: normalizePermissionValue(entry.deny)
				};
			}
			editChannelOverrides = map;
			editChannelOrderedOverrideRoleIds = [];
			const initial: Record<string, { accept: number; deny: number }> = {};
			for (const [roleId, value] of Object.entries(map)) {
				initial[roleId] = { ...value };
			}
			editChannelOverridesInitial = initial;
			editChannelRoleToAdd = '';
			const ordered = orderedOverrideRoleIds();
			editChannelSelectedOverride = ordered[0] ?? null;
		} catch (e: any) {
			if (token !== editChannelPermissionsLoadToken) {
				return;
			}
			editChannelPermissionsError =
				e?.response?.data?.message ?? e?.message ?? m.channel_permissions_load_error();
			editChannelRoles = [];
			editChannelOverrides = {};
			editChannelOverridesInitial = {};
			editChannelRoleToAdd = '';
			editChannelSelectedOverride = null;
			editChannelOrderedOverrideRoleIds = [];
		} finally {
			if (token === editChannelPermissionsLoadToken) {
				editChannelPermissionsLoading = false;
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

			if (ev?.t === 109 && ev?.d?.channel_id != null) {
				const gid = String(ev.d.guild_id);
				const cid = String(ev.d.channel_id);
				let list: DtoChannel[] = [];
				channelsByGuild.update((map) => {
					list = (map[gid] ?? []).filter((c) => String((c as any).id) !== cid);
					return { ...map, [gid]: list };
				});
				messagesByChannel.update((map) => {
					if (map[cid]) {
						const { [cid]: _removed, ...rest } = map;
						return rest;
					}
					return map;
				});
				const curGuild = String(get(selectedGuildId) ?? '');
				const curChannel = String(get(selectedChannelId) ?? '');
				if (curGuild === gid && curChannel === cid) {
					const next = list.find((c: any) => (c as any).type === 0);
					const nextId = next ? String((next as any).id) : null;
					selectedChannelId.set(nextId);
					if (nextId) {
						subscribeWS([gid], nextId);
						lastChannelByGuild.update((map) => ({ ...map, [gid]: nextId }));
					} else {
						lastChannelByGuild.update((map) => {
							const { [gid]: _gone, ...rest } = map;
							return rest;
						});
					}
				}
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
		editChannelTab = 'overview';
		editChannelRoleToAdd = '';
		editChannelPermissionsError = null;
		editChannelOverrides = {};
		editChannelOverridesInitial = {};
		editChannelSelectedOverride = null;
		editChannelOrderedOverrideRoleIds = [];
		editChannelRoles = [];
		const channelId = String((ch as any)?.id ?? '');
		if (channelId) {
			loadChannelPermissions(channelId);
		}
	}

	function channelPermissionState(roleId: string, value: number): 'deny' | 'inherit' | 'allow' {
		const override = editChannelOverrides[roleId];
		if (!override) return 'inherit';
		if ((override.deny & value) === value) return 'deny';
		if ((override.accept & value) === value) return 'allow';
		return 'inherit';
	}

	function setChannelPermission(
		roleId: string,
		value: number,
		state: 'deny' | 'inherit' | 'allow'
	) {
		const current = editChannelOverrides[roleId] ?? { accept: 0, deny: 0 };
		const next = { ...current };
		if (state === 'deny') {
			next.deny |= value;
			next.accept &= ~value;
		} else if (state === 'allow') {
			next.accept |= value;
			next.deny &= ~value;
		} else {
			next.accept &= ~value;
			next.deny &= ~value;
		}
		editChannelOverrides = { ...editChannelOverrides, [roleId]: next };
	}

	function addRoleOverride() {
		const roleId = editChannelRoleToAdd;
		if (!roleId || editChannelOverrides[roleId]) return;
		editChannelOverrides = {
			...editChannelOverrides,
			[roleId]: { accept: 0, deny: 0 }
		};
		const ordered = orderedOverrideRoleIds();
		editChannelSelectedOverride = roleId;
		editChannelOrderedOverrideRoleIds = ordered;
		editChannelRoleToAdd = '';
	}

	function removeRoleOverride(roleId: string) {
		const { [roleId]: _removed, ...rest } = editChannelOverrides;
		editChannelOverrides = rest;
		const ordered = orderedOverrideRoleIds();
		if (
			editChannelSelectedOverride === roleId ||
			(editChannelSelectedOverride && !ordered.includes(editChannelSelectedOverride))
		) {
			editChannelSelectedOverride = ordered[0] ?? null;
		}
		editChannelOrderedOverrideRoleIds = ordered;
	}

	function getRoleId(role: DtoRole | null | undefined): string | null {
		if (!role) return null;
		const raw = (role as any)?.id;
		if (raw == null) return null;
		try {
			return String(raw);
		} catch {
			return null;
		}
	}

	function roleDisplayName(role: DtoRole | null | undefined, fallbackId: string): string {
		const name = (role as any)?.name;
		if (typeof name === 'string' && name.trim()) return name;
		return `Role ${fallbackId}`;
	}

	function availableRolesForOverrides(): DtoRole[] {
		const used = new Set(Object.keys(editChannelOverrides));
		return editChannelRoles.filter((role) => {
			const id = getRoleId(role);
			return id != null && !used.has(id);
		});
	}

	function orderedOverrideRoleIds(): string[] {
		const ids = Object.keys(editChannelOverrides);
		if (!ids.length) {
			if (editChannelOrderedOverrideRoleIds.length) {
				editChannelOrderedOverrideRoleIds = [];
			}
			return ids;
		}
		const remaining = new Set(ids);
		const next: string[] = [];
		for (const existing of editChannelOrderedOverrideRoleIds) {
			if (remaining.delete(existing)) {
				next.push(existing);
			}
		}
		for (const role of editChannelRoles) {
			const id = getRoleId(role);
			if (id && remaining.delete(id)) {
				next.push(id);
			}
		}
		for (const id of remaining) {
			next.push(id);
		}
		if (
			next.length !== editChannelOrderedOverrideRoleIds.length ||
			next.some((id, index) => editChannelOrderedOverrideRoleIds[index] !== id)
		) {
			editChannelOrderedOverrideRoleIds = next;
		}
		return next;
	}

	async function saveChannelPermissionOverrides(gid: string, channelId: string) {
		const updates: Promise<any>[] = [];
		const roleIds = new Set([
			...Object.keys(editChannelOverridesInitial),
			...Object.keys(editChannelOverrides)
		]);
		for (const roleId of roleIds) {
			if (!roleId) continue;
			const next = editChannelOverrides[roleId];
			const initial = editChannelOverridesInitial[roleId];
			const nextAccept = next?.accept ?? 0;
			const nextDeny = next?.deny ?? 0;
			const initialAccept = initial?.accept ?? 0;
			const initialDeny = initial?.deny ?? 0;
			if (nextAccept === initialAccept && nextDeny === initialDeny) continue;
			const baseParams = {
				guildId: toApiSnowflake(gid),
				channelId: toApiSnowflake(channelId),
				roleId: toApiSnowflake(roleId)
			} as const;
			if (nextAccept === 0 && nextDeny === 0) {
				updates.push(
					auth.api.guildRoles.guildGuildIdChannelChannelIdRolesRoleIdDelete({
						...baseParams
					})
				);
			} else {
				updates.push(
					auth.api.guildRoles.guildGuildIdChannelChannelIdRolesRoleIdPut({
						...baseParams,
						guildChannelRolePermissionRequest: {
							accept: nextAccept,
							deny: nextDeny
						} as any
					})
				);
			}
		}
		if (updates.length) {
			await Promise.all(updates);
		}
	}

	function closeEditChannel() {
		editChannelPermissionsLoadToken += 1;
		editingChannel = null;
		editChannelError = null;
		editChannelTab = 'overview';
		editChannelRoles = [];
		editChannelRoleToAdd = '';
		editChannelOverrides = {};
		editChannelOverridesInitial = {};
		editChannelPermissionsLoading = false;
		editChannelPermissionsError = null;
		editChannelSelectedOverride = null;
		editChannelOrderedOverrideRoleIds = [];
	}

	async function saveEditChannel() {
		if (!editingChannel || !$selectedGuildId) return;
		const channelId = String((editingChannel as any)?.id ?? '');
		if (!channelId) return;
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
			await saveChannelPermissionOverrides($selectedGuildId, channelId);
			closeEditChannel();
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
</script>

<svelte:window on:keydown={(e) => editingChannel && e.key === 'Escape' && closeEditChannel()} />

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
					<Plus class="h-4 w-4" stroke-width={2} />
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
					<FolderPlus class="h-4 w-4" stroke-width={2} />
				</button>
				{#if canAccessSelectedGuildSettings}
					<button
						class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
						onclick={() => {
							if (!canAccessSelectedGuildSettings) return;
							guildSettingsOpen.set(true);
						}}
						title={m.server_settings()}
						aria-label={m.server_settings()}
					>
						<Settings class="h-4 w-4" stroke-width={2} />
					</button>
				{/if}
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
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			role="dialog"
			aria-modal="true"
			onpointerdown={closeEditChannel}
		>
			<div
				class="relative flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg bg-[var(--bg)] shadow-xl"
				role="document"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<button
					aria-label={m.close()}
					class="absolute top-3 right-3 rounded p-1 text-xl leading-none hover:bg-[var(--panel)]"
					onclick={closeEditChannel}
				>
					&times;
				</button>
				<aside class="w-48 space-y-2 border-r border-[var(--stroke)] p-4">
					<div class="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
						{m.channel_settings()}
					</div>
					<button
						class={`w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] ${
							editChannelTab === 'overview' ? 'bg-[var(--panel)] font-semibold' : ''
						}`}
						onclick={() => (editChannelTab = 'overview')}
					>
						{m.channel_tab_overview()}
					</button>
					<button
						class={`w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] ${
							editChannelTab === 'permissions' ? 'bg-[var(--panel)] font-semibold' : ''
						}`}
						onclick={() => (editChannelTab = 'permissions')}
					>
						{m.channel_tab_permissions()}
					</button>
				</aside>
                                <section class="flex flex-1 flex-col">
                                        <div class="scroll-area flex-1 space-y-4 overflow-y-auto p-4">
                                                <h2 class="text-lg font-semibold">{m.edit_channel()}</h2>
                                                {#if editChannelError}
                                                        <div class="rounded border border-red-500 bg-red-500/10 p-2 text-sm text-red-400">
                                                                {editChannelError}
							</div>
						{/if}
						{#if editChannelTab === 'overview'}
							<div class="space-y-4">
								<div>
									<label for="channel-name" class="mb-1 block text-sm font-medium">
										{m.channel_name()}
									</label>
									<input
										id="channel-name"
										class="w-full rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
										placeholder={m.channel_name()}
										bind:value={editChannelName}
									/>
								</div>
								<div>
									<label for="channel-topic" class="mb-1 block text-sm font-medium">
										{m.channel_topic()}
									</label>
									<input
										id="channel-topic"
										class="w-full rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
										placeholder={m.channel_topic()}
										bind:value={editChannelTopic}
									/>
								</div>
							</div>
						{:else if editChannelTab === 'permissions'}
							{@const availableRoleOptions = availableRolesForOverrides()}
							{@const overrideRoleIds = orderedOverrideRoleIds()}
							<div class="space-y-4">
								{#if editChannelPermissionsError}
									<div class="rounded border border-red-500 bg-red-500/10 p-2 text-sm text-red-400">
										{editChannelPermissionsError}
									</div>
								{/if}
								<div class="rounded border border-[var(--stroke)] bg-[var(--panel)] p-4">
									<label class="flex items-center gap-2 text-sm font-medium">
										<input type="checkbox" bind:checked={editChannelPrivate} />
										{m.channel_permissions_private_label()}
									</label>
									<p class="mt-1 text-xs text-[var(--muted)]">
										{m.channel_permissions_private_desc()}
									</p>
								</div>
								<div class="space-y-4 rounded border border-[var(--stroke)] bg-[var(--panel)] p-4">
									<div class="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
										<select
											class="flex-1 rounded border border-[var(--stroke)] bg-[var(--bg)] px-3 py-2 focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
											bind:value={editChannelRoleToAdd}
											disabled={editChannelPermissionsLoading || availableRoleOptions.length === 0}
										>
											<option value="">{m.channel_permissions_select_role()}</option>
											{#each availableRoleOptions as role}
												{@const rid = getRoleId(role)!}
												<option value={rid}>{roleDisplayName(role, rid)}</option>
											{/each}
										</select>
										<button
											class="rounded bg-[var(--brand)] px-3 py-2 text-[var(--bg)] disabled:opacity-50"
											onclick={addRoleOverride}
											disabled={!editChannelRoleToAdd}
										>
											{m.channel_permissions_add_role()}
										</button>
									</div>
									{#if editChannelPermissionsLoading}
										<p class="text-sm text-[var(--muted)]">{m.loading()}</p>
									{/if}
									{#if overrideRoleIds.length > 0}
										<div class="space-y-3">
											<div class="space-y-2">
												<div
													class="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase"
												>
													{m.channel_permissions_role_overrides_label()}
												</div>
												<div class="flex gap-2 overflow-x-auto pb-1">
													{#each overrideRoleIds as roleId}
														{@const role = editChannelRoles.find((r) => getRoleId(r) === roleId)}
														<button
															type="button"
															class={`rounded-full border border-[var(--stroke)] px-3 py-1 text-sm whitespace-nowrap transition ${
																editChannelSelectedOverride === roleId
																	? 'bg-[var(--brand)] text-[var(--bg)]'
																	: 'bg-[var(--bg)] hover:bg-[var(--panel-strong)]'
															}`}
															onclick={() => (editChannelSelectedOverride = roleId)}
															aria-pressed={editChannelSelectedOverride === roleId}
														>
															{roleDisplayName(role, roleId)}
														</button>
													{/each}
												</div>
											</div>
											{#if editChannelSelectedOverride && overrideRoleIds.includes(editChannelSelectedOverride)}
												{@const selectedOverrideId = editChannelSelectedOverride as string}
												{@const selectedRole = editChannelRoles.find(
													(r) => getRoleId(r) === selectedOverrideId
												)}
												<div
													class="space-y-3 rounded border border-[var(--stroke)] bg-[var(--bg)] p-4"
												>
													<div
														class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
													>
														<div class="text-sm font-semibold">
															{roleDisplayName(selectedRole, selectedOverrideId)}
														</div>
														<button
															type="button"
															class="text-xs text-red-500 hover:underline"
															onclick={() => removeRoleOverride(selectedOverrideId)}
														>
															{m.channel_permissions_remove_role()}
														</button>
													</div>
													{#each CHANNEL_PERMISSION_CATEGORIES as category}
														<div>
															<div
																class="mb-2 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase"
															>
																{category.label()}
															</div>
															<div class="space-y-3">
																{#each category.permissions as perm}
																	{@const state = channelPermissionState(
																		selectedOverrideId,
																		perm.value
																	)}
																	<div
																		class="rounded border border-[var(--stroke)] bg-[var(--bg)] p-3"
																	>
																		<div class="flex items-start justify-between gap-4">
																			<div>
																				<div class="text-sm font-medium">{perm.label()}</div>
																				<div class="text-xs text-[var(--muted)]">
																					{perm.description()}
																				</div>
																			</div>
																			<div
																				class="flex overflow-hidden rounded border border-[var(--stroke)] text-xs font-semibold"
																			>
																				<button
																					class={`px-2 py-1 transition ${
																						state === 'deny'
																							? 'bg-red-500 text-white'
																							: 'bg-transparent hover:bg-red-500/10'
																					}`}
																					onclick={() =>
																						setChannelPermission(
																							selectedOverrideId,
																							perm.value,
																							'deny'
																						)}
																					aria-label={m.permission_deny()}
																					title={m.permission_deny()}
																				>
																					<X class="h-4 w-4" stroke-width={2} />
																				</button>
																				<button
																					class={`px-2 py-1 transition ${
																						state === 'inherit'
																							? 'bg-[var(--panel)]'
																							: 'bg-transparent hover:bg-[var(--panel)]/60'
																					}`}
																					onclick={() =>
																						setChannelPermission(
																							selectedOverrideId,
																							perm.value,
																							'inherit'
																						)}
																					aria-label={m.permission_default()}
																					title={m.permission_default()}
																				>
																					<Slash class="h-4 w-4" stroke-width={2} />
																				</button>
																				<button
																					class={`px-2 py-1 transition ${
																						state === 'allow'
																							? 'bg-green-500 text-white'
																							: 'bg-transparent hover:bg-green-500/10'
																					}`}
																					onclick={() =>
																						setChannelPermission(
																							selectedOverrideId,
																							perm.value,
																							'allow'
																						)}
																					aria-label={m.permission_allow()}
																					title={m.permission_allow()}
																				>
																					<Check class="h-4 w-4" stroke-width={2} />
																				</button>
																			</div>
																		</div>
																	</div>
																{/each}
															</div>
														</div>
													{/each}
												</div>
											{:else}
												<p class="text-sm text-[var(--muted)]">
													{m.channel_permissions_select_override_prompt()}
												</p>
											{/if}
										</div>
									{:else if !editChannelPermissionsLoading}
										<p class="text-sm text-[var(--muted)]">
											{m.channel_permissions_empty()}
										</p>
									{/if}
								</div>
                                                        </div>
                                                {/if}
                                        </div>
                                        <div class="flex justify-end gap-2 border-t border-[var(--stroke)] bg-[var(--panel)] p-4">
                                                <button
                                                        class="rounded-md border border-[var(--stroke)] px-3 py-1"
                                                        onclick={closeEditChannel}
                                                >
                                                        {m.cancel()}
                                                </button>
                                                <button
                                                        class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)]"
                                                        onclick={saveEditChannel}
                                                >
                                                        {m.save()}
                                                </button>
                                        </div>
                                </section>
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
