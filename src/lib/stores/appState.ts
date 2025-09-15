import { writable } from 'svelte/store';
import type { DtoChannel, DtoMessage } from '$lib/api';

export const selectedGuildId = writable<string | null>(null);
export const selectedChannelId = writable<string | null>(null);

export const channelsByGuild = writable<Record<string, DtoChannel[]>>({});
export const messagesByChannel = writable<Record<string, DtoMessage[]>>({});

export const searchOpen = writable(false);
export const searchQuery = writable('');
export const searchAnchor = writable<{ x: number; y: number } | null>(null);

// Remember last visited channel per guild
export const lastChannelByGuild = writable<Record<string, string>>({});

// Gate to control when MessageList is allowed to fetch
export const channelReady = writable(false);

// Guild settings overlay state
export const guildSettingsOpen = writable(false);
