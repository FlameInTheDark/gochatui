const HEX_COLOR_PATTERN = /^[0-9a-f]{1,8}$/i;

function clampColorInt(value: number): number {
        if (!Number.isFinite(value)) return 0;
        if (value < 0) return 0;
        if (value > 0xffffff) return 0xffffff;
        return Math.round(value);
}

export function parseColorValue(color?: number | string | bigint | null): number | null {
        if (color == null) {
                return null;
        }

        if (typeof color === 'number') {
                return Number.isFinite(color) ? clampColorInt(color) : null;
        }

        if (typeof color === 'bigint') {
                return clampColorInt(Number(color));
        }

        if (typeof color === 'string') {
                const trimmed = color.trim();
                if (!trimmed) {
                        return null;
                }

                if (/^0x/i.test(trimmed)) {
                        const parsed = Number.parseInt(trimmed.slice(2), 16);
                        return Number.isFinite(parsed) ? clampColorInt(parsed) : null;
                }

                if (trimmed.startsWith('#')) {
                        const hex = trimmed.slice(1);
                        if (!HEX_COLOR_PATTERN.test(hex)) {
                                return null;
                        }
                        const parsed = Number.parseInt(hex, 16);
                        return Number.isFinite(parsed) ? clampColorInt(parsed) : null;
                }

                if (/^[0-9]+$/.test(trimmed)) {
                        const parsed = Number.parseInt(trimmed, 10);
                        return Number.isFinite(parsed) ? clampColorInt(parsed) : null;
                }

                if (HEX_COLOR_PATTERN.test(trimmed)) {
                        const parsed = Number.parseInt(trimmed, 16);
                        return Number.isFinite(parsed) ? clampColorInt(parsed) : null;
                }

                return null;
        }

        return null;
}

export function colorIntToHex(color?: number | string | bigint | null): string {
        const numeric = parseColorValue(color);
        if (numeric == null) {
                return '#000000';
        }

        return `#${numeric.toString(16).padStart(6, '0').toUpperCase()}`;
}
