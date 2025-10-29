import type { DtoMessage } from '$lib/api';

export type MessageAttachment = NonNullable<DtoMessage['attachments']>[number];

export type AttachmentKind = 'image' | 'video' | 'audio' | 'other';

export type AttachmentMeta = {
        url: string | null;
        previewUrl: string | null;
        kind: AttachmentKind;
        sizeLabel: string | null;
        name: string;
        contentType: string | null;
        aspectRatio: string | null;
        width: number | null;
        height: number | null;
        isGif: boolean;
};

export type AttachmentRenderItem = {
        attachment: MessageAttachment;
        meta: AttachmentMeta;
        index: number;
};

export type AttachmentRenderGroup =
        | { type: 'gallery'; items: AttachmentRenderItem[] }
        | { type: 'single'; item: AttachmentRenderItem };

export const VISUAL_ATTACHMENT_MAX_DIMENSION = 350;
export const visualAttachmentWrapperStyle = `max-width: min(100%, ${VISUAL_ATTACHMENT_MAX_DIMENSION}px);`;
export const visualAttachmentMediaStyle = `max-width: 100%; max-height: ${VISUAL_ATTACHMENT_MAX_DIMENSION}px; width: auto; height: auto;`;
export const GIF_PLACEHOLDER_SRC =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function formatContentType(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
}

export function attachmentUrl(attachment: MessageAttachment | undefined): string | null {
        const raw = (attachment as any)?.url;
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        return trimmed ? trimmed : null;
}

export function attachmentPreviewUrl(attachment: MessageAttachment | undefined): string | null {
        const raw = (attachment as any)?.preview_url;
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        return trimmed ? trimmed : null;
}

export function attachmentContentType(attachment: MessageAttachment | undefined): string | null {
        return formatContentType((attachment as any)?.content_type);
}

export function attachmentFilename(attachment: MessageAttachment | undefined): string {
        const raw = (attachment as any)?.filename;
        if (typeof raw === 'string' && raw.trim()) {
                return raw.trim();
        }
        return 'Attachment';
}

const imageExtensions = new Set([
        'png',
        'jpg',
        'jpeg',
        'gif',
        'webp',
        'avif',
        'bmp',
        'svg'
]);

const videoExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv']);
const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus']);

export function detectAttachmentKind(attachment: MessageAttachment | undefined): AttachmentKind {
        const type = attachmentContentType(attachment)?.toLowerCase();
        if (type) {
                if (type.startsWith('image/')) return 'image';
                if (type.startsWith('video/')) return 'video';
                if (type.startsWith('audio/')) return 'audio';
        }

        const filename = attachmentFilename(attachment).toLowerCase();
        const ext = filename.split('.').pop();
        if (ext) {
                if (imageExtensions.has(ext)) return 'image';
                if (videoExtensions.has(ext)) return 'video';
                if (audioExtensions.has(ext)) return 'audio';
        }

        return 'other';
}

export function formatAttachmentSize(value: unknown): string | null {
        let bytes: number | null = null;
        if (typeof value === 'number' && Number.isFinite(value)) {
                bytes = value;
        } else if (typeof value === 'string') {
                const parsed = Number(value);
                bytes = Number.isFinite(parsed) ? parsed : null;
        }
        if (bytes == null || bytes < 0) return null;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
        let unitIndex = 0;
        let display = bytes;
        while (display >= 1024 && unitIndex < units.length - 1) {
                display /= 1024;
                unitIndex += 1;
        }
        const formatted =
                unitIndex === 0
                        ? Math.round(display).toString()
                        : display >= 10
                                ? display.toFixed(0)
                                : display.toFixed(1);
        return `${formatted} ${units[unitIndex]}`;
}

export function parseAttachmentDimension(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
                return value;
        }
        if (typeof value === 'string') {
                const parsed = Number(value);
                if (Number.isFinite(parsed) && parsed > 0) {
                        return parsed;
                }
        }
        return null;
}

export function getAttachmentMeta(attachment: MessageAttachment | undefined): AttachmentMeta {
        const width = parseAttachmentDimension((attachment as any)?.width);
        const height = parseAttachmentDimension((attachment as any)?.height);
        const aspectRatio = width != null && height != null ? `${width} / ${height}` : null;
        const kind = detectAttachmentKind(attachment);
        const name = attachmentFilename(attachment);
        const contentType = attachmentContentType(attachment);
        const lowerContentType = contentType?.toLowerCase() ?? null;
        const lowerName = name.toLowerCase();
        const isGif =
                kind === 'image' &&
                (lowerContentType === 'image/gif' || lowerName.endsWith('.gif'));

        const url = attachmentUrl(attachment);
        const previewUrl = attachmentPreviewUrl(attachment) ?? url;

        return {
                url,
                previewUrl,
                kind,
                sizeLabel: formatAttachmentSize((attachment as any)?.size),
                name,
                contentType,
                aspectRatio,
                width,
                height,
                isGif,
        };
}

export function groupAttachmentsForRender(
        attachments: MessageAttachment[] | null | undefined
): AttachmentRenderGroup[] {
        const result: AttachmentRenderGroup[] = [];
        if (!attachments?.length) {
                return result;
        }

        let pendingGallery: AttachmentRenderItem[] = [];

        const flushPendingGallery = () => {
                if (pendingGallery.length > 1) {
                        result.push({ type: 'gallery', items: pendingGallery });
                } else if (pendingGallery.length === 1) {
                        result.push({ type: 'single', item: pendingGallery[0] });
                }
                pendingGallery = [];
        };

        attachments.forEach((attachment, index) => {
                const meta = getAttachmentMeta(attachment);
                const item: AttachmentRenderItem = { attachment, meta, index };
                const eligibleForGallery = meta.kind === 'image' && !!meta.previewUrl;
                if (eligibleForGallery) {
                        pendingGallery.push(item);
                        return;
                }

                flushPendingGallery();
                result.push({ type: 'single', item });
        });

        flushPendingGallery();

        return result;
}

function normalizeMessageId(value: string | number | bigint | null | undefined): string | null {
        if (value == null) return null;
        try {
                if (typeof value === 'bigint') {
                        return value.toString();
                }
                return BigInt(value).toString();
        } catch {
                return String(value);
        }
}

export function attachmentStableKey(
        attachment: MessageAttachment | undefined,
        index: number,
        options?: { messageId?: string | number | bigint | null | undefined }
): string {
        const rawId = (attachment as any)?.id;
        if (rawId != null) {
                try {
                        if (typeof rawId === 'bigint') {
                                return rawId.toString();
                        }
                        return BigInt(rawId).toString();
                } catch {
                        return String(rawId);
                }
        }

        const url = attachmentUrl(attachment);
        if (url) {
                return `url:${url}`;
        }

        const messageKey = normalizeMessageId(options?.messageId) ?? 'message';
        return `${messageKey}:${attachmentFilename(attachment)}:${index}`;
}

export function createVideoFallbackGradient(key: string): string {
        if (!key) {
                key = 'fallback';
        }

        let hash = 0;
        for (let index = 0; index < key.length; index += 1) {
                hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
        }

        const hue = hash % 360;
        const secondHue = (hue + 60) % 360;

        return `linear-gradient(135deg, hsl(${hue}, 70%, 55%), hsl(${secondHue}, 65%, 45%))`;
}

export function computeVisualAttachmentBounds(
        meta: Pick<AttachmentMeta, 'width' | 'height'>,
        maxDimension = VISUAL_ATTACHMENT_MAX_DIMENSION
): { width: number; height: number } {
        const width = meta.width ?? maxDimension;
        const height = meta.height ?? maxDimension;
        if (!width && !height) {
                return { width: maxDimension, height: maxDimension };
        }
        if (!width) {
                const computedWidth = Math.min(maxDimension, height);
                return { width: computedWidth, height };
        }
        if (!height) {
                const computedHeight = Math.min(maxDimension, width);
                return { width, height: computedHeight };
        }
        const scale = Math.min(maxDimension / width, maxDimension / height, 1);
        return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function galleryGridTemplate(itemCount: number): string {
        if (itemCount <= 1) {
                return 'grid-template-columns: repeat(1, minmax(0, 1fr));';
        }

        if (itemCount === 2) {
                return 'grid-template-columns: repeat(2, minmax(0, 1fr));';
        }

        if (itemCount === 3 || itemCount === 4) {
                return 'grid-template-columns: repeat(2, minmax(0, 1fr));';
        }

        return 'grid-template-columns: repeat(3, minmax(0, 1fr));';
}
