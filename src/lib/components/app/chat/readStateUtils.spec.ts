import { describe, expect, it } from 'vitest';
import { isMessageNewer } from './readStateUtils';

describe('isMessageNewer', () => {
        it('returns false when there are no unread messages', () => {
                expect(isMessageNewer('123', '123')).toBe(false);
                expect(isMessageNewer('123', '456')).toBe(false);
        });

        it('returns true when the message is newer than the read marker', () => {
                expect(isMessageNewer('789', '456')).toBe(true);
                expect(isMessageNewer('1000', '999')).toBe(true);
        });

        it('handles missing markers gracefully', () => {
                expect(isMessageNewer('1', null)).toBe(true);
                expect(isMessageNewer(null, '1')).toBe(false);
        });
});
