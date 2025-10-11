import { computeApiBase } from '$lib/runtime/api';

export function buildAttachmentUrl(id: unknown): string | null {
        if (id == null) return null;
        try {
                const normalized = String(id).trim();
                if (!normalized) return null;
                const safeId = normalized.replace(/[^0-9A-Za-z_-]/g, '');
                if (!safeId) return null;
                const base = computeApiBase();
                const sanitized = base.replace(/\/$/, '');
                return `${sanitized}/attachments/${safeId}`;
        } catch {
                return null;
        }
}
