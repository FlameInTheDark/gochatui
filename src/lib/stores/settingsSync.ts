import { browser } from '$app/environment';
import type { ModelUserSettingsData } from '$lib/api';
import { wsEvent } from '$lib/client/ws';
import { ingestPresenceSettingsUpdate } from '$lib/stores/settings';

type AnyRecord = Record<string, unknown>;

if (browser) {
        wsEvent.subscribe((event) => {
                if (!event) return;
                if (event.op !== 0) return;
                if (typeof event.t !== 'number' || event.t !== 401) return;
                const payload = ((event as AnyRecord).d as AnyRecord) ?? {};
                const settingsPayload = payload?.settings as ModelUserSettingsData | undefined;
                ingestPresenceSettingsUpdate(settingsPayload);
        });
}
