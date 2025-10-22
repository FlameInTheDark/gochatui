import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: false
}));

vi.mock('$lib/paraglide/runtime', () => ({
	setLocale: vi.fn()
}));

import { get } from 'svelte/store';

import {
	appSettings,
	applyReadStatesMapToLayout,
	cloneDeviceSettings,
	type AppSettings,
	type GuildLayoutItem,
	type GuildTopLevelItem,
	guildChannelReadStateLookup
} from './settings';

describe('applyReadStatesMapToLayout', () => {
	let originalSettings: AppSettings;

	beforeEach(() => {
		originalSettings = JSON.parse(JSON.stringify(get(appSettings))) as AppSettings;
	});

	afterEach(() => {
		appSettings.set(originalSettings);
	});

	it('maps channel-scoped read state entries to their guild via lookup', () => {
		const layout: GuildLayoutItem[] = [{ kind: 'guild', guildId: '123' }];
		const readStateMap: Record<string, unknown> = { '456': '789' };
		const channelGuildLookup = { '456': '123' };

		applyReadStatesMapToLayout(layout, readStateMap, undefined, channelGuildLookup);

		const guildLayout = layout[0] as GuildTopLevelItem;

		expect(guildLayout.readStates).toEqual([
			{
				channelId: '456',
				lastReadMessageId: '789',
				scrollPosition: null
			}
		]);

		appSettings.set({
			language: 'en',
			theme: 'system',
			chatFontScale: 1,
			chatSpacing: 1,
			guildLayout: layout,
			selectedGuildId: null,
			presenceMode: 'auto',
			status: {
				status: 'online',
				customStatusText: null
			},
			dmChannels: [],
			devices: cloneDeviceSettings(null)
		});

		const lookup = get(guildChannelReadStateLookup);
		expect(lookup['123']).toBeDefined();
		expect(lookup['123']?.['456']?.lastReadMessageId).toBe('789');
	});
});
