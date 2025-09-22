export function colorIntToHex(color?: number | string | bigint | null): string {
	const numeric =
		typeof color === 'bigint'
			? Number(color)
			: typeof color === 'string'
				? Number(color)
				: typeof color === 'number'
					? color
					: Number.NaN;

	if (!Number.isFinite(numeric) || numeric < 0) {
		return '#000000';
	}

	return `#${Math.round(numeric).toString(16).padStart(6, '0').toUpperCase()}`;
}
