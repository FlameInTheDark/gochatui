import type { PresenceStatus } from '$lib/stores/presence';
import { m } from '$lib/paraglide/messages.js';

export function presenceStatusLabel(status: PresenceStatus | null | undefined): string {
        switch (status) {
                case 'online':
                        return m.status_online();
                case 'idle':
                        return m.status_idle();
                case 'dnd':
                        return m.status_dnd();
                case 'offline':
                default:
                        return m.status_offline();
        }
}
