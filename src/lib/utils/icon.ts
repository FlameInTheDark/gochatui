import type { DtoIcon } from '$lib/api';
import { buildAttachmentUrl } from '$lib/utils/cdn';

function normalizeUrlCandidate(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        return trimmed;
}

export function resolveIconUrl(icon: unknown): string | null {
        if (icon == null) return null;

        if (typeof icon === 'string') {
                const candidate = normalizeUrlCandidate(icon);
                if (!candidate) return null;
                if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate) || candidate.startsWith('//') || candidate.startsWith('/')) {
                        return candidate;
                }
                return buildAttachmentUrl(candidate);
        }

        if (typeof icon === 'number' || typeof icon === 'bigint') {
                return buildAttachmentUrl(icon);
        }

        if (typeof icon === 'object') {
                const data = icon as Partial<DtoIcon> & { id?: unknown };
                const url = normalizeUrlCandidate(data.url);
                if (url) return url;
                if (data.id != null) {
                        return resolveIconUrl(data.id);
                }
        }

        return null;
}
