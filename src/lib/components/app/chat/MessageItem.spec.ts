import { describe, expect, it, afterEach } from 'vitest';
import { extractInvite } from './extractInvite';

const originalWindow = (globalThis as any).window;
const originalLocation = (globalThis as any).location;

function setOrigin(origin: string) {
        const parsed = new URL(origin);
        const fakeLocation = {
                origin: parsed.origin,
                host: parsed.host,
                protocol: parsed.protocol
        };

        (globalThis as any).window = { location: fakeLocation };
        (globalThis as any).location = fakeLocation;
}

afterEach(() => {
        if (originalWindow === undefined) {
                delete (globalThis as any).window;
        } else {
                (globalThis as any).window = originalWindow;
        }

        if (originalLocation === undefined) {
                delete (globalThis as any).location;
        } else {
                (globalThis as any).location = originalLocation;
        }
});

describe('extractInvite', () => {
        it('returns an invite when the URL matches the current origin', () => {
                setOrigin('https://chat.example.com');

                expect(extractInvite('https://chat.example.com/app/i/ABC123')).toEqual({ code: 'ABC123' });
        });

        it('returns null when the URL origin differs from the current origin', () => {
                setOrigin('https://chat.example.com');

                expect(extractInvite('https://another.example.com/app/i/ABC123')).toBeNull();
        });

        it('returns null when no location information is available', () => {
                delete (globalThis as any).window;
                delete (globalThis as any).location;

                expect(extractInvite('https://chat.example.com/app/i/ABC123')).toBeNull();
        });
});
