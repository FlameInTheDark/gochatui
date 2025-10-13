export function compareSnowflakes(a: string | null, b: string | null): number {
        if (a === b) return 0;
        if (a == null) return b == null ? 0 : -1;
        if (b == null) return 1;
        const digitsA = /^\d+$/.test(a);
        const digitsB = /^\d+$/.test(b);
        if (digitsA && digitsB) {
                try {
                        const ai = BigInt(a);
                        const bi = BigInt(b);
                        if (ai === bi) return 0;
                        return ai < bi ? -1 : 1;
                } catch {
                        // fall through to string comparison
                }
        }
        if (a.length !== b.length) return a.length < b.length ? -1 : 1;
        return a.localeCompare(b);
}

export function isMessageNewer(messageId: string | null, lastReadMessageId: string | null): boolean {
        if (!messageId) return false;
        if (!lastReadMessageId) return true;
        return compareSnowflakes(messageId, lastReadMessageId) > 0;
}
