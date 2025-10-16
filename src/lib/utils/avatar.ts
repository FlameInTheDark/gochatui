import { buildAttachmentUrl } from '$lib/utils/cdn';

function normalizeAvatarValue(value: unknown, visited = new Set<unknown>()): string | null {
	if (value == null) {
		return null;
	}

	if (typeof value === 'object') {
		if (visited.has(value)) {
			return null;
		}

		visited.add(value);
		const record = value as Record<string, unknown>;

		if (typeof record.url === 'string') {
			return normalizeAvatarValue(record.url, visited);
		}

                const directKeys = [
                        'avatar',
                        'avatarId',
                        'avatar_id',
                        'avatarUrl',
                        'avatar_url',
                        'id'
                ] as const;

		for (const key of directKeys) {
			if (key in record) {
				const resolved = normalizeAvatarValue(record[key], visited);
				if (resolved) {
					return resolved;
				}
			}
		}
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();

		if (!trimmed) {
			return null;
		}

		if (/^https?:\/\//i.test(trimmed)) {
			return trimmed;
		}

		return buildAttachmentUrl(trimmed);
	}

	if (typeof value === 'number' || typeof value === 'bigint') {
		return buildAttachmentUrl(value);
	}

	return null;
}

export function extractAvatarUrl(source: unknown, visited = new Set<unknown>()): string | null {
	if (source == null) {
		return null;
	}

	const direct = normalizeAvatarValue(source, visited);
	if (direct) {
		return direct;
	}

	if (typeof source !== 'object') {
		return null;
	}

	if (visited.has(source)) {
		return null;
	}

	visited.add(source);
	const record = source as Record<string, unknown>;

	const candidates: unknown[] = [
		record.avatar,
		record.avatarUrl,
		record.avatar_url,
		record.avatarId,
		record.avatar_id,
		record.image,
		record.icon,
		record.iconUrl,
		record.icon_url
	];

	for (const candidate of candidates) {
		const resolved = normalizeAvatarValue(candidate, visited);
		if (resolved) {
			return resolved;
		}
	}

	const nestedKeys: (keyof typeof record)[] = ['profile', 'user', 'member'];
	for (const key of nestedKeys) {
		if (!(key in record)) {
			continue;
		}

		const nested = record[key];
		const resolved = extractAvatarUrl(nested, visited);
		if (resolved) {
			return resolved;
		}
	}

	return null;
}

export function resolveAvatarUrl(...sources: unknown[]): string | null {
	for (const source of sources) {
		const resolved = extractAvatarUrl(source, new Set());
		if (resolved) {
			return resolved;
		}
	}

	return null;
}
