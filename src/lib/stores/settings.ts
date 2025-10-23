import { browser } from '$app/environment';
import {
	type DtoGuild,
	type ModelStatus,
	type ModelUserDMChannels,
	type ModelUserSettingsData,
	type ModelUserSettingsGuildFolders,
	type ModelUserSettingsGuilds,
	type ModelUserSettingsNotifications
} from '$lib/api';
import { setLocale } from '$lib/paraglide/runtime';
import { auth } from '$lib/stores/auth';
import { updateUnreadSnapshot } from '$lib/stores/unreadSeed';
import { derived, get, writable } from 'svelte/store';
import { parseColorValue } from '$lib/utils/color';
import type { PresenceMode, PresenceStatus } from '$lib/types/presence';

type AnyRecord = Record<string, unknown>;

export type Theme = 'light' | 'dark' | 'system';

export const supportedLocales = ['en', 'ru', 'de', 'fr'] as const;
export type Locale = (typeof supportedLocales)[number];

export interface DeviceSettings {
        audioInputDevice: string | null;
        audioInputLevel: number;
        audioInputThreshold: number;
        audioOutputDevice: string | null;
        audioOutputLevel: number;
        autoGainControl: boolean;
        echoCancellation: boolean;
        noiseSuppression: boolean;
        videoDevice: string | null;
}

const DEFAULT_AUDIO_INPUT_LEVEL = 1;
const DEFAULT_AUDIO_INPUT_THRESHOLD = 0.1;
const DEFAULT_AUDIO_OUTPUT_LEVEL = 1;

function createDefaultDeviceSettings(): DeviceSettings {
        return {
                audioInputDevice: null,
                audioInputLevel: DEFAULT_AUDIO_INPUT_LEVEL,
                audioInputThreshold: DEFAULT_AUDIO_INPUT_THRESHOLD,
                audioOutputDevice: null,
                audioOutputLevel: DEFAULT_AUDIO_OUTPUT_LEVEL,
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: true,
                videoDevice: null
        } satisfies DeviceSettings;
}

const defaultDeviceSettings: DeviceSettings = createDefaultDeviceSettings();

export function cloneDeviceSettings(settings: DeviceSettings | null | undefined): DeviceSettings {
	const source = settings ?? defaultDeviceSettings;
	return {
		audioInputDevice: source.audioInputDevice ?? null,
		audioInputLevel:
			typeof source.audioInputLevel === 'number' && Number.isFinite(source.audioInputLevel)
				? clamp(source.audioInputLevel, 0, 1)
				: DEFAULT_AUDIO_INPUT_LEVEL,
		audioInputThreshold:
			typeof source.audioInputThreshold === 'number' && Number.isFinite(source.audioInputThreshold)
				? clamp(source.audioInputThreshold, 0, 1)
				: DEFAULT_AUDIO_INPUT_THRESHOLD,
		audioOutputDevice: source.audioOutputDevice ?? null,
		audioOutputLevel:
			typeof source.audioOutputLevel === 'number' && Number.isFinite(source.audioOutputLevel)
				? clamp(source.audioOutputLevel, 0, 1.5)
				: DEFAULT_AUDIO_OUTPUT_LEVEL,
		autoGainControl: source.autoGainControl !== false,
		echoCancellation: source.echoCancellation !== false,
		noiseSuppression: source.noiseSuppression !== false,
		videoDevice: source.videoDevice ?? null
	} satisfies DeviceSettings;
}

function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && supportedLocales.includes(value as Locale);
}

function normalizePresenceStatusValue(value: unknown): PresenceStatus {
	if (typeof value !== 'string') return 'online';
	switch (value.toLowerCase()) {
		case 'idle':
			return 'idle';
		case 'dnd':
		case 'do_not_disturb':
			return 'dnd';
		case 'offline':
		case 'invisible':
			return 'offline';
		case 'online':
		default:
			return 'online';
	}
}

function normalizePresenceModeValue(value: unknown): PresenceMode {
	if (typeof value !== 'string') return 'auto';
	switch (value.toLowerCase()) {
		case 'idle':
			return 'idle';
		case 'dnd':
		case 'do_not_disturb':
			return 'dnd';
		case 'offline':
		case 'invisible':
			return 'offline';
		case 'auto':
			return 'auto';
		case 'online':
		default:
			return 'auto';
	}
}

function normalizeCustomStatusTextValue(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.slice(0, 256);
}

function normalizeDeviceIdValue(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed;
}

function toCamelCase(snake: string): string {
	return snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function resolveNumberField(
	payload: AnyRecord,
	snakeKey: string,
	fallback: number,
	options?: { min?: number; max?: number }
): number {
	const camelKey = toCamelCase(snakeKey);
	const candidate = payload?.[snakeKey] ?? payload?.[camelKey];
	let numeric: number | null = null;
	if (typeof candidate === 'number') {
		numeric = Number.isFinite(candidate) ? candidate : null;
	} else if (typeof candidate === 'string') {
		const parsed = Number(candidate);
		numeric = Number.isFinite(parsed) ? parsed : null;
	}
	const value = numeric ?? fallback;
	const min = options?.min;
	const max = options?.max;
	if (typeof min === 'number' || typeof max === 'number') {
		return clamp(value, min ?? Number.NEGATIVE_INFINITY, max ?? Number.POSITIVE_INFINITY);
	}
	return value;
}

function resolveBooleanField(payload: AnyRecord, snakeKey: string, fallback: boolean): boolean {
	const camelKey = toCamelCase(snakeKey);
	const candidate = payload?.[snakeKey] ?? payload?.[camelKey];
	if (typeof candidate === 'boolean') {
		return candidate;
	}
	return fallback;
}

const initialTheme: Theme = browser
	? (localStorage.getItem('theme') as Theme) || 'system'
	: 'system';

const storedLocale = browser ? localStorage.getItem('locale') : null;

function resolveLocale(candidate: string | null | undefined): Locale | null {
	if (!candidate) return null;
	const normalized = candidate.toLowerCase().split('-')[0];
	return isLocale(normalized) ? normalized : null;
}

function detectBrowserLocale(): Locale {
	if (!browser) return 'en';
	const candidates = Array.isArray(navigator.languages)
		? navigator.languages
		: navigator.language
			? [navigator.language]
			: [];
	for (const candidate of candidates) {
		const match = resolveLocale(candidate);
		if (match) return match;
	}
	return 'en';
}

const initialLocale: Locale =
	storedLocale && isLocale(storedLocale) ? storedLocale : detectBrowserLocale();

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

function createDefaultSettingsSnapshot(): AppSettings {
        const snapshot = cloneSettings(defaultSettings);
        snapshot.language = get(locale);
        snapshot.theme = get(theme);
        snapshot.devices = createDefaultDeviceSettings();
        return snapshot;
}

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

export interface VisibleDmChannel {
	channelId: string;
	userId: string | null;
	isDead: boolean;
	lastReadMessageId: string | null;
	hidden: boolean;
	hiddenAfterMessageId: string | null;
}

export interface DmChannelMetadata extends VisibleDmChannel {}

export type DmChannelMetadataLookup = Record<string, DmChannelMetadata>;

export interface AppSettings {
	language: Locale;
	theme: Theme;
	chatFontScale: number;
	chatSpacing: number;
	guildLayout: GuildLayoutItem[];
	selectedGuildId: string | null;
	presenceMode: PresenceMode;
	status: {
		status: PresenceStatus;
		customStatusText: string | null;
	};
	dmChannels: VisibleDmChannel[];
	devices: DeviceSettings;
}

function createDefaultAppSettings(): AppSettings {
        return {
                language: initialLocale,
                theme: initialTheme,
                chatFontScale: 1,
                chatSpacing: 1,
                guildLayout: [],
                selectedGuildId: null,
                presenceMode: 'auto',
                status: {
                        status: 'online',
                        customStatusText: null
                },
                dmChannels: [],
                devices: cloneDeviceSettings(defaultDeviceSettings)
        } satisfies AppSettings;
}

const defaultSettings: AppSettings = createDefaultAppSettings();

export const appSettings = writable<AppSettings>(cloneSettings(defaultSettings));
export type GuildChannelReadStateLookup = Record<string, Record<string, GuildChannelReadState>>;
export type ChannelGuildLookup = Record<string, string>;

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
	if ($settings.dmChannels.length) {
		const existingDm = { ...(lookup['@me'] ?? {}) };
		let hasDmEntries = Object.keys(existingDm).length > 0;
		for (const entry of $settings.dmChannels) {
			const channelId = entry.channelId;
			if (!channelId) continue;
			const lastRead = entry.lastReadMessageId ?? null;
			const current = existingDm[channelId];
			if (current && current.lastReadMessageId === lastRead) {
				continue;
			}
			existingDm[channelId] = {
				channelId,
				lastReadMessageId: lastRead,
				scrollPosition: current?.scrollPosition ?? null
			} satisfies GuildChannelReadState;
			hasDmEntries = true;
		}
		if (hasDmEntries) {
			lookup['@me'] = existingDm;
		}
	}
	return lookup;
});

export const dmChannelMetadataLookup = derived(appSettings, ($settings) => {
	const lookup: DmChannelMetadataLookup = {};
	for (const entry of $settings.dmChannels) {
		const channelId = entry.channelId;
		if (!channelId) continue;
		lookup[channelId] = {
			channelId,
			userId: entry.userId ?? null,
			isDead: entry.isDead ?? false,
			lastReadMessageId: entry.lastReadMessageId ?? null,
			hidden: entry.hidden ?? false,
			hiddenAfterMessageId: entry.hiddenAfterMessageId ?? null
		} satisfies DmChannelMetadata;
	}
	return lookup;
});
export const settingsOpen = writable(false);
export const folderSettingsOpen = writable(false);
export const folderSettingsRequest = writable<{
	folderId: string;
	requestId: number;
} | null>(null);
export const settingsReady = writable(false);
export const settingsSaving = writable(false);

let suppressThemePropagation = false;
let suppressLocalePropagation = false;
let suppressSave = false;
let saveDirty = false;
let saveInFlight = false;

let latestGuilds: DtoGuild[] = [];
let guildsHydrated = false;
let hasSyncedGuildLayout = false;
let loadedSettingsToken: string | null = null;
let settingsLoadInFlight = false;
let settingsLoadToken: string | null = null;
let settingsLoadedOnce = false;
let queuedSettingsToken: string | null = null;

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
		presenceMode: settings.presenceMode,
		status: {
			status: settings.status.status,
			customStatusText: settings.status.customStatusText ?? null
		},
		dmChannels: settings.dmChannels.map((entry) => ({
			channelId: entry.channelId,
			userId: entry.userId,
			isDead: entry.isDead ?? false,
			lastReadMessageId: entry.lastReadMessageId ?? null,
			hidden: entry.hidden ?? false,
			hiddenAfterMessageId: entry.hiddenAfterMessageId ?? null
		})),
		devices: cloneDeviceSettings(settings.devices),
		guildLayout: settings.guildLayout.map((item) => {
			if (item.kind === 'guild') {
				return {
					kind: 'guild',
					guildId: item.guildId,
					notifications: item.notifications ? structuredCloneSafe(item.notifications) : undefined,
					selectedChannelId: item.selectedChannelId ?? null,
					readStates: item.readStates ? structuredCloneSafe(item.readStates) : undefined
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
					readStates: guild.readStates ? structuredCloneSafe(guild.readStates) : undefined
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

function extractLastReadMessageId(candidate: unknown, visited = new Set<any>()): string | null {
	if (candidate == null) return null;
	if (typeof candidate !== 'object') {
		return toSnowflakeString(candidate);
	}
	if (visited.has(candidate)) {
		return null;
	}
	visited.add(candidate);
	const record = candidate as AnyRecord;
	const directKeys = [
		'last_read_message_id',
		'lastReadMessageId',
		'last_read_message',
		'lastReadMessage',
		'last_read',
		'lastRead',
		'read_state_last_message_id',
		'readStateLastMessageId',
		'read_state_lastMessageId',
		'readStateLastMessageId'
	];
	for (const key of directKeys) {
		if (!(key in record)) continue;
		const normalized = toSnowflakeString((record as AnyRecord)[key]);
		if (normalized) return normalized;
	}
	const nestedKeys = ['read_state', 'readState', 'state', 'meta'];
	for (const key of nestedKeys) {
		if (!(key in record)) continue;
		const nested = extractLastReadMessageId((record as AnyRecord)[key], visited);
		if (nested) return nested;
	}
	return null;
}

function parseDmReadStateChannelId(key: string | null | undefined): string | null {
	if (typeof key !== 'string') return null;
	const trimmed = key.trim();
	if (!trimmed) return null;
	const direct = toSnowflakeString(trimmed);
	if (direct && /^\d+$/.test(trimmed)) {
		return direct;
	}
	const digits = trimmed.match(/\d+/g);
	if (!digits || !digits.length) return null;
	if (digits.length === 1) {
		return toSnowflakeString(digits[0]);
	}
	const lower = trimmed.toLowerCase();
	if (lower.includes('@me') || lower.startsWith('dm')) {
		return toSnowflakeString(digits[digits.length - 1]);
	}
	return null;
}

function normalizeFolderArray(
	input: ModelUserSettingsGuildFolders | ModelUserSettingsGuildFolders[] | undefined
): ModelUserSettingsGuildFolders[] {
	if (!input) return [];
	return Array.isArray(input) ? input : [input];
}

function detectDmChannelDeadState(entry: AnyRecord | null | undefined): boolean {
	if (!entry || typeof entry !== 'object') return false;

	const booleanCandidates = [entry.dead, entry.is_dead, entry.isDead, entry.closed, entry.archived];
	if (booleanCandidates.some((value) => value === true)) {
		return true;
	}

	const stringCandidates = [
		entry.state,
		entry.status,
		entry.channel_state,
		entry.channelState,
		entry.dm_state,
		entry.dmState,
		entry.visibility
	];

	for (const candidate of stringCandidates) {
		if (typeof candidate !== 'string') continue;
		const normalized = candidate.trim().toLowerCase();
		if (!normalized) continue;
		if (normalized === 'dead' || normalized.endsWith(':dead') || normalized.includes('dead')) {
			return true;
		}
	}

	return false;
}

function buildReadStateLookupFromLayout(layout: GuildLayoutItem[]): GuildChannelReadStateLookup {
	const lookup: GuildChannelReadStateLookup = {};
	for (const item of layout) {
		if (item.kind === 'guild') {
			collectReadStatesFromGuild(lookup, item);
		} else {
			for (const guild of item.guilds) {
				collectReadStatesFromGuild(lookup, guild);
			}
		}
	}
	return lookup;
}

function buildChannelGuildLookupFromSnapshot(snapshot: unknown): ChannelGuildLookup {
	const lookup: ChannelGuildLookup = {};
	if (snapshot == null) {
		return lookup;
	}

	const recordChannel = (guildId: string | null, channelValue: unknown) => {
		if (!guildId) return;
		const channelId = toSnowflakeString(channelValue);
		if (!channelId || !/^\d+$/.test(channelId)) return;
		lookup[channelId] = guildId;
	};

	const processChannelContainer = (guildId: string | null, container: unknown) => {
		if (!guildId || container == null) return;

		if (container instanceof Map) {
			for (const key of container.keys()) {
				recordChannel(guildId, key);
			}
			return;
		}

		if (Array.isArray(container)) {
			for (const entry of container) {
				if (Array.isArray(entry) && entry.length) {
					recordChannel(guildId, entry[0]);
					continue;
				}
				if (entry && typeof entry === 'object') {
					const obj = entry as Record<string, unknown>;
					recordChannel(
						guildId,
						obj['channel_id'] ??
							obj['channelId'] ??
							(obj['channel'] as any)?.id ??
							obj['channel'] ??
							obj['id']
					);
				}
			}
			return;
		}

		if (typeof container === 'object') {
			for (const [channelKey] of Object.entries(container as Record<string, unknown>)) {
				recordChannel(guildId, channelKey);
			}
		}
	};

	if (snapshot instanceof Map) {
		for (const [guildKey, channels] of snapshot.entries()) {
			const guildId = toSnowflakeString(guildKey);
			if (!guildId || !/^\d+$/.test(guildId)) continue;
			processChannelContainer(guildId, channels);
		}
		return lookup;
	}

	if (typeof snapshot === 'object') {
		for (const [guildKey, channels] of Object.entries(snapshot as Record<string, unknown>)) {
			const guildId = toSnowflakeString(guildKey);
			if (!guildId || !/^\d+$/.test(guildId)) continue;
			processChannelContainer(guildId, channels);
		}
	}

	return lookup;
}

function parseReadStateKey(
	key: string | null | undefined
): { guildId: string; channelId: string } | null {
	if (typeof key !== 'string') return null;
	const trimmed = key.trim();
	if (!trimmed) return null;
	const parts = trimmed.split(/\D+/).filter(Boolean);
	if (parts.length !== 2) return null;
	const [guildId, channelId] = parts;
	if (!guildId || !channelId) return null;
	return { guildId, channelId };
}

export function applyReadStatesMapToLayout(
	layout: GuildLayoutItem[],
	readStateMap: Record<string, unknown> | undefined,
	previousLayout: GuildLayoutItem[] | undefined,
	channelGuildLookup?: ChannelGuildLookup
) {
	if (!layout.length && !readStateMap) return;

	const combined = new Map<string, Map<string, GuildChannelReadState>>();

	function seedFromLookup(lookup: GuildChannelReadStateLookup | undefined) {
		if (!lookup) return;
		for (const [guildId, channels] of Object.entries(lookup)) {
			if (!guildId) continue;
			let guildMap = combined.get(guildId);
			if (!guildMap) {
				guildMap = new Map();
				combined.set(guildId, guildMap);
			}
			for (const [channelId, state] of Object.entries(channels ?? {})) {
				if (!channelId) continue;
				guildMap.set(channelId, {
					channelId,
					lastReadMessageId: state?.lastReadMessageId ?? null,
					scrollPosition:
						typeof state?.scrollPosition === 'number' && Number.isFinite(state.scrollPosition)
							? state.scrollPosition
							: null
				});
			}
		}
	}

	seedFromLookup(previousLayout ? buildReadStateLookupFromLayout(previousLayout) : undefined);
	seedFromLookup(buildReadStateLookupFromLayout(layout));

	if (readStateMap) {
		for (const [key, value] of Object.entries(readStateMap)) {
			const parsedKey = parseReadStateKey(key);
			let guildId = parsedKey?.guildId ? toSnowflakeString(parsedKey.guildId) : null;
			let channelId = parsedKey?.channelId ? toSnowflakeString(parsedKey.channelId) : null;
			if (!channelId) {
				channelId = toSnowflakeString(key);
			}
			if (!guildId && channelId && channelGuildLookup) {
				const mappedGuildId = toSnowflakeString(channelGuildLookup[channelId]);
				if (mappedGuildId) {
					guildId = mappedGuildId;
				}
			}
			const lastRead = toSnowflakeString(value);
			if (!guildId || !channelId) continue;
			let guildMap = combined.get(guildId);
			if (!guildMap) {
				guildMap = new Map();
				combined.set(guildId, guildMap);
			}
			const existing = guildMap.get(channelId) ?? {
				channelId,
				lastReadMessageId: null,
				scrollPosition: null
			};
			guildMap.set(channelId, {
				channelId,
				lastReadMessageId: lastRead ?? existing.lastReadMessageId ?? null,
				scrollPosition: existing.scrollPosition
			});
		}
	}

	function assignStates(guild: GuildLayoutGuild) {
		const guildMap = combined.get(guild.guildId);
		if (guildMap && guildMap.size) {
			guild.readStates = Array.from(guildMap.values()).map((state) => ({
				channelId: state.channelId,
				lastReadMessageId: state.lastReadMessageId ?? null,
				scrollPosition:
					typeof state.scrollPosition === 'number' && Number.isFinite(state.scrollPosition)
						? state.scrollPosition
						: null
			}));
		} else if (guild.readStates) {
			delete guild.readStates;
		}
	}

	for (const item of layout) {
		if (item.kind === 'guild') {
			assignStates(item);
		} else {
			for (const guild of item.guilds) {
				assignStates(guild);
			}
		}
	}
}

function applyDmReadStatesToSettings(
	settings: AppSettings,
	readStateMap: Record<string, unknown> | undefined
) {
	if (!readStateMap || !settings.dmChannels.length) {
		return;
	}
	const dmStates = new Map<string, string>();
	for (const [key, value] of Object.entries(readStateMap)) {
		const parsed = parseReadStateKey(key);
		if (parsed?.guildId && parsed.guildId !== '@me') {
			continue;
		}
		const channelId = parsed?.guildId === '@me' ? parsed.channelId : parseDmReadStateChannelId(key);
		if (!channelId) continue;
		const lastRead = toSnowflakeString(value);
		if (!lastRead) continue;
		dmStates.set(channelId, lastRead);
	}
	if (!dmStates.size) return;
	let changed = false;
	const nextDmChannels = settings.dmChannels.map((entry) => {
		const lastRead = dmStates.get(entry.channelId) ?? null;
		if (lastRead == null || lastRead === (entry.lastReadMessageId ?? null)) {
			return entry;
		}
		changed = true;
		return { ...entry, lastReadMessageId: lastRead } satisfies VisibleDmChannel;
	});
	if (changed) {
		settings.dmChannels = nextDmChannels;
	}
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
	const modeValue = normalizePresenceModeValue((data as AnyRecord)?.forced_presence);
	const statusPayload = ((data as AnyRecord)?.status ?? {}) as AnyRecord;
	const statusValue = normalizePresenceStatusValue(statusPayload?.status);
	const customStatusText = normalizeCustomStatusTextValue(
		statusPayload?.custom_status_text ?? statusPayload?.customStatusText
	);

	const devicesPayload = ((data as AnyRecord)?.devices ?? {}) as AnyRecord;
	const devices = cloneDeviceSettings({
		audioInputDevice: normalizeDeviceIdValue(
			devicesPayload?.audio_input_device ?? devicesPayload?.audioInputDevice
		),
		audioInputLevel: resolveNumberField(
			devicesPayload,
			'audio_input_level',
			defaultDeviceSettings.audioInputLevel,
			{ min: 0, max: 1 }
		),
		audioInputThreshold: resolveNumberField(
			devicesPayload,
			'audio_input_threshold',
			defaultDeviceSettings.audioInputThreshold,
			{ min: 0, max: 1 }
		),
		audioOutputDevice: normalizeDeviceIdValue(
			devicesPayload?.audio_output_device ?? devicesPayload?.audioOutputDevice
		),
		audioOutputLevel: resolveNumberField(
			devicesPayload,
			'audio_output_level',
			defaultDeviceSettings.audioOutputLevel,
			{ min: 0, max: 1.5 }
		),
		autoGainControl: resolveBooleanField(
			devicesPayload,
			'auto_gain_control',
			defaultDeviceSettings.autoGainControl
		),
		echoCancellation: resolveBooleanField(
			devicesPayload,
			'echo_cancellation',
			defaultDeviceSettings.echoCancellation
		),
		noiseSuppression: resolveBooleanField(
			devicesPayload,
			'noise_suppression',
			defaultDeviceSettings.noiseSuppression
		),
		videoDevice: normalizeDeviceIdValue(devicesPayload?.video_device ?? devicesPayload?.videoDevice)
	});

	const dmChannelEntries = Array.isArray(data.dm_channels)
		? data.dm_channels
				.map((entry) => {
					const record = (entry ?? {}) as AnyRecord;
					const channelId = toSnowflakeString(record?.channel_id ?? record?.channelId);
					if (!channelId) return null;
					const userId = toSnowflakeString(record?.user_id ?? record?.userId);
					const isDead = detectDmChannelDeadState(record);
					return {
						channelId,
						userId: userId ?? null,
						isDead,
						lastReadMessageId: extractLastReadMessageId(record) ?? null,
						hidden: record?.hidden === true,
						hiddenAfterMessageId:
							toSnowflakeString(record?.hidden_after ?? record?.hiddenAfter) ?? null
					} satisfies VisibleDmChannel;
				})
				.filter((entry): entry is VisibleDmChannel => Boolean(entry))
		: [];

	const folderEntries = normalizeFolderArray(data.guild_folders).map((folder, idx) => {
		const id = generateFolderId();
		const guildIds = Array.isArray(folder.guilds)
			? folder.guilds
					.map((gid) => toSnowflakeString(gid))
					.filter((gid): gid is string => Boolean(gid))
			: [];
		const parsedColor = parseColorValue(folder.color);

		return {
			folder: {
				kind: 'folder' as const,
				id,
				name: folder.name ?? null,
				color: parsedColor,
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
		const baseGuild: GuildLayoutGuild = {
			guildId,
			notifications: guildSetting.notifications
				? structuredCloneSafe(guildSetting.notifications)
				: undefined,
			selectedChannelId: selectedChannelId ?? null
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
		selectedGuildId: null,
		presenceMode: modeValue,
		status: {
			status: statusValue,
			customStatusText: customStatusText ?? null
		},
		dmChannels: dmChannelEntries,
		devices
	};
}

export function convertAppSettingsToApi(settings: AppSettings): ModelUserSettingsData {
	const payloadGuilds: ModelUserSettingsGuilds[] = [];
	const payloadFolders: ModelUserSettingsGuildFolders[] = [];
	const payloadDmChannels: ModelUserDMChannels[] = settings.dmChannels.map((entry) => ({
		channel_id: toApiSnowflake(entry.channelId),
		user_id: entry.userId ? toApiSnowflake(entry.userId) : undefined,
		hidden: entry.hidden,
		hidden_after: entry.hiddenAfterMessageId
			? toApiSnowflake(entry.hiddenAfterMessageId)
			: undefined
	}));

	let topPosition = 0;
	for (const item of settings.guildLayout) {
		if (item.kind === 'guild') {
			payloadGuilds.push({
				guild_id: toApiSnowflake(item.guildId),
				position: topPosition,
				notifications: item.notifications ? structuredCloneSafe(item.notifications) : undefined,
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
				payloadGuilds.push({
					guild_id: toApiSnowflake(guild.guildId),
					position: inner,
					notifications: guild.notifications ? structuredCloneSafe(guild.notifications) : undefined,
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
		guild_folders: payloadFolders as unknown as ModelUserSettingsGuildFolders[],
		dm_channels: payloadDmChannels,
		forced_presence: settings.presenceMode === 'auto' ? '' : settings.presenceMode,
		status: {
			status: settings.status.status,
			custom_status_text:
				settings.status.customStatusText != null ? settings.status.customStatusText : ''
		},
		devices: {
			audio_input_device: settings.devices.audioInputDevice ?? undefined,
			audio_input_level: clamp(settings.devices.audioInputLevel, 0, 1),
			audio_input_threshold: clamp(settings.devices.audioInputThreshold, 0, 1),
			audio_output_device: settings.devices.audioOutputDevice ?? undefined,
			audio_output_level: clamp(settings.devices.audioOutputLevel, 0, 1.5),
			auto_gain_control: settings.devices.autoGainControl,
			echo_cancellation: settings.devices.echoCancellation,
			noise_suppression: settings.devices.noiseSuppression,
			video_device: settings.devices.videoDevice ?? undefined
		}
	};
}

function scheduleSave() {
	if (suppressSave) return;
	if (!get(settingsReady)) return;
	if (!get(auth.isAuthenticated)) return;
	saveDirty = true;
	if (saveInFlight) return;
	void persistSettings();
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
		const payload = convertAppSettingsToApi(get(appSettings));
		await auth.api.user.userMeSettingsPost({
			modelUserSettingsData: payload
		});
	} catch (error) {
		console.error('Failed to save settings', error);
		saveDirty = true;
	} finally {
		saveInFlight = false;
		settingsSaving.set(false);
		if (saveDirty) {
			void persistSettings();
		}
	}
}

type SettingsMutator = (settings: AppSettings) => boolean;

export function mutateAppSettings(mutator: SettingsMutator) {
	let didChange = false;
	appSettings.update((current) => {
		const cloned = cloneSettings(current);
		const changed = mutator(cloned);
		if (!changed) {
			return current;
		}
		didChange = true;
		return cloned;
	});
	if (didChange) {
		scheduleSave();
	}
}

export function mutateAppSettingsWithoutSaving(mutator: SettingsMutator) {
	const previousSuppressSave = suppressSave;
	suppressSave = true;
	try {
		appSettings.update((current) => {
			const cloned = cloneSettings(current);
			const changed = mutator(cloned);
			if (!changed) return current;
			return cloned;
		});
	} finally {
		suppressSave = previousSuppressSave;
	}
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

export function setChannelLastReadMessageId(
	guildId: string | null | undefined,
	channelId: string | null | undefined,
	messageId: string | null | undefined
) {
	const normalizedChannelId = toSnowflakeString(channelId);
	if (!normalizedChannelId) return;
	const normalizedGuildId =
		guildId != null ? (toSnowflakeString(guildId) ?? (guildId === '@me' ? '@me' : null)) : '@me';
	if (!normalizedGuildId) return;
	const normalizedMessageId = messageId != null ? (toSnowflakeString(messageId) ?? null) : null;

	mutateAppSettingsWithoutSaving((settings) => {
		if (normalizedGuildId === '@me') {
			const index = settings.dmChannels.findIndex(
				(entry) => entry.channelId === normalizedChannelId
			);
			if (index === -1) return false;
			const existing = settings.dmChannels[index];
			if ((existing.lastReadMessageId ?? null) === normalizedMessageId) {
				return false;
			}
			settings.dmChannels[index] = {
				...existing,
				lastReadMessageId: normalizedMessageId
			} satisfies VisibleDmChannel;
			return true;
		}

		const entry = findGuildLayoutGuild(settings.guildLayout, normalizedGuildId);
		if (!entry) return false;
		const currentStates = Array.isArray(entry.readStates) ? entry.readStates.slice() : [];
		const idx = currentStates.findIndex((state) => state.channelId === normalizedChannelId);
		if (idx >= 0) {
			const existing = currentStates[idx];
			if ((existing.lastReadMessageId ?? null) === normalizedMessageId) {
				return false;
			}
			currentStates[idx] = {
				...existing,
				channelId: normalizedChannelId,
				lastReadMessageId: normalizedMessageId,
				scrollPosition: existing.scrollPosition ?? null
			} satisfies GuildChannelReadState;
			entry.readStates = currentStates;
			return true;
		}

		currentStates.push({
			channelId: normalizedChannelId,
			lastReadMessageId: normalizedMessageId,
			scrollPosition: null
		});
		entry.readStates = currentStates;
		return true;
	});
}

export function addVisibleDmChannel(
	channelId: string | null | undefined,
	userId?: string | null | undefined,
	options?: { isDead?: boolean | null | undefined }
) {
	const normalizedChannelId = toSnowflakeString(channelId);
	if (!normalizedChannelId) return;
	const normalizedUserId = toSnowflakeString(userId) ?? null;
	const desiredDeadState = options?.isDead != null ? Boolean(options.isDead) : null;
	mutateAppSettings((settings) => {
		const existingIndex = settings.dmChannels.findIndex(
			(entry) => entry.channelId === normalizedChannelId
		);
		if (existingIndex !== -1) {
			const existing = settings.dmChannels[existingIndex];
			const currentDead = existing.isDead ?? false;
			const nextDead = desiredDeadState != null ? desiredDeadState : currentDead;
			const shouldUpdateVisibility = existing.hidden || existing.hiddenAfterMessageId != null;
			if (
				!shouldUpdateVisibility &&
				(existing.userId ?? null) === normalizedUserId &&
				currentDead === nextDead
			) {
				return false;
			}
			settings.dmChannels[existingIndex] = {
				...existing,
				userId: normalizedUserId,
				isDead: nextDead,
				lastReadMessageId: existing.lastReadMessageId ?? null,
				hidden: false,
				hiddenAfterMessageId: null
			};
			return true;
		}
		settings.dmChannels = [
			...settings.dmChannels,
			{
				channelId: normalizedChannelId,
				userId: normalizedUserId,
				isDead: desiredDeadState != null ? desiredDeadState : false,
				lastReadMessageId: null,
				hidden: false,
				hiddenAfterMessageId: null
			}
		];
		return true;
	});
}

export function markDmChannelHidden(
	channelId: string | null | undefined,
	hiddenAfter?: string | null | undefined
) {
	const normalizedChannelId = toSnowflakeString(channelId);
	if (!normalizedChannelId) return;
	const normalizedHiddenAfter = toSnowflakeString(hiddenAfter) ?? null;
	mutateAppSettings((settings) => {
		const existingIndex = settings.dmChannels.findIndex(
			(entry) => entry.channelId === normalizedChannelId
		);
		if (existingIndex !== -1) {
			const existing = settings.dmChannels[existingIndex];
			if (
				existing.hidden === true &&
				(existing.hiddenAfterMessageId ?? null) === normalizedHiddenAfter
			) {
				return false;
			}
			settings.dmChannels[existingIndex] = {
				...existing,
				hidden: true,
				hiddenAfterMessageId: normalizedHiddenAfter
			};
			return true;
		}
		settings.dmChannels = [
			...settings.dmChannels,
			{
				channelId: normalizedChannelId,
				userId: null,
				isDead: false,
				lastReadMessageId: null,
				hidden: true,
				hiddenAfterMessageId: normalizedHiddenAfter
			}
		];
		return true;
	});
}

export function markDmChannelVisible(channelId: string | null | undefined) {
	const normalizedChannelId = toSnowflakeString(channelId);
	if (!normalizedChannelId) return;
	mutateAppSettings((settings) => {
		const existingIndex = settings.dmChannels.findIndex(
			(entry) => entry.channelId === normalizedChannelId
		);
		if (existingIndex !== -1) {
			const existing = settings.dmChannels[existingIndex];
			if (existing.hidden === false && existing.hiddenAfterMessageId == null) {
				return false;
			}
			settings.dmChannels[existingIndex] = {
				...existing,
				hidden: false,
				hiddenAfterMessageId: null
			};
			return true;
		}
		settings.dmChannels = [
			...settings.dmChannels,
			{
				channelId: normalizedChannelId,
				userId: null,
				isDead: false,
				lastReadMessageId: null,
				hidden: false,
				hiddenAfterMessageId: null
			}
		];
		return true;
	});
}

export function setVisibleDmChannels(
	entries: Iterable<{
		channelId: string | null | undefined;
		userId?: string | null | undefined;
		isDead?: boolean | null | undefined;
		state?: unknown;
	}>
) {
	const incoming = Array.from(entries ?? []);
	mutateAppSettings((settings) => {
		const previous = settings.dmChannels;
		const previousById = new Map(previous.map((entry) => [entry.channelId, entry]));
		const normalized: VisibleDmChannel[] = [];
		const seen = new Set<string>();

		for (const entry of incoming) {
			const record = (entry ?? {}) as AnyRecord;
			const channelId = toSnowflakeString(record?.channelId);
			if (!channelId || seen.has(channelId)) continue;
			seen.add(channelId);
			const userId = record?.userId ? toSnowflakeString(record.userId) : null;
			let explicitDead: boolean | null = null;
			if (typeof record?.isDead === 'boolean') {
				explicitDead = record.isDead;
			} else if (detectDmChannelDeadState(record)) {
				explicitDead = true;
			}
			const previousEntry = previousById.get(channelId);
			const candidateLastRead = extractLastReadMessageId(record);
			const resolvedLastRead = candidateLastRead ?? previousEntry?.lastReadMessageId ?? null;
			const hidden = record?.hidden === true;
			const hiddenAfter = hidden
				? (toSnowflakeString(record?.hidden_after ?? record?.hiddenAfter) ?? null)
				: null;
			normalized.push({
				channelId,
				userId,
				isDead: explicitDead ?? previousEntry?.isDead ?? false,
				lastReadMessageId: resolvedLastRead,
				hidden,
				hiddenAfterMessageId: hidden ? hiddenAfter : null
			});
		}

		if (
			previous.length === normalized.length &&
			previous.every((item, index) => {
				const candidate = normalized[index];
				if (!candidate) return false;
				return (
					item.channelId === candidate.channelId &&
					(item.userId ?? null) === (candidate.userId ?? null) &&
					(item.isDead ?? false) === (candidate.isDead ?? false) &&
					(item.lastReadMessageId ?? null) === (candidate.lastReadMessageId ?? null) &&
					(item.hidden ?? false) === (candidate.hidden ?? false) &&
					(item.hiddenAfterMessageId ?? null) === (candidate.hiddenAfterMessageId ?? null)
				);
			})
		) {
			return false;
		}

		settings.dmChannels = normalized;
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

async function loadSettingsFromApi(currentToken: string | null = get(auth.token)) {
	const tokenToLoad = currentToken ?? null;
	if (settingsLoadInFlight) {
		if (tokenToLoad === settingsLoadToken) {
			return;
		}
		queuedSettingsToken = tokenToLoad;
		return;
	}
	settingsLoadInFlight = true;
	settingsLoadToken = tokenToLoad;
	hasSyncedGuildLayout = false;
	try {
                if (!tokenToLoad) {
                        suppressSave = true;
                        appSettings.set(createDefaultSettingsSnapshot());
                        suppressSave = false;
                        settingsReady.set(false);
                        loadedSettingsToken = null;
                        auth.ingestGuilds([]);
			updateUnreadSnapshot(null);
			settingsLoadedOnce = false;
			return;
		}

		try {
			const previousSettings = get(appSettings);
			const response = await auth.api.user.userMeSettingsGet();
			const responseData = response.data ?? {};
			const guildListRaw =
				(responseData as any)?.guilds ??
				(responseData as any)?.user_guilds ??
				(responseData as any)?.guild_list ??
				(responseData as any)?.guildList ??
				(responseData as any)?.guilds_list ??
				null;
			auth.ingestGuilds(guildListRaw);
			const lastMessageSnapshot =
				(responseData as any)?.guilds_last_messages ??
				(responseData as any)?.guilds_last_message_ids ??
				(responseData as any)?.guild_channel_last_messages ??
				(responseData as any)?.guild_channels_last_messages ??
				(responseData as any)?.guild_channel_last_message_ids ??
				(responseData as any)?.guild_channels_last_message_ids ??
				(responseData as any)?.channel_last_message_ids ??
				(responseData as any)?.channels_last_message_ids ??
				(responseData as any)?.channel_last_messages ??
				(responseData as any)?.last_messages ??
				null;
			const channelGuildLookup = buildChannelGuildLookupFromSnapshot(lastMessageSnapshot);
                        if (response.status === 204 || !response.data?.settings) {
                                suppressSave = true;
                                const next = createDefaultSettingsSnapshot();
                                applyReadStatesMapToLayout(
                                        next.guildLayout,
                                        responseData?.read_states,
                                        previousSettings.guildLayout,
					channelGuildLookup
				);
				applyDmReadStatesToSettings(next, responseData?.read_states);
				appSettings.set(next);
				suppressSave = false;
			} else {
				const parsed = convertFromApi(response.data.settings);
				applyReadStatesMapToLayout(
					parsed.guildLayout,
					responseData.read_states,
					previousSettings.guildLayout,
					channelGuildLookup
				);
				applyDmReadStatesToSettings(parsed, responseData.read_states);
				suppressSave = true;
				suppressThemePropagation = true;
				suppressLocalePropagation = true;
				appSettings.set(parsed);
				theme.set(parsed.theme);
				locale.set(parsed.language);
				suppressThemePropagation = false;
				suppressLocalePropagation = false;
				suppressSave = false;
			}
			updateUnreadSnapshot(lastMessageSnapshot);
			if (tokenToLoad) {
				loadedSettingsToken = tokenToLoad;
			}
			settingsLoadedOnce = true;
		} catch (error) {
			console.error('Failed to load settings', error);
                        suppressSave = true;
                        appSettings.set(createDefaultSettingsSnapshot());
                        suppressSave = false;
                        loadedSettingsToken = null;
                        updateUnreadSnapshot(null);
                        settingsLoadedOnce = false;
		}

		settingsReady.set(true);
		syncLayoutWithGuilds();
	} finally {
		settingsLoadInFlight = false;
		settingsLoadToken = null;
		const queued = queuedSettingsToken;
		queuedSettingsToken = null;
		if (queued !== null && queued !== tokenToLoad) {
			void loadSettingsFromApi(queued);
		}
	}
}

function handleAuthTokenChange(token: string | null) {
	if (token) {
		if (!settingsLoadedOnce || !get(settingsReady)) {
			loadedSettingsToken = token;
			void loadSettingsFromApi(token);
			return;
		}
		loadedSettingsToken = token;
	} else {
		hasSyncedGuildLayout = false;
		guildsHydrated = false;
                suppressSave = true;
                appSettings.set(createDefaultSettingsSnapshot());
                suppressSave = false;
                settingsReady.set(false);
                loadedSettingsToken = null;
                settingsLoadedOnce = false;
	}
}

function handleGuildsChange(guilds: unknown) {
	latestGuilds = Array.isArray(guilds) ? guilds : [];
	if (get(settingsReady)) {
		guildsHydrated = true;
	}
	if (get(settingsReady)) {
		syncLayoutWithGuilds();
	}
}

interface SettingsSubscriptionsState {
	subscribed: boolean;
	unsubscribers: (() => void)[];
}

declare global {
	// eslint-disable-next-line no-var
	var __GOCHAT_SETTINGS_SUBS__: SettingsSubscriptionsState | undefined;
	interface Window {
		__GOCHAT_SETTINGS_SUBS__?: SettingsSubscriptionsState;
	}
}

const settingsGlobalScope = globalThis as typeof globalThis & {
	__GOCHAT_SETTINGS_SUBS__?: SettingsSubscriptionsState;
};

const settingsSubscriptions =
	settingsGlobalScope.__GOCHAT_SETTINGS_SUBS__ ??
	(settingsGlobalScope.__GOCHAT_SETTINGS_SUBS__ = { subscribed: false, unsubscribers: [] });

if (!settingsSubscriptions.subscribed) {
	const unsubscribers: (() => void)[] = [];
	unsubscribers.push(auth.token.subscribe(handleAuthTokenChange));
	unsubscribers.push(auth.guilds.subscribe(handleGuildsChange));

	settingsSubscriptions.subscribed = true;
	settingsSubscriptions.unsubscribers = unsubscribers;

	if (import.meta.hot) {
		import.meta.hot.dispose(() => {
			for (const unsubscribe of settingsSubscriptions.unsubscribers.splice(0)) {
				try {
					unsubscribe();
				} catch {}
			}
			settingsSubscriptions.subscribed = false;
		});
	}
}

export function ingestPresenceSettingsUpdate(
	settingsPayload: ModelUserSettingsData | null | undefined
): void {
	if (!settingsPayload) return;
	const nextMode = normalizePresenceModeValue((settingsPayload as AnyRecord)?.forced_presence);
	const statusPayload = ((settingsPayload as AnyRecord)?.status ?? {}) as AnyRecord;
	const nextStatus = normalizePresenceStatusValue(statusPayload?.status);
	const nextCustom =
		normalizeCustomStatusTextValue(
			statusPayload?.custom_status_text ?? statusPayload?.customStatusText
		) ?? null;

	mutateAppSettingsWithoutSaving((settings) => {
		let changed = false;
		if (settings.presenceMode !== nextMode) {
			settings.presenceMode = nextMode;
			changed = true;
		}
		if (settings.status.status !== nextStatus) {
			settings.status.status = nextStatus;
			changed = true;
		}
		if ((settings.status.customStatusText ?? null) !== nextCustom) {
			settings.status.customStatusText = nextCustom;
			changed = true;
		}
		return changed;
	});
}

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
