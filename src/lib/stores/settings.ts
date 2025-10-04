import { browser } from '$app/environment';
import {
        type DtoGuild,
        type ModelGuildChannelReadState,
        type ModelUserSettingsData,
        type ModelUserSettingsGuildFolders,
        type ModelUserSettingsGuilds,
        type ModelUserSettingsNotifications
} from '$lib/api';
import { setLocale } from '$lib/paraglide/runtime';
import { auth } from '$lib/stores/auth';
import { selectedGuildId } from '$lib/stores/appState';
import { derived, get, writable } from 'svelte/store';

export type Theme = 'light' | 'dark' | 'system';

const supportedLocales = ['en', 'ru', 'de', 'fr'] as const;
export type Locale = (typeof supportedLocales)[number];

function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && supportedLocales.includes(value as Locale);
}

const initialTheme: Theme = browser
	? (localStorage.getItem('theme') as Theme) || 'system'
	: 'system';

const storedLocale = browser ? localStorage.getItem('locale') : null;
const initialLocale: Locale = storedLocale && isLocale(storedLocale) ? storedLocale : 'en';

const initialSelectedGuildId = browser
	? (() => {
			try {
				return localStorage.getItem('lastGuild');
			} catch {
				return null;
			}
		})()
	: null;

function applyTheme(theme: Theme) {
	if (!browser) return;
	const mode =
		theme === 'system'
			? window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light'
			: theme;
	document.documentElement.setAttribute('data-theme', mode);
}

export const theme = writable<Theme>(initialTheme);

theme.subscribe((value) => {
	if (browser) {
		applyTheme(value);
		try {
			localStorage.setItem('theme', value);
		} catch {
			/* ignore */
		}
	}
});

setLocale(initialLocale);
export const locale = writable<Locale>(initialLocale);

locale.subscribe((value) => {
	setLocale(value);
	if (browser) {
		try {
			localStorage.setItem('locale', value);
		} catch {
			/* ignore */
		}
	}
});

export interface GuildChannelReadState {
        channelId: string;
        lastReadMessageId: string | null;
        scrollPosition: number | null;
}

export interface GuildLayoutGuild {
        guildId: string;
        notifications?: ModelUserSettingsNotifications;
        selectedChannelId?: string | null;
        readStates?: GuildChannelReadState[];
}

export interface GuildTopLevelItem extends GuildLayoutGuild {
	kind: 'guild';
}

export interface GuildFolderItem {
	kind: 'folder';
	id: string;
	name: string | null;
	color: number | null;
	guilds: GuildLayoutGuild[];
}

export type GuildLayoutItem = GuildTopLevelItem | GuildFolderItem;

export interface AppSettings {
	language: Locale;
	theme: Theme;
	chatFontScale: number;
	chatSpacing: number;
	guildLayout: GuildLayoutItem[];
	selectedGuildId: string | null;
}

const defaultSettings: AppSettings = {
	language: initialLocale,
	theme: initialTheme,
	chatFontScale: 1,
	chatSpacing: 1,
	guildLayout: [],
	selectedGuildId: initialSelectedGuildId
};

export const appSettings = writable<AppSettings>(defaultSettings);
export type GuildChannelReadStateLookup = Record<string, Record<string, GuildChannelReadState>>;

function collectReadStatesFromGuild(
        lookup: GuildChannelReadStateLookup,
        guild: GuildLayoutGuild | null | undefined
) {
        if (!guild?.guildId) return;
        const gid = guild.guildId;
        const readStates = Array.isArray(guild.readStates) ? guild.readStates : [];
        if (!readStates.length) return;
        const nextGuild: Record<string, GuildChannelReadState> = { ...(lookup[gid] ?? {}) };
        let changed = false;
        for (const state of readStates) {
                const channelId = toSnowflakeString((state as any)?.channelId ?? (state as any)?.channel_id);
                if (!channelId) continue;
                const entry: GuildChannelReadState = {
                        channelId,
                        lastReadMessageId: state.lastReadMessageId ?? null,
                        scrollPosition:
                                typeof state.scrollPosition === 'number' && Number.isFinite(state.scrollPosition)
                                        ? state.scrollPosition
                                        : null
                };
                nextGuild[channelId] = entry;
                changed = true;
        }
        if (changed) {
                lookup[gid] = nextGuild;
        }
}

export const guildChannelReadStateLookup = derived(appSettings, ($settings) => {
        const lookup: GuildChannelReadStateLookup = {};
        for (const item of $settings.guildLayout) {
                if (item.kind === 'guild') {
                        collectReadStatesFromGuild(lookup, item);
                } else {
                        for (const guild of item.guilds) {
                                collectReadStatesFromGuild(lookup, guild);
                        }
                }
        }
        return lookup;
});
export const settingsOpen = writable(false);
export const settingsReady = writable(false);
export const settingsSaving = writable(false);

let suppressThemePropagation = false;
let suppressLocalePropagation = false;
let suppressSave = false;

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let saveDirty = false;
let saveInFlight = false;

let latestGuilds: DtoGuild[] = [];
let guildsHydrated = false;
let hasSyncedGuildLayout = false;

function structuredCloneSafe<T>(value: T): T {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSettings(settings: AppSettings): AppSettings {
	return {
		language: settings.language,
		theme: settings.theme,
		chatFontScale: settings.chatFontScale,
		chatSpacing: settings.chatSpacing,
		selectedGuildId: settings.selectedGuildId,
		guildLayout: settings.guildLayout.map((item) => {
                        if (item.kind === 'guild') {
                                return {
                                        kind: 'guild',
                                        guildId: item.guildId,
                                        notifications: item.notifications
                                                ? structuredCloneSafe(item.notifications)
                                                : undefined,
                                        selectedChannelId: item.selectedChannelId ?? null,
                                        readStates: item.readStates
                                                ? structuredCloneSafe(item.readStates)
                                                : undefined
                                } satisfies GuildTopLevelItem;
                        }
                        return {
                                kind: 'folder',
                                id: item.id,
                                name: item.name,
                                color: item.color,
                                guilds: item.guilds.map((guild) => ({
                                        guildId: guild.guildId,
                                        notifications: guild.notifications ? structuredCloneSafe(guild.notifications) : undefined,
                                        selectedChannelId: guild.selectedChannelId ?? null,
                                        readStates: guild.readStates
                                                ? structuredCloneSafe(guild.readStates)
                                                : undefined
                                }))
                        } satisfies GuildFolderItem;
                })
        };
}

function toSnowflakeString(value: unknown): string | null {
	if (value == null) return null;
	try {
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'bigint') return BigInt(value).toString();
	} catch {
		/* ignore */
	}
	try {
		return String(value);
	} catch {
		return null;
	}
}

function toApiSnowflake(value: string): any {
	try {
		return BigInt(value) as any;
	} catch {
		return value as any;
	}
}

function normalizeFolderArray(
        input: ModelUserSettingsGuildFolders | ModelUserSettingsGuildFolders[] | undefined
): ModelUserSettingsGuildFolders[] {
        if (!input) return [];
        return Array.isArray(input) ? input : [input];
}

function normalizeReadStatesFromApi(
        states: ModelGuildChannelReadState[] | undefined
): GuildChannelReadState[] | undefined {
        if (!Array.isArray(states)) return undefined;
        const mapped = states
                .map((state) => {
                        const channelId = toSnowflakeString(state?.channel_id);
                        if (!channelId) return null;
                        const lastRead = toSnowflakeString(state?.last_read_message_id);
                        const scroll =
                                typeof state?.scroll_position === 'number' && Number.isFinite(state.scroll_position)
                                        ? state.scroll_position
                                        : null;
                        return {
                                channelId,
                                lastReadMessageId: lastRead,
                                scrollPosition: scroll
                        } satisfies GuildChannelReadState;
                })
                .filter((value): value is GuildChannelReadState => value !== null);
        return mapped.length ? mapped : undefined;
}

function convertReadStatesToApi(
        states: GuildChannelReadState[] | undefined
): ModelGuildChannelReadState[] | undefined {
        if (!Array.isArray(states) || states.length === 0) return undefined;
        return states.map((state) => ({
                channel_id: toApiSnowflake(state.channelId),
                last_read_message_id: state.lastReadMessageId
                        ? toApiSnowflake(state.lastReadMessageId)
                        : undefined,
                scroll_position:
                        typeof state.scrollPosition === 'number' && Number.isFinite(state.scrollPosition)
                                ? Math.round(state.scrollPosition)
                                : undefined
        }));
}

function convertFromApi(data?: ModelUserSettingsData | null): AppSettings {
	if (!data) return cloneSettings(defaultSettings);

	const appearance = data.appearance ?? {};
	const themeValue = (appearance.color_scheme as Theme | undefined) ?? defaultSettings.theme;
	const languageValue = isLocale(data.language)
		? (data.language as Locale)
		: defaultSettings.language;
	const chatFontScale =
		typeof appearance.chat_font_scale === 'number'
			? appearance.chat_font_scale
			: defaultSettings.chatFontScale;
	const chatSpacing =
		typeof appearance.chat_spacing === 'number'
			? appearance.chat_spacing
			: defaultSettings.chatSpacing;

	const folderEntries = normalizeFolderArray(data.guild_folders).map((folder, idx) => {
		const id = generateFolderId();
		const guildIds = Array.isArray(folder.guilds)
			? folder.guilds
					.map((gid) => toSnowflakeString(gid))
					.filter((gid): gid is string => Boolean(gid))
			: [];
		return {
			folder: {
				kind: 'folder' as const,
				id,
				name: folder.name ?? null,
				color: typeof folder.color === 'number' ? folder.color : null,
				guilds: [] as GuildLayoutGuild[]
			},
			guildIds,
			position: typeof folder.position === 'number' ? folder.position : idx
		};
	});

	const folderByGuild = new Map<string, (typeof folderEntries)[number]>();
	for (const entry of folderEntries) {
		for (const gid of entry.guildIds) {
			folderByGuild.set(gid, entry);
		}
	}

	const layoutWithPositions: Array<{ item: GuildLayoutItem; position: number }> = [];
	const guildsArray = Array.isArray(data.guilds) ? data.guilds : [];

        for (const guildSetting of guildsArray) {
                const guildId = toSnowflakeString(guildSetting.guild_id);
                if (!guildId) continue;
                const selectedChannelId = toSnowflakeString(guildSetting.selected_channel);
                const readStates = normalizeReadStatesFromApi(guildSetting.read_states);
                const baseGuild: GuildLayoutGuild = {
                        guildId,
                        notifications: guildSetting.notifications
                                ? structuredCloneSafe(guildSetting.notifications)
                                : undefined,
                        selectedChannelId: selectedChannelId ?? null,
                        readStates: readStates ? structuredCloneSafe(readStates) : undefined
                };

                const folderEntry = folderByGuild.get(guildId);
                if (folderEntry) {
			const position = typeof guildSetting.position === 'number' ? guildSetting.position : 0;
			(baseGuild as any).__position = position;
			folderEntry.folder.guilds.push(baseGuild);
		} else {
			const position =
				typeof guildSetting.position === 'number'
					? guildSetting.position
					: layoutWithPositions.length;
			layoutWithPositions.push({ item: { kind: 'guild', ...baseGuild }, position });
		}
	}

	for (const entry of folderEntries) {
		if (entry.guildIds.length > 0 && entry.folder.guilds.length === 0) {
			for (const gid of entry.guildIds) {
				entry.folder.guilds.push({ guildId: gid } as GuildLayoutGuild);
			}
		}
		entry.folder.guilds.sort(
			(
				a: GuildLayoutGuild & { __position?: number },
				b: GuildLayoutGuild & { __position?: number }
			) => {
				const pa = typeof a.__position === 'number' ? a.__position : 0;
				const pb = typeof b.__position === 'number' ? b.__position : 0;
				return pa - pb;
			}
		);
		entry.folder.guilds.forEach((guild) => {
			if ('__position' in guild) delete (guild as any).__position;
		});
		layoutWithPositions.push({ item: entry.folder, position: entry.position });
	}

	layoutWithPositions.sort((a, b) => a.position - b.position);

	return {
		language: languageValue,
		theme: themeValue,
		chatFontScale,
		chatSpacing,
		guildLayout: layoutWithPositions.map((entry) => entry.item),
		selectedGuildId: toSnowflakeString(data.selected_guild)
	};
}

function convertToApi(settings: AppSettings): ModelUserSettingsData {
	const payloadGuilds: ModelUserSettingsGuilds[] = [];
	const payloadFolders: ModelUserSettingsGuildFolders[] = [];

	let topPosition = 0;
	for (const item of settings.guildLayout) {
                if (item.kind === 'guild') {
                        const readStates = convertReadStatesToApi(item.readStates);
                        payloadGuilds.push({
                                guild_id: toApiSnowflake(item.guildId),
                                position: topPosition,
                                notifications: item.notifications
                                        ? structuredCloneSafe(item.notifications)
                                        : undefined,
                                read_states: readStates,
                                selected_channel: item.selectedChannelId
                                        ? toApiSnowflake(item.selectedChannelId)
                                        : undefined
                        });
                        topPosition++;
                } else {
                        payloadFolders.push({
                                name: item.name ?? undefined,
				color: item.color ?? undefined,
				guilds: item.guilds.map((guild) => toApiSnowflake(guild.guildId)),
				position: topPosition
			});
                        let inner = 0;
                        for (const guild of item.guilds) {
                                const nestedReadStates = convertReadStatesToApi(guild.readStates);
                                payloadGuilds.push({
                                        guild_id: toApiSnowflake(guild.guildId),
                                        position: inner,
                                        notifications: guild.notifications
                                                ? structuredCloneSafe(guild.notifications)
                                                : undefined,
                                        read_states: nestedReadStates,
                                        selected_channel: guild.selectedChannelId
                                                ? toApiSnowflake(guild.selectedChannelId)
                                                : undefined
                                });
                                inner++;
                        }
			topPosition++;
		}
	}

	return {
		language: settings.language,
		appearance: {
			color_scheme: settings.theme,
			chat_font_scale: settings.chatFontScale,
			chat_spacing: settings.chatSpacing
		},
		guilds: payloadGuilds,
		guild_folders: payloadFolders as unknown as ModelUserSettingsGuildFolders,
		selected_guild: settings.selectedGuildId ? toApiSnowflake(settings.selectedGuildId) : undefined
	};
}

function persistSelectedGuildFallback(value: string | null) {
	if (!browser) return;
	try {
		if (value) {
			localStorage.setItem('lastGuild', value);
		} else {
			localStorage.removeItem('lastGuild');
		}
	} catch {
		/* ignore */
	}
}

function applySelectedGuildFromSettings(clearInvalid: boolean) {
	const stored = get(appSettings).selectedGuildId;
	if (!stored) {
		selectedGuildId.set(null);
		persistSelectedGuildFallback(null);
		return;
	}

	const exists = latestGuilds.some((guild) => toSnowflakeString((guild as any)?.id) === stored);
	if (exists) {
		selectedGuildId.set(stored);
		persistSelectedGuildFallback(stored);
	} else if (clearInvalid) {
		if (!guildsHydrated) return;
		selectedGuildId.set(null);
		persistSelectedGuildFallback(null);
		mutateAppSettings((settings) => {
			if (settings.selectedGuildId === null) return false;
			settings.selectedGuildId = null;
			return true;
		});
	}
}

function scheduleSave() {
	if (suppressSave) return;
	if (!get(settingsReady)) return;
	if (!get(auth.isAuthenticated)) return;
	saveDirty = true;
	if (saveTimeout) clearTimeout(saveTimeout);
	saveTimeout = setTimeout(() => {
		saveTimeout = null;
		void persistSettings();
	}, 400);
}

async function persistSettings() {
	if (!saveDirty) return;
	if (!get(auth.isAuthenticated)) {
		saveDirty = false;
		return;
	}
	if (saveInFlight) return;
	saveInFlight = true;
	saveDirty = false;
	settingsSaving.set(true);
	try {
		const payload = convertToApi(get(appSettings));
		await auth.api.user.userMeSettingsPost({
			modelUserSettingsData: payload
		});
	} catch (error) {
		console.error('Failed to save settings', error);
		saveDirty = true;
	} finally {
		saveInFlight = false;
		settingsSaving.set(false);
		if (saveDirty && !saveTimeout) {
			saveTimeout = setTimeout(() => {
				saveTimeout = null;
				void persistSettings();
			}, 400);
		}
	}
}

type SettingsMutator = (settings: AppSettings) => boolean;

export function mutateAppSettings(mutator: SettingsMutator) {
        appSettings.update((current) => {
                const cloned = cloneSettings(current);
                const changed = mutator(cloned);
                if (!changed) return current;
                scheduleSave();
                return cloned;
        });
}

function findGuildLayoutGuild(layout: GuildLayoutItem[], guildId: string): GuildLayoutGuild | null {
        for (const item of layout) {
                if (item.kind === 'guild') {
                        if (item.guildId === guildId) return item;
                        continue;
                }
                for (const guild of item.guilds) {
                        if (guild.guildId === guildId) return guild;
                }
        }
        return null;
}

export function updateGuildSelectedChannel(guildId: string, channelId: string | null) {
        mutateAppSettings((settings) => {
                const entry = findGuildLayoutGuild(settings.guildLayout, guildId);
                if (!entry) return false;
                const nextValue = channelId ?? null;
                if ((entry.selectedChannelId ?? null) === nextValue) return false;
                entry.selectedChannelId = nextValue;
                return true;
        });
}

function generateFolderId(): string {
	return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function detachGuild(
	layout: GuildLayoutItem[],
	guildId: string
): { guild: GuildLayoutGuild | null; removedIndex: number | null } {
	for (let i = 0; i < layout.length; i++) {
		const item = layout[i];
		if (item.kind === 'guild') {
			if (item.guildId === guildId) {
				layout.splice(i, 1);
                                return {
                                        guild: {
                                                guildId: item.guildId,
                                                notifications: item.notifications,
                                                selectedChannelId: item.selectedChannelId,
                                                readStates: item.readStates
                                        },
                                        removedIndex: i
                                };
                        }
			continue;
		}
		const idx = item.guilds.findIndex((guild) => guild.guildId === guildId);
		if (idx === -1) continue;
                const [removed] = item.guilds.splice(idx, 1);
		if (item.guilds.length === 0) {
			layout.splice(i, 1);
			return { guild: removed, removedIndex: i };
		}
		if (item.guilds.length === 1) {
			const [remaining] = item.guilds;
			layout.splice(i, 1, { kind: 'guild', ...remaining });
			return { guild: removed, removedIndex: null };
		}
		return { guild: removed, removedIndex: null };
	}
	return { guild: null, removedIndex: null };
}

export function moveGuildToTop(guildId: string, targetIndex: number) {
	mutateAppSettings((settings) => {
		const layout = settings.guildLayout;
		const { guild, removedIndex } = detachGuild(layout, guildId);
		if (!guild) return false;
		let index = targetIndex;
		if (removedIndex != null && removedIndex < index) {
			index -= 1;
		}
		index = clamp(index, 0, layout.length);
		layout.splice(index, 0, { kind: 'guild', ...guild });
		return true;
	});
}

export function moveFolder(folderId: string, targetIndex: number) {
	mutateAppSettings((settings) => {
		const layout = settings.guildLayout;
		const currentIndex = layout.findIndex((item) => item.kind === 'folder' && item.id === folderId);
		if (currentIndex === -1) return false;
		const [folder] = layout.splice(currentIndex, 1) as [GuildFolderItem];
		let index = targetIndex;
		if (currentIndex < index) index -= 1;
		index = clamp(index, 0, layout.length);
		layout.splice(index, 0, folder);
		return true;
	});
}

export function moveGuildToFolder(guildId: string, folderId: string, targetIndex?: number) {
	mutateAppSettings((settings) => {
		const layout = settings.guildLayout;
		const folderIndex = layout.findIndex((item) => item.kind === 'folder' && item.id === folderId);
		if (folderIndex === -1) return false;
		const folder = layout[folderIndex] as GuildFolderItem;
		const existingIndex = folder.guilds.findIndex((guild) => guild.guildId === guildId);
		let guild: GuildLayoutGuild | null = null;
		if (existingIndex !== -1) {
			const [removed] = folder.guilds.splice(existingIndex, 1);
			guild = removed;
			if (existingIndex < (targetIndex ?? folder.guilds.length)) {
				targetIndex = (targetIndex ?? folder.guilds.length) - 1;
			}
		} else {
			const result = detachGuild(layout, guildId);
			guild = result.guild;
			if (!guild) return false;
			const updatedIndex = layout.findIndex(
				(item) => item.kind === 'folder' && item.id === folderId
			);
			if (updatedIndex === -1) return false;
			const targetFolder = layout[updatedIndex] as GuildFolderItem;
			const index = clamp(targetIndex ?? targetFolder.guilds.length, 0, targetFolder.guilds.length);
			targetFolder.guilds.splice(index, 0, guild);
			return true;
		}
		const index = clamp(targetIndex ?? folder.guilds.length, 0, folder.guilds.length);
		folder.guilds.splice(index, 0, guild);
		return true;
	});
}

export function createFolderWithGuilds(
	anchorGuildId: string,
	otherGuildId: string,
	insertIndex?: number
): string | null {
	let createdId: string | null = null;
	mutateAppSettings((settings) => {
		const layout = settings.guildLayout;
		const { guild: anchorGuild, removedIndex: anchorIndex } = detachGuild(layout, anchorGuildId);
		const { guild: otherGuild, removedIndex: otherIndex } = detachGuild(layout, otherGuildId);
		if (!anchorGuild || !otherGuild) return false;
		let index = insertIndex ?? anchorIndex ?? layout.length;
		if (otherIndex != null && otherIndex < index) index -= 1;
		index = clamp(index, 0, layout.length);
		const folder: GuildFolderItem = {
			kind: 'folder',
			id: generateFolderId(),
			name: null,
			color: null,
			guilds: [anchorGuild, otherGuild]
		};
		layout.splice(index, 0, folder);
		createdId = folder.id;
		return true;
	});
	return createdId;
}

function syncLayoutWithGuilds() {
	const guildList = latestGuilds ?? [];

	if (guildList.length > 0) {
		hasSyncedGuildLayout = true;
	} else if (!hasSyncedGuildLayout) {
		return;
	}

	mutateAppSettings((settings) => {
		if (guildList.length === 0) {
			if (settings.guildLayout.length === 0) return false;
			settings.guildLayout = [];
			return true;
		}

		const available = new Set(
			guildList
				.map((guild) => toSnowflakeString((guild as any)?.id))
				.filter((id): id is string => Boolean(id))
		);
		const seen = new Set<string>();
		const newLayout: GuildLayoutItem[] = [];
		let changed = false;

		for (const item of settings.guildLayout) {
			if (item.kind === 'guild') {
				if (available.has(item.guildId)) {
					newLayout.push(item);
					seen.add(item.guildId);
				} else {
					changed = true;
				}
				continue;
			}
			const keptGuilds = item.guilds.filter((guild) => {
				if (available.has(guild.guildId)) {
					seen.add(guild.guildId);
					return true;
				}
				changed = true;
				return false;
			});
			if (keptGuilds.length >= 2) {
				if (keptGuilds.length !== item.guilds.length) changed = true;
				newLayout.push({ ...item, guilds: keptGuilds });
			} else if (keptGuilds.length === 1) {
				changed = true;
				newLayout.push({ kind: 'guild', ...keptGuilds[0] });
			} else {
				changed = true;
			}
		}

		for (const id of available) {
			if (!seen.has(id)) {
				newLayout.push({ kind: 'guild', guildId: id });
				changed = true;
			}
		}

		if (!changed) return false;
		settings.guildLayout = newLayout;
		return true;
	});
}

async function loadSettingsFromApi() {
	hasSyncedGuildLayout = false;
	if (!get(auth.isAuthenticated)) {
		suppressSave = true;
		appSettings.set({ ...defaultSettings, language: get(locale), theme: get(theme) });
		suppressSave = false;
		settingsReady.set(false);
		return;
	}
	try {
		const response = await auth.api.user.userMeSettingsGet();
		if (response.status === 204 || !response.data?.settings) {
			suppressSave = true;
			appSettings.set({ ...defaultSettings, language: get(locale), theme: get(theme) });
			applySelectedGuildFromSettings(false);
			suppressSave = false;
		} else {
			const parsed = convertFromApi(response.data.settings);
			suppressSave = true;
			suppressThemePropagation = true;
			suppressLocalePropagation = true;
			appSettings.set(parsed);
			applySelectedGuildFromSettings(false);
			theme.set(parsed.theme);
			locale.set(parsed.language);
			suppressThemePropagation = false;
			suppressLocalePropagation = false;
			suppressSave = false;
		}
	} catch (error) {
		console.error('Failed to load settings', error);
		suppressSave = true;
		appSettings.set({ ...defaultSettings, language: get(locale), theme: get(theme) });
		applySelectedGuildFromSettings(false);
		suppressSave = false;
	}
	settingsReady.set(true);
	applySelectedGuildFromSettings(true);
	syncLayoutWithGuilds();
}

auth.token.subscribe((token) => {
	if (token) {
		void loadSettingsFromApi();
	} else {
		hasSyncedGuildLayout = false;
		guildsHydrated = false;
		suppressSave = true;
		appSettings.set({ ...defaultSettings, language: get(locale), theme: get(theme) });
		suppressSave = false;
		settingsReady.set(false);
	}
});

auth.guilds.subscribe((guilds) => {
	latestGuilds = Array.isArray(guilds) ? guilds : [];
	if (get(settingsReady)) {
		guildsHydrated = true;
	}
	applySelectedGuildFromSettings(get(settingsReady));
	if (get(settingsReady)) {
		syncLayoutWithGuilds();
	}
});

theme.subscribe((value) => {
	if (suppressThemePropagation) return;
	mutateAppSettings((settings) => {
		if (settings.theme === value) return false;
		settings.theme = value;
		return true;
	});
});

locale.subscribe((value) => {
	if (suppressLocalePropagation) return;
	mutateAppSettings((settings) => {
		if (settings.language === value) return false;
		settings.language = value;
		return true;
	});
});

export const hasFolders = derived(appSettings, ($settings) =>
	$settings.guildLayout.some((item) => item.kind === 'folder')
);

export { settingsOpen as userSettingsOpen };
