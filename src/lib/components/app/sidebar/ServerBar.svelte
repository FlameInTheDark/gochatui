<script lang="ts">
	import type { DtoGuild } from '$lib/api';
	import { m } from '$lib/paraglide/messages.js';
	import { tooltip } from '$lib/actions/tooltip';
	import {
		appSettings,
		createFolderWithGuilds,
		moveFolder,
		moveGuildToFolder,
		moveGuildToTop,
		folderSettingsOpen,
		folderSettingsRequest
	} from '$lib/stores/settings';
	import { auth } from '$lib/stores/auth';
	import {
		activeView,
		channelReady,
		guildSettingsOpen,
		selectedChannelId,
		selectedGuildId
	} from '$lib/stores/appState';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	import type { ContextMenuActionItem, ContextMenuItem } from '$lib/stores/contextMenu';
	import {
		NOTIFICATION_LEVELS,
		resolveNotificationLevel,
		setGuildNotificationLevel,
		type GuildFolderItem,
		type GuildLayoutItem,
		type GuildLayoutGuild,
		type NotificationLevel
	} from '$lib/stores/settings';
	import { Check, Folder, Plus, User } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { selectGuild } from '$lib/utils/guildSelection';
	import {
		PERMISSION_MANAGE_CHANNELS,
		PERMISSION_MANAGE_GUILD,
		PERMISSION_MANAGE_ROLES,
		hasAnyGuildPermission
	} from '$lib/utils/permissions';
	import { guildUnreadSummary } from '$lib/stores/unread';
	import { colorIntToHex, parseColorValue } from '$lib/utils/color';
	import { resolveIconUrl } from '$lib/utils/icon';
	import {
		FOLDER_MENTION_BADGE_CLASSES,
		FOLDER_UNREAD_BADGE_CLASSES,
		SERVER_MENTION_BADGE_CLASSES,
		SERVER_UNREAD_BADGE_CLASSES
	} from '$lib/constants/unreadIndicator';
	import { customContextMenuTarget } from '$lib/actions/customContextMenuTarget';
	import { guildMentionSummary } from '$lib/stores/mentions';

	const guilds = auth.guilds;
	const me = auth.user;
	const unreadSummary = guildUnreadSummary;
	const mentionSummary = guildMentionSummary;
	const view = activeView;
        const homeMentionCount = $derived.by(() => userHomeMentionCount());
        const homeHasUnread = $derived.by(() => userHomeHasUnread());

        const UNREAD_INDICATOR_CLASSES = SERVER_UNREAD_BADGE_CLASSES;
        const FOLDER_UNREAD_INDICATOR_CLASSES = FOLDER_UNREAD_BADGE_CLASSES;
        const SERVER_MENTION_INDICATOR_CLASSES = SERVER_MENTION_BADGE_CLASSES;
        const FOLDER_MENTION_INDICATOR_CLASSES = FOLDER_MENTION_BADGE_CLASSES;
        const UNREAD_INDICATOR_POSITION_CLASSES =
                'pointer-events-none absolute left-0 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 justify-center transition-all duration-150';
        const FOLDER_UNREAD_INDICATOR_POSITION_CLASSES = UNREAD_INDICATOR_POSITION_CLASSES;
        const INDICATOR_OFFSET_ROOT = '0.75rem + 0.5rem';
        const INDICATOR_OFFSET_NESTED = '0.75rem + 0.5rem + 0.5rem';

        function indicatorStyle(offset: string): string {
                return `margin-left: calc(-1 * (${offset}));`;
        }

	type DisplayGuild = {
		type: 'guild';
		guild: DtoGuild;
		guildId: string;
		topIndex: number;
		folderId: string | null;
		folderIndex: number | null;
		layout: GuildLayoutGuild | null;
	};

	type DisplayFolder = {
		type: 'folder';
		folder: GuildFolderItem;
		topIndex: number;
		guilds: DisplayGuild[];
	};

	type DisplayItem = DisplayGuild | DisplayFolder;

	type DragState =
		| { type: 'guild'; guildId: string; fromFolderId: string | null }
		| { type: 'folder'; folderId: string };

	let creating = $state(false);
	let newGuildName = $state('');
	let error: string | null = $state(null);
	let leavingGuild = $state<{ id: string; name: string } | null>(null);

	let expandedFolders = $state<Record<string, boolean>>({});
	let dragging: DragState | null = $state(null);
	let topDropIndex: number | null = $state(null);
	let folderDropTarget = $state<{ folderId: string; index: number } | null>(null);
	let mergeTargetGuild: string | null = $state(null);
	let displayItems = $state<DisplayItem[]>([]);

	$effect(() => {
		const availableFolders = new Set(
			$appSettings.guildLayout
				.filter((item): item is GuildFolderItem => item.kind === 'folder')
				.map((folder) => folder.id)
		);
		const next: Record<string, boolean> = {};
		for (const id of Object.keys(expandedFolders)) {
			if (availableFolders.has(id)) {
				next[id] = expandedFolders[id];
			}
		}

		const keys = new Set([...Object.keys(next), ...Object.keys(expandedFolders)]);
		const changed = Array.from(keys).some((key) => expandedFolders[key] !== next[key]);
		if (!changed) return;

		expandedFolders = next;
	});

	function guildInitials(guild: DtoGuild | null | undefined): string {
		const name = String((guild as any)?.name ?? '?');
		return name.slice(0, 2).toUpperCase();
	}

	function guildIconUrl(guild: DtoGuild | null | undefined): string | null {
		return resolveIconUrl((guild as any)?.icon);
	}

	function toSnowflakeString(value: unknown): string | null {
		if (value == null) return null;
		try {
			if (typeof value === 'string') return value;
			if (typeof value === 'number' || typeof value === 'bigint') return BigInt(value).toString();
			return String(value);
		} catch {
			try {
				return String(value);
			} catch {
				return null;
			}
		}
	}

	function formatMentionCount(count: number): string {
		return count > 99 ? '99+' : String(count);
	}

	function guildMentionCount(guildId: unknown): number {
		const gid = toSnowflakeString(guildId);
		if (!gid) return 0;
		const entry = $mentionSummary?.[gid] ?? null;
		return entry?.mentionCount ?? 0;
	}

	function folderMentionCount(folder: DisplayFolder): number {
		return folder.guilds.reduce((total, nested) => total + guildMentionCount(nested.guildId), 0);
	}

	function userHomeMentionCount(): number {
		return guildMentionCount('@me');
	}

	function guildHasUnread(guildId: unknown): boolean {
		const gid = toSnowflakeString(guildId);
		if (!gid) return false;
		const entry = $unreadSummary?.[gid];
		if (guildMentionCount(gid) > 0) {
			return true;
		}
		return Boolean(entry?.channelCount);
	}

	function userHomeHasUnread(): boolean {
		if (userHomeMentionCount() > 0) {
			return true;
		}
		const entry = $unreadSummary?.['@me'];
		return Boolean(entry?.channelCount);
	}

	function canAccessGuildSettings(guild: any): boolean {
		return hasAnyGuildPermission(
			guild,
			$me?.id,
			PERMISSION_MANAGE_GUILD,
			PERMISSION_MANAGE_ROLES,
			PERMISSION_MANAGE_CHANNELS
		);
	}

	function openGuildSettings(gid: string) {
		const targetGuild = $guilds.find((g) => String((g as any)?.id) === gid);
		if (!canAccessGuildSettings(targetGuild)) return;
		selectGuild(gid);
		guildSettingsOpen.set(true);
	}

	function buildDisplayItems(list: DtoGuild[], layout: GuildLayoutItem[]): DisplayItem[] {
		const guildMap = new Map<string, DtoGuild>();
		for (const guild of list) {
			const gid = String((guild as any)?.id ?? '');
			if (gid) guildMap.set(gid, guild);
		}

		const seen = new Set<string>();
		const items: DisplayItem[] = [];
		let index = 0;
		for (const item of layout) {
			if (item.kind === 'guild') {
				const guild = guildMap.get(item.guildId);
				if (!guild) {
					index++;
					continue;
				}
				seen.add(item.guildId);
				items.push({
					type: 'guild',
					guild,
					guildId: item.guildId,
					topIndex: index++,
					folderId: null,
					folderIndex: null,
					layout: item
				});
			} else {
				const folderGuilds: DisplayGuild[] = [];
				item.guilds.forEach((entry, folderIndex) => {
					const guild = guildMap.get(entry.guildId);
					if (!guild) return;
					seen.add(entry.guildId);
					folderGuilds.push({
						type: 'guild',
						guild,
						guildId: entry.guildId,
						topIndex: index,
						folderId: item.id,
						folderIndex,
						layout: entry
					});
				});
				if (folderGuilds.length > 0) {
					items.push({
						type: 'folder',
						folder: item,
						topIndex: index++,
						guilds: folderGuilds
					});
				} else {
					index++;
				}
			}
		}

		for (const guild of list) {
			const gid = String((guild as any)?.id ?? '');
			if (!gid || seen.has(gid)) continue;
			items.push({
				type: 'guild',
				guild,
				guildId: gid,
				topIndex: index++,
				folderId: null,
				folderIndex: null,
				layout: null
			});
		}

		return items;
	}

	$effect(() => {
		displayItems = buildDisplayItems($guilds ?? [], $appSettings.guildLayout);
	});

	$effect(() => {
		const selected = $selectedGuildId;
		if (!selected) return;
		for (const item of displayItems) {
			if (item.type !== 'folder') continue;
			if (!item.guilds.some((g) => g.guildId === selected)) continue;

			if (!Object.prototype.hasOwnProperty.call(expandedFolders, item.folder.id)) {
				expandedFolders = {
					...expandedFolders,
					[item.folder.id]: true
				};
			}
			break;
		}
	});

	function startGuildDrag(event: DragEvent, guildId: string, fromFolderId: string | null) {
		dragging = { type: 'guild', guildId, fromFolderId };
		topDropIndex = null;
		folderDropTarget = null;
		mergeTargetGuild = null;
		event.dataTransfer?.setData('text/plain', guildId);
		event.dataTransfer?.setDragImage(new Image(), 0, 0);
	}

	function startFolderDrag(event: DragEvent, folderId: string) {
		dragging = { type: 'folder', folderId };
		topDropIndex = null;
		folderDropTarget = null;
		mergeTargetGuild = null;
		event.dataTransfer?.setData('text/plain', folderId);
		event.dataTransfer?.setDragImage(new Image(), 0, 0);
	}

	function endDrag() {
		dragging = null;
		topDropIndex = null;
		folderDropTarget = null;
		mergeTargetGuild = null;
	}

	function onTopDragOver(event: DragEvent, index: number) {
		if (!dragging) return;
		event.preventDefault();
		topDropIndex = index;
		folderDropTarget = null;
		mergeTargetGuild = null;
	}

	function onTopDrop(event: DragEvent, index: number) {
		if (!dragging) return;
		event.preventDefault();
		if (dragging.type === 'guild') {
			moveGuildToTop(dragging.guildId, index);
		} else {
			moveFolder(dragging.folderId, index);
		}
		endDrag();
	}

	function onFolderDropZoneOver(event: DragEvent, folderId: string, index: number) {
		if (!dragging || dragging.type !== 'guild') return;
		event.preventDefault();
		event.stopPropagation();
		folderDropTarget = { folderId, index };
		topDropIndex = null;
		mergeTargetGuild = null;
	}

	function onFolderDrop(event: DragEvent, folderId: string, index: number) {
		if (!dragging || dragging.type !== 'guild') return;
		event.preventDefault();
		event.stopPropagation();
		moveGuildToFolder(dragging.guildId, folderId, index);
		expandedFolders = { ...expandedFolders, [folderId]: true };
		endDrag();
	}

	function onGuildMergeOver(
		event: DragEvent,
		guildId: string,
		topIndex: number,
		folderId: string | null
	) {
		if (!dragging || dragging.type !== 'guild') return;
		if (dragging.guildId === guildId) return;
		if (folderId) return;
		event.preventDefault();
		event.stopPropagation();
		mergeTargetGuild = guildId;
		topDropIndex = null;
		folderDropTarget = null;
	}

	function onGuildMergeDrop(event: DragEvent, guildId: string, topIndex: number) {
		if (!dragging || dragging.type !== 'guild') return;
		if (dragging.guildId === guildId) return;
		event.preventDefault();
		event.stopPropagation();
		const folderId = createFolderWithGuilds(guildId, dragging.guildId, topIndex);
		if (folderId) {
			expandedFolders = { ...expandedFolders, [folderId]: true };
		}
		endDrag();
	}

	async function createGuild() {
		if (!newGuildName.trim()) return;
		try {
			await auth.api.guild.guildPost({ guildCreateGuildRequest: { name: newGuildName } });
			creating = false;
			newGuildName = '';
			error = null;
			await auth.loadGuilds();
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'Failed to create guild';
		}
	}

	async function leaveGuildDirect(gid: string) {
		try {
			await auth.api.user.userMeGuildsGuildIdDelete({ guildId: gid as any });
			await auth.loadGuilds();
		} catch {
			/* ignore */
		}
	}

	async function confirmLeaveGuild() {
		if (!leavingGuild) return;
		const { id } = leavingGuild;
		leavingGuild = null;
		await leaveGuildDirect(id);
		if ($selectedGuildId === id) {
			selectedGuildId.set(null);
		}
	}

	function findLayoutGuildEntry(guildId: string): GuildLayoutGuild | null {
		for (const item of $appSettings.guildLayout) {
			if (item.kind === 'guild') {
				if (item.guildId === guildId) {
					return item;
				}
				continue;
			}
			for (const guild of item.guilds) {
				if (guild.guildId === guildId) {
					return guild;
				}
			}
		}
		return null;
	}

	function buildNotificationMenuItems(
		current: NotificationLevel,
		onSelect: (level: NotificationLevel) => void
	): ContextMenuActionItem[] {
		return [
			{
				label: m.ctx_notifications_all(),
				icon: current === NOTIFICATION_LEVELS.ALL ? Check : undefined,
				action: () => onSelect(NOTIFICATION_LEVELS.ALL)
			},
			{
				label: m.ctx_notifications_mentions(),
				icon: current === NOTIFICATION_LEVELS.MENTIONS ? Check : undefined,
				action: () => onSelect(NOTIFICATION_LEVELS.MENTIONS)
			},
			{
				label: m.ctx_notifications_none(),
				icon: current === NOTIFICATION_LEVELS.NONE ? Check : undefined,
				action: () => onSelect(NOTIFICATION_LEVELS.NONE)
			}
		];
	}

	function openGuildMenu(
		event: MouseEvent,
		guild: DtoGuild,
		layoutEntry: GuildLayoutGuild | null = null
	) {
		event.preventDefault();
		const gid = String((guild as any)?.id ?? '');
		const name = String((guild as any)?.name ?? 'Server');
		if (!gid) return;
		const effectiveLayout = layoutEntry ?? findLayoutGuildEntry(gid);
		const notificationItems = buildNotificationMenuItems(
			resolveNotificationLevel(effectiveLayout?.notifications),
			(level) => setGuildNotificationLevel(gid, level)
		);
		const menuItems: ContextMenuItem[] = [
			{ label: m.ctx_notifications_menu(), children: notificationItems },
			{ label: m.copy_server_id(), action: () => copyToClipboard(gid) }
		];
		if (canAccessGuildSettings(guild)) {
			menuItems.push({
				label: m.server_settings(),
				action: () => openGuildSettings(gid)
			});
		}
		menuItems.push({
			label: m.leave_server(),
			action: () => {
				leavingGuild = { id: gid, name };
			},
			danger: true
		});
		contextMenu.openFromEvent(event, menuItems);
	}

	function openFolderMenu(event: MouseEvent, folder: DisplayFolder) {
		event.preventDefault();
		event.stopPropagation();
		const menuItems: ContextMenuItem[] = [
			{
				label: m.folder_settings_action(),
				action: () => {
					folderSettingsOpen.set(true);
					folderSettingsRequest.set({
						folderId: folder.folder.id,
						requestId: Date.now()
					});
				}
			}
		];
		contextMenu.openFromEvent(event, menuItems);
	}

	function isGuildSelected(guildId: string): boolean {
		return $selectedGuildId === guildId;
	}

	function selectGuildFromSidebar(id: string) {
		selectGuild(id);
	}

	function openUserHome() {
		activeView.set('user');
		selectedGuildId.set(null);
		selectedChannelId.set(null);
		channelReady.set(false);
	}

	function ensureDefaultGuildSelection() {
		const list = $guilds ?? [];
		if (!list.length) return;

		const currentExists =
			$selectedGuildId && list.some((g: any) => String((g as any)?.id) === $selectedGuildId);

		if ($view !== 'guild') {
			if (!currentExists && $selectedGuildId) {
				selectedGuildId.set(null);
				channelReady.set(false);
			}
			return;
		}

		if (currentExists) return;

		const fallbackId = String((list[0] as any)?.id ?? '');
		if (fallbackId) {
			selectGuildFromSidebar(fallbackId);
		}
	}

	function resolveFolderColor(color: GuildFolderItem['color']): string | null {
		const numeric = parseColorValue(color);
		if (numeric == null || numeric <= 0) {
			return null;
		}

		return colorIntToHex(numeric);
	}

	function computeFolderColorTokens(color: GuildFolderItem['color']) {
		const resolved = resolveFolderColor(color);
		if (!resolved) {
			return null;
		}

		return {
			resolved,
			collapsedBorder: `color-mix(in srgb, ${resolved} 65%, transparent)`,
			collapsedBackground: `color-mix(in srgb, var(--panel-strong) 75%, ${resolved} 25%)`,
			hoverBackground: `color-mix(in srgb, var(--panel-strong) 65%, ${resolved} 35%)`,
			expandedBorder: `color-mix(in srgb, ${resolved} 45%, transparent)`,
			expandedBackground: `color-mix(in srgb, var(--panel-strong) 85%, ${resolved} 15%)`
		} as const;
	}

	onMount(() => {
		const unsubscribeGuilds = guilds.subscribe(() => {
			ensureDefaultGuildSelection();
		});
		const unsubscribeView = view.subscribe(() => {
			ensureDefaultGuildSelection();
		});
		ensureDefaultGuildSelection();
		return () => {
			unsubscribeGuilds();
			unsubscribeView();
		};
	});
</script>

<div
        class="flex h-full w-[var(--col1)] flex-col items-center gap-2 border-r border-[var(--stroke)] p-2"
>
        <div class="group/home relative flex w-full justify-center overflow-visible px-3">
                <div class="relative h-12 w-12 shrink-0 overflow-visible">
                        {#if homeMentionCount === 0}
                                <span
                                        aria-hidden="true"
                                        class={UNREAD_INDICATOR_POSITION_CLASSES}
                                        style={indicatorStyle(INDICATOR_OFFSET_ROOT)}
                                >
                                        <span
                                                class={`${UNREAD_INDICATOR_CLASSES} group-hover/home:h-7 group-hover/home:w-2 group-hover/home:rounded-lg group-hover/home:shadow-[0_0_0_2px_var(--panel-strong)] ${
                                                        homeHasUnread ? 'opacity-100' : 'opacity-0 group-hover/home:opacity-100'
                                                }`}
                                        ></span>
                                </span>
                        {/if}
                        <button
                                class={`relative flex h-full w-full transform items-center justify-center overflow-visible rounded-xl border border-[var(--stroke)] bg-[var(--panel-strong)] transition-all duration-150 hover:-translate-y-0.5 hover:scale-105 hover:bg-[var(--panel)] hover:ring-2 hover:ring-[var(--brand)] hover:ring-inset focus-visible:outline-none ${
                                        $view === 'user' ? 'shadow ring-2 ring-[var(--brand)] ring-inset' : ''
                                }`}
				data-tooltip-disabled
				use:tooltip={{
					content: () => m.user_home_open_label(),
					placement: 'right'
				}}
				aria-current={$view === 'user' ? 'true' : 'false'}
				aria-label={m.user_home_open_label()}
				onclick={openUserHome}
			>
				{#if homeMentionCount > 0}
					<span class="sr-only">{m.unread_mentions_indicator({ count: homeMentionCount })}</span>
				{:else if homeHasUnread}
					<span class="sr-only">{m.unread_indicator()}</span>
				{/if}
				<User class="h-5 w-5" stroke-width={2} />
			</button>
                        {#if homeMentionCount > 0}
                                <span aria-hidden="true" class={SERVER_MENTION_INDICATOR_CLASSES}
                                        >{formatMentionCount(homeMentionCount)}</span
                                >
                        {/if}
                </div>
        </div>
        <div class="scroll-area flex flex-1 flex-col overflow-y-auto pt-1">
                <div class="server-scroll flex flex-1 flex-col gap-2 px-3">
                        <div
                                class={`h-2 w-full rounded bg-[var(--brand)] transition-opacity ${
                                        topDropIndex === 0 ? 'opacity-80' : 'opacity-0'
                                }`}
                                ondragover={(event) => onTopDragOver(event, 0)}
                                ondrop={(event) => onTopDrop(event, 0)}
                                role="presentation"
                        ></div>
                        {#each displayItems as item, displayIndex (item.type === 'folder' ? `folder-${item.folder.id}` : `guild-${item.guildId}`)}
			{#if item.type === 'guild'}
				{@const guildUnread = guildHasUnread(item.guildId)}
				{@const guildMentionTotal = guildMentionCount(item.guildId)}
				{@const showGuildIndicator = guildMentionTotal === 0}
				{@const guildIcon = guildIconUrl(item.guild)}
                                <div class="group/server relative flex w-full justify-center overflow-visible">
                                        <div class="relative h-12 w-12 shrink-0 overflow-visible">
                                                {#if showGuildIndicator}
                                                        <span
                                                                aria-hidden="true"
                                                                class={UNREAD_INDICATOR_POSITION_CLASSES}
                                                                style={indicatorStyle(INDICATOR_OFFSET_ROOT)}
                                                        >
                                                                <span
                                                                        class={`${UNREAD_INDICATOR_CLASSES} group-hover/server:h-7 group-hover/server:w-2 group-hover/server:rounded-lg group-hover/server:shadow-[0_0_0_2px_var(--panel-strong)] ${
                                                                                guildUnread ? 'opacity-100' : 'opacity-0 group-hover/server:opacity-100'
                                                                        }`}
                                                                ></span>
                                                        </span>
                                                {/if}
                                                <button
                                                        class={`relative flex h-full w-full transform items-center justify-center overflow-visible rounded-xl border border-[var(--stroke)] bg-[var(--panel-strong)] transition-all duration-150 hover:-translate-y-0.5 hover:scale-105 hover:bg-[var(--panel)] hover:ring-2 hover:ring-[var(--brand)] hover:ring-inset focus-visible:outline-none ${
                                                                isGuildSelected(item.guildId) ? 'shadow ring-2 ring-[var(--brand)] ring-inset' : ''
                                                        } ${mergeTargetGuild === item.guildId ? 'ring-2 ring-[var(--brand)]' : ''}`}
							data-tooltip-disabled
							use:tooltip={{
								content: () => item.guild.name ?? 'Server',
								placement: 'right'
							}}
							aria-current={isGuildSelected(item.guildId) ? 'true' : 'false'}
							aria-label={item.guild.name ?? 'Server'}
							draggable="true"
							use:customContextMenuTarget
							ondragstart={(event) => startGuildDrag(event, item.guildId, item.folderId)}
							ondragend={endDrag}
							ondragover={(event) =>
								onGuildMergeOver(event, item.guildId, item.topIndex, item.folderId)}
							ondrop={(event) => onGuildMergeDrop(event, item.guildId, item.topIndex)}
							onclick={() => selectGuildFromSidebar(item.guildId)}
							oncontextmenu={(event) => openGuildMenu(event, item.guild, item.layout)}
						>
							{#if guildIcon}
								<img
									src={guildIcon}
									alt=""
									aria-hidden="true"
									class="h-full w-full rounded-xl object-cover"
									loading="lazy"
								/>
							{:else}
								<span class="font-bold">{guildInitials(item.guild)}</span>
							{/if}
							{#if guildMentionTotal > 0}
								<span class="sr-only"
									>{m.unread_mentions_indicator({ count: guildMentionTotal })}</span
								>
							{:else if guildUnread}
								<span class="sr-only">{m.unread_indicator()}</span>
							{/if}
						</button>
                                                {#if guildMentionTotal > 0}
                                                        <span aria-hidden="true" class={SERVER_MENTION_INDICATOR_CLASSES}
                                                                >{formatMentionCount(guildMentionTotal)}</span
                                                        >
                                                {/if}
                                        </div>
                                </div>
			{:else}
				{@const folderHasSelection = item.guilds.some((g) => isGuildSelected(g.guildId))}
				{@const folderHasUnread = item.guilds.some((g) => guildHasUnread(g.guildId))}
				{@const folderMentionTotal = folderMentionCount(item)}
				{@const showFolderIndicator = folderMentionTotal === 0}
				{@const folderIsDropTarget = folderDropTarget?.folderId === item.folder.id}
				{@const folderName = item.folder.name?.trim()}
				{@const folderLabel = folderName ? folderName : m.guild_folder()}
				{@const folderColorTokens = computeFolderColorTokens(item.folder.color)}
                                <div
                                        class="group/folder relative flex w-full flex-col items-center gap-2 rounded-2xl"
					style:--folder-collapsed-border={folderColorTokens?.collapsedBorder ?? 'var(--stroke)'}
					style:--folder-collapsed-bg={folderColorTokens?.collapsedBackground ??
						'var(--panel-strong)'}
					style:--folder-hover-bg={folderColorTokens?.hoverBackground ?? 'var(--panel)'}
					style:--folder-expanded-border={folderColorTokens?.expandedBorder ?? 'var(--stroke)'}
					style:--folder-expanded-bg={folderColorTokens?.expandedBackground ??
						'color-mix(in srgb, var(--panel-strong) 70%, transparent)'}
				>
                                        <div class="group/folder relative flex w-full justify-center overflow-visible">
                                                <div class="relative h-12 w-12 shrink-0 overflow-visible">
                                                        {#if showFolderIndicator}
                                                                <span
                                                                        aria-hidden="true"
                                                                        class={FOLDER_UNREAD_INDICATOR_POSITION_CLASSES}
                                                                        style={indicatorStyle(INDICATOR_OFFSET_ROOT)}
                                                                >
                                                                        <span
                                                                                class={`${FOLDER_UNREAD_INDICATOR_CLASSES} group-hover/folder:h-7 group-hover/folder:w-2 group-hover/folder:rounded-lg group-hover/folder:shadow-[0_0_0_2px_var(--panel-strong)] ${
                                                                                        folderHasUnread ? 'opacity-100' : 'opacity-0 group-hover/folder:opacity-100'
                                                                                }`}
                                                                        ></span>
                                                                </span>
                                                        {/if}
                                                        <button
                                                                class={`relative flex h-full w-full flex-col items-center justify-center gap-1 overflow-visible rounded-xl border border-[var(--folder-collapsed-border)] bg-[var(--folder-collapsed-bg)] p-1 transition-all duration-150 hover:-translate-y-0.5 hover:scale-105 hover:bg-[var(--folder-hover-bg)] hover:ring-2 hover:ring-[var(--brand)] hover:ring-inset focus-visible:outline-none ${
                                                                        folderIsDropTarget
                                                                                ? 'ring-2 ring-[var(--brand)]'
										: folderHasSelection
											? 'shadow ring-2 ring-[var(--brand)] ring-inset'
											: ''
								}`}
								type="button"
								draggable="true"
								data-tooltip-disabled
								use:tooltip={{
									content: () => folderLabel,
									placement: 'right'
								}}
								aria-label={folderLabel}
								use:customContextMenuTarget
								ondragstart={(event) => startFolderDrag(event, item.folder.id)}
								ondragend={endDrag}
								oncontextmenu={(event) => openFolderMenu(event, item)}
								ondragover={(event) =>
									onFolderDropZoneOver(event, item.folder.id, item.guilds.length)}
								ondrop={(event) => onFolderDrop(event, item.folder.id, item.guilds.length)}
								onclick={() =>
									(expandedFolders = {
										...expandedFolders,
										[item.folder.id]: !expandedFolders[item.folder.id]
									})}
								style:--folder-collapsed-border={folderHasUnread &&
								!folderIsDropTarget &&
								!folderHasSelection
									? 'var(--brand)'
									: null}
							>
								{#if expandedFolders[item.folder.id]}
									<Folder class="h-5 w-5" stroke-width={2} />
								{:else}
									<div class="grid h-full w-full grid-cols-2 grid-rows-2 gap-1">
										{#each item.guilds.slice(0, 4) as guildPreview, idx (guildPreview.guildId)}
											{@const previewUnread = guildHasUnread(guildPreview.guildId)}
											{@const previewIcon = guildIconUrl(guildPreview.guild)}
											<div
												class={`relative flex items-center justify-center overflow-hidden rounded-lg border border-[var(--stroke)] bg-[var(--panel)] text-xs font-semibold ${
													guildPreview.guildId === $selectedGuildId ? 'border-[var(--brand)]' : ''
												} ${previewUnread ? 'border-[var(--brand)] bg-[var(--brand)]/10' : ''}`}
											>
												{#if previewIcon}
													<img
														src={previewIcon}
														alt=""
														aria-hidden="true"
														class="h-full w-full object-cover"
														loading="lazy"
													/>
												{:else}
													{guildInitials(guildPreview.guild)}
												{/if}
											</div>
										{/each}
										{#if item.guilds.length < 4}
											{#each Array(4 - item.guilds.length) as _, fillerIdx (fillerIdx)}
												<div class="rounded-lg border border-dashed border-[var(--stroke)]"></div>
											{/each}
										{/if}
									</div>
								{/if}
								{#if folderMentionTotal > 0}
									<span class="sr-only"
										>{m.unread_mentions_indicator({ count: folderMentionTotal })}</span
									>
								{:else if folderHasUnread}
									<span class="sr-only">{m.unread_indicator()}</span>
								{/if}
							</button>
                                                        {#if folderMentionTotal > 0}
                                                                <span aria-hidden="true" class={FOLDER_MENTION_INDICATOR_CLASSES}
                                                                        >{formatMentionCount(folderMentionTotal)}</span
                                                                >
                                                        {/if}
                                                </div>
                                        </div>

					{#if expandedFolders[item.folder.id]}
						<div
							class="flex flex-col items-center gap-2 rounded-2xl border border-[var(--folder-expanded-border)] bg-[var(--folder-expanded-bg)] p-2"
						>
							<div
								class={`h-2 w-full rounded bg-[var(--brand)] transition-opacity ${
									folderDropTarget?.folderId === item.folder.id && folderDropTarget.index === 0
										? 'opacity-80'
										: 'opacity-0'
								}`}
								ondragover={(event) => onFolderDropZoneOver(event, item.folder.id, 0)}
								ondrop={(event) => onFolderDrop(event, item.folder.id, 0)}
								role="presentation"
							></div>
							{#each item.guilds as nestedGuild, nestedIndex (nestedGuild.guildId)}
								{@const nestedGuildUnread = guildHasUnread(nestedGuild.guildId)}
								{@const nestedGuildMention = guildMentionCount(nestedGuild.guildId)}
								{@const nestedGuildIcon = guildIconUrl(nestedGuild.guild)}
								{@const showNestedIndicator = nestedGuildMention === 0}
                                                                <div class="group/nested relative flex w-full justify-center overflow-visible">
                                                                        <div class="relative h-12 w-12 shrink-0 overflow-visible">
                                                                                {#if showNestedIndicator}
                                                                                        <span
                                                                                                aria-hidden="true"
                                                                                                class={UNREAD_INDICATOR_POSITION_CLASSES}
                                                                                                style={indicatorStyle(INDICATOR_OFFSET_NESTED)}
                                                                                        >
                                                                                                <span
                                                                                                        class={`${UNREAD_INDICATOR_CLASSES} group-hover/nested:h-7 group-hover/nested:w-2 group-hover/nested:rounded-lg group-hover/nested:shadow-[0_0_0_2px_var(--panel-strong)] ${
                                                                                                                nestedGuildUnread
                                                                                                                        ? 'opacity-100'
                                                                                                                        : 'opacity-0 group-hover/nested:opacity-100'
                                                                                                        }`}
                                                                                                ></span>
                                                                                        </span>
                                                                                {/if}
                                                                                <button
                                                                                        class={`relative flex h-full w-full transform items-center justify-center overflow-visible rounded-xl border border-[var(--stroke)] bg-[var(--panel-strong)] transition-all duration-150 hover:-translate-y-0.5 hover:scale-105 hover:bg-[var(--panel)] hover:ring-2 hover:ring-[var(--brand)] hover:ring-inset focus-visible:outline-none ${
                                                                                                isGuildSelected(nestedGuild.guildId)
                                                                                                        ? 'shadow ring-2 ring-[var(--brand)] ring-inset'
													: ''
											} ${
												folderDropTarget?.folderId === item.folder.id &&
												folderDropTarget.index === nestedIndex + 1
													? 'ring-2 ring-[var(--brand)]'
													: ''
											}`}
											data-tooltip-disabled
											use:tooltip={{
												content: () => nestedGuild.guild.name ?? 'Server',
												placement: 'right'
											}}
											aria-current={isGuildSelected(nestedGuild.guildId) ? 'true' : 'false'}
											aria-label={nestedGuild.guild.name ?? 'Server'}
											draggable="true"
											use:customContextMenuTarget
											ondragstart={(event) =>
												startGuildDrag(event, nestedGuild.guildId, nestedGuild.folderId)}
											ondragend={endDrag}
											ondragover={(event) =>
												onFolderDropZoneOver(event, item.folder.id, nestedIndex + 1)}
											ondrop={(event) => onFolderDrop(event, item.folder.id, nestedIndex + 1)}
											onclick={() => selectGuildFromSidebar(nestedGuild.guildId)}
											oncontextmenu={(event) =>
												openGuildMenu(event, nestedGuild.guild, nestedGuild.layout)}
										>
											{#if nestedGuildIcon}
												<img
													src={nestedGuildIcon}
													alt=""
													aria-hidden="true"
													class="h-full w-full object-cover"
													loading="lazy"
												/>
											{:else}
												<span class="font-bold">{guildInitials(nestedGuild.guild)}</span>
											{/if}
											{#if nestedGuildMention > 0}
												<span class="sr-only"
													>{m.unread_mentions_indicator({ count: nestedGuildMention })}</span
												>
											{:else if nestedGuildUnread}
												<span class="sr-only">{m.unread_indicator()}</span>
											{/if}
										</button>
                                                                                {#if nestedGuildMention > 0}
                                                                                        <span aria-hidden="true" class={SERVER_MENTION_INDICATOR_CLASSES}
                                                                                                >{formatMentionCount(nestedGuildMention)}</span
                                                                                        >
                                                                                {/if}
                                                                        </div>
                                                                </div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
                        <div
                                class={`h-2 w-full rounded bg-[var(--brand)] transition-opacity ${
                                        topDropIndex === displayIndex + 1 ? 'opacity-80' : 'opacity-0'
                                }`}
                                ondragover={(event) => onTopDragOver(event, displayIndex + 1)}
                                ondrop={(event) => onTopDrop(event, displayIndex + 1)}
                                role="presentation"
                        ></div>
                {/each}
                </div>
        </div>
	<div>
		<button
			class="grid h-12 w-12 place-items-center rounded-xl border border-[var(--stroke)] hover:bg-[var(--panel)]"
			onclick={() => (creating = !creating)}
			data-tooltip-disabled
			use:tooltip={{
				content: () => m.new_server(),
				placement: 'right'
			}}
			aria-label={m.new_server()}
		>
			<Plus class="h-[18px] w-[18px]" stroke-width={2} />
		</button>
	</div>

	{#if creating}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onclick={(event) => {
				if (event.target !== event.currentTarget) return;
				creating = false;
			}}
			onkeydown={(event) => {
				if (event.key === 'Escape') creating = false;
				if (event.key === 'Enter') createGuild();
			}}
		>
			<div class="pointer-events-none absolute inset-0 bg-black/40"></div>
			<div class="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
				<div class="relative">
					<div
						class="pointer-events-none absolute inset-0 z-0 rounded-lg bg-[var(--panel)]/30 backdrop-blur-sm"
					></div>
					<div
						class="panel relative z-10 w-64 p-3"
						role="document"
						tabindex="-1"
						onpointerdown={(event) => event.stopPropagation()}
					>
						<div class="mb-2 text-sm font-medium">{m.new_server()}</div>
						{#if error}<div class="mb-2 text-sm text-red-500">{error}</div>{/if}
						<input
							class="mb-2 w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
							placeholder={m.server_name()}
							bind:value={newGuildName}
						/>
						<div class="flex justify-end gap-2">
							<button
								class="rounded-md border border-[var(--stroke)] px-3 py-1"
								onclick={() => (creating = false)}
							>
								{m.cancel()}
							</button>
							<button
								class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)]"
								onclick={createGuild}
							>
								{m.create()}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if leavingGuild}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onclick={(event) => {
				if (event.target !== event.currentTarget) return;
				leavingGuild = null;
			}}
			onkeydown={(event) => {
				if (event.key === 'Escape') leavingGuild = null;
				if (event.key === 'Enter') confirmLeaveGuild();
			}}
		>
			<div class="pointer-events-none absolute inset-0 bg-black/40"></div>
			<div class="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
				<div class="relative">
					<div
						class="pointer-events-none absolute inset-0 z-0 rounded-lg bg-[var(--panel)]/30 backdrop-blur-sm"
					></div>
					<div
						class="panel relative z-10 w-72 p-4"
						role="document"
						tabindex="-1"
						onpointerdown={(event) => event.stopPropagation()}
					>
						<div class="mb-2 text-base font-semibold">
							{m.leave_server_confirm_title({ server: leavingGuild.name })}
						</div>
						<p class="mb-4 text-sm text-[var(--muted)]">
							{m.leave_server_confirm_description({ server: leavingGuild.name })}
						</p>
						<div class="flex justify-end gap-2">
							<button
								class="rounded-md border border-[var(--stroke)] px-3 py-1"
								onclick={() => (leavingGuild = null)}
							>
								{m.cancel()}
							</button>
							<button
								class="rounded-md bg-[var(--danger)] px-3 py-1 text-[var(--bg)]"
								onclick={confirmLeaveGuild}
							>
								{m.leave_server()}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style lang="postcss">
        .scroll-area {
                scrollbar-width: none;
                -ms-overflow-style: none;
        }

        .scroll-area::-webkit-scrollbar {
                display: none;
        }
</style>
