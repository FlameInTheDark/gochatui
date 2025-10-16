const HEX_COLOR_PATTERN = /^[0-9a-f]{1,8}$/i;

function clampColorFromNumber(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value === 0) return 0;

	const truncated = Math.trunc(value);
	if (truncated === 0) return 0;

	const remainder = ((truncated % 0x1000000) + 0x1000000) % 0x1000000;
	return remainder;
}

function clampColorFromBigInt(value: bigint): number {
	const masked = Number(value & 0xffffffn);
	return Number.isFinite(masked) && !Number.isNaN(masked) ? masked : 0;
}

function sanitizeColorInput(raw: string): string {
	if (!raw) return '';
	const trimmed = raw.trim();
	if (!trimmed) return '';
	return trimmed.replace(/^['"]+|['"]+$/g, '');
}

export function parseColorValue(color?: number | string | bigint | null): number | null {
	if (color == null) {
		return null;
	}

	if (typeof color === 'number') {
		return Number.isFinite(color) ? clampColorFromNumber(color) : null;
	}

	if (typeof color === 'bigint') {
		return clampColorFromBigInt(color);
	}

	if (typeof color === 'string') {
		const trimmed = sanitizeColorInput(color);
		if (!trimmed) {
			return null;
		}

		if (/^0x/i.test(trimmed)) {
			try {
				const bigint = BigInt(trimmed);
				return clampColorFromBigInt(bigint);
			} catch {
				const parsed = Number.parseInt(trimmed.slice(2), 16);
				return Number.isFinite(parsed) ? clampColorFromNumber(parsed) : null;
			}
		}

		if (trimmed.startsWith('#')) {
			const hex = trimmed.slice(1);
			if (!HEX_COLOR_PATTERN.test(hex)) {
				return null;
			}
			try {
				const bigint = BigInt(`0x${hex}`);
				return clampColorFromBigInt(bigint);
			} catch {
				const parsed = Number.parseInt(hex, 16);
				return Number.isFinite(parsed) ? clampColorFromNumber(parsed) : null;
			}
		}

		if (/^[0-9]+$/.test(trimmed)) {
			try {
				const bigint = BigInt(trimmed);
				return clampColorFromBigInt(bigint);
			} catch {
				const parsed = Number.parseInt(trimmed, 10);
				return Number.isFinite(parsed) ? clampColorFromNumber(parsed) : null;
			}
		}

		if (HEX_COLOR_PATTERN.test(trimmed)) {
			try {
				const bigint = BigInt(`0x${trimmed}`);
				return clampColorFromBigInt(bigint);
			} catch {
				const parsed = Number.parseInt(trimmed, 16);
				return Number.isFinite(parsed) ? clampColorFromNumber(parsed) : null;
			}
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
