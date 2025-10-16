<script lang="ts">
	import type { DtoChannel, DtoMember, DtoMessage, DtoRole } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import {
		channelsByGuild,
		membersByGuild,
		selectedChannelId,
		selectedGuildId
	} from '$lib/stores/appState';
        import { createEventDispatcher, onDestroy, tick } from 'svelte';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	import type { ContextMenuItem } from '$lib/stores/contextMenu';
	import { m } from '$lib/paraglide/messages.js';
	import { tooltip } from '$lib/actions/tooltip';
	import CodeBlock from './CodeBlock.svelte';
	import InlineTokens from './InlineTokens.svelte';
	import InvitePreview from './InvitePreview.svelte';
	import YoutubeEmbed from './YoutubeEmbed.svelte';
	import { extractInvite } from './extractInvite';
        import { Download, ImageOff, Paperclip, Pencil, Play, Trash2, X } from 'lucide-svelte';
	import { colorIntToHex } from '$lib/utils/color';
        import { guildRoleCacheState, loadGuildRolesCached } from '$lib/utils/guildRoles';
        import { openUserContextMenu } from '$lib/utils/userContextMenu';
        import { memberProfilePanel } from '$lib/stores/memberProfilePanel';
	import {
		collectMemberRoleIds,
		extractAuthorRoleIds,
		toSnowflake
	} from './MessageItem.helpers';

	type MessageSegment =
		| { type: 'text'; content: string }
		| { type: 'code'; content: string; language?: string };

	type MessageEmbed =
		| { kind: 'invite'; code: string; url: string }
		| { kind: 'youtube'; videoId: string; url: string };

	type FormatStyles = {
		bold?: boolean;
		italic?: boolean;
		underline?: boolean;
		strike?: boolean;
	};

	export type InlineToken =
		| { type: 'text'; content: string; styles?: FormatStyles }
		| { type: 'link'; label: string; url: string; styles?: FormatStyles; embed?: MessageEmbed }
		| { type: 'code'; content: string };

	type Block =
		| { type: 'paragraph'; tokens: InlineToken[] }
		| { type: 'heading'; level: 1 | 2 | 3; tokens: InlineToken[] }
		| { type: 'quote'; lines: InlineToken[][] }
		| { type: 'list'; items: InlineToken[][] }
		| { type: 'break' };

	type RenderedSegment =
		| { type: 'code'; content: string; language?: string }
		| { type: 'blocks'; blocks: Block[] };

	function getRoleId(role?: DtoRole | null): string | null {
		const raw = role?.id as string | number | bigint | undefined;
		if (raw == null) return null;
		try {
			if (typeof raw === 'bigint') {
				return raw.toString();
			}
			return BigInt(raw).toString();
		} catch {
			return String(raw);
		}
	}

        async function loadMemberRoleIds(guildId: string, userId: string): Promise<Set<string>> {
                const res = await auth.api.guildRoles.guildGuildIdMemberUserIdRolesGet({
                        guildId: BigInt(guildId) as any,
                        userId: BigInt(userId) as any
		});
		const list = ((res as any)?.data ?? res ?? []) as DtoRole[];
		const ids = new Set<string>();
		for (const role of list) {
			const id = getRoleId(role);
			if (id) {
				ids.add(id);
			}
		}
		return ids;
	}

	function memberUserId(member: DtoMember | null | undefined): string | null {
		if (!member) return null;
		return (
			toSnowflake((member as any)?.user?.id) ??
			toSnowflake((member as any)?.user_id) ??
			toSnowflake((member as any)?.id)
		);
	}

        function normalizeCodeBlock(raw: string): string {
		if (!raw) return '';

		const normalized = raw.replace(/\r\n?/g, '\n');
		const lines = normalized.split('\n');

		while (lines.length && lines[0].trim() === '') {
			lines.shift();
		}

		while (lines.length && lines[lines.length - 1].trim() === '') {
			lines.pop();
		}

		let indent: number | undefined;
		for (const line of lines) {
			if (!line.trim()) continue;
			const match = line.match(/^[ \t]+/);
			if (!match) {
				indent = 0;
				break;
			}
			const depth = match[0].length;
			indent = indent === undefined ? depth : Math.min(indent, depth);
		}

		if (!lines.length) {
			return '';
		}

		if (!indent) {
			return lines.join('\n');
		}

		const pattern = new RegExp(`^[ \t]{0,${indent}}`);
		return lines.map((line) => line.replace(pattern, '')).join('\n');
	}

	function parseMessageContent(content: string | null | undefined): MessageSegment[] {
		if (!content) return [];
		const segments: MessageSegment[] = [];
		const pattern = /```([^\r\n`]*)?(?:\r?\n)?([\s\S]*?)```/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = pattern.exec(content)) !== null) {
			const [fullMatch, lang, body] = match;
			const startIndex = match.index;

			if (startIndex > lastIndex) {
				segments.push({ type: 'text', content: content.slice(lastIndex, startIndex) });
			}

			const language = lang?.trim() || undefined;
			const codeBody = normalizeCodeBlock(body ?? '');
			segments.push({ type: 'code', content: codeBody, language });
			lastIndex = startIndex + fullMatch.length;
		}

		if (lastIndex < content.length) {
			segments.push({ type: 'text', content: content.slice(lastIndex) });
		}

		if (segments.length === 0) {
			return [{ type: 'text', content }];
		}

		return segments;
	}

	const urlPattern =
		/((?:https?:\/\/|ftp:\/\/)[^\s<>()]+|www\.[^\s<>()]+|[\w.-]+\.[a-zA-Z]{2,}(?:\/[^\s<>()]+)*)/gi;

	function normalizeUrl(raw: string): string {
		if (!raw) return raw;
		if (/^[a-zA-Z][\w+.-]*:\/\//.test(raw)) {
			return raw;
		}
		return `https://${raw}`;
	}

	function extractYouTube(url: string): { videoId: string } | null {
		try {
			const parsed = new URL(url);
			const host = parsed.hostname.toLowerCase();
			const pathSegments = parsed.pathname.split('/').filter(Boolean);

			if (host === 'youtu.be') {
				const videoId = pathSegments[0];
				if (videoId) {
					return { videoId };
				}
			}

			if (host === 'www.youtube.com' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
				const videoId =
					(parsed.pathname === '/watch' ? parsed.searchParams.get('v') : undefined) ??
					(pathSegments[0]?.toLowerCase() === 'embed' ? pathSegments[1] : undefined) ??
					(pathSegments[0]?.toLowerCase() === 'shorts' ? pathSegments[1] : undefined) ??
					(pathSegments[0]?.toLowerCase() === 'live' ? pathSegments[1] : undefined);

				if (videoId) {
					return { videoId };
				}
			}
		} catch {
			return null;
		}

		return null;
	}

	function cloneStyles(styles: FormatStyles = {}): FormatStyles {
		return {
			bold: styles.bold ? true : undefined,
			italic: styles.italic ? true : undefined,
			underline: styles.underline ? true : undefined,
			strike: styles.strike ? true : undefined
		};
	}

	function stylesEqual(a: FormatStyles = {}, b: FormatStyles = {}): boolean {
		return (
			!!a.bold === !!b.bold &&
			!!a.italic === !!b.italic &&
			!!a.underline === !!b.underline &&
			!!a.strike === !!b.strike
		);
	}

	type FormattedChunk = { text: string; styles: FormatStyles };

	function mergeChunks(chunks: FormattedChunk[]): FormattedChunk[] {
		const merged: FormattedChunk[] = [];
		for (const chunk of chunks) {
			if (!chunk.text) continue;
			const last = merged[merged.length - 1];
			if (last && stylesEqual(last.styles, chunk.styles)) {
				last.text += chunk.text;
			} else {
				merged.push({ text: chunk.text, styles: cloneStyles(chunk.styles) });
			}
		}
		return merged;
	}

	function parseFormattingChunks(content: string, state: FormatStyles = {}): FormattedChunk[] {
		const result: FormattedChunk[] = [];
		let buffer = '';
		let i = 0;

		const pushBuffer = () => {
			if (!buffer) return;
			result.push({ text: buffer, styles: cloneStyles(state) });
			buffer = '';
		};

		outer: while (i < content.length) {
			const char = content[i];

			if (char === '_') {
				const closing = content.indexOf('_', i + 1);
				if (closing > i + 1) {
					pushBuffer();
					const inner = parseFormattingChunks(content.slice(i + 1, closing), {
						...state,
						underline: true
					});
					result.push(...inner);
					i = closing + 1;
					continue;
				}
			} else if (char === '~' && content[i + 1] === '~') {
				const closing = content.indexOf('~~', i + 2);
				if (closing > i + 2) {
					pushBuffer();
					const inner = parseFormattingChunks(content.slice(i + 2, closing), {
						...state,
						strike: true
					});
					result.push(...inner);
					i = closing + 2;
					continue;
				}
			} else if (char === '*') {
				let runLength = 1;
				while (i + runLength < content.length && content[i + runLength] === '*') {
					runLength++;
				}

				const attempts = runLength >= 3 ? [3, 2, 1] : runLength === 2 ? [2, 1] : [1];

				for (const len of attempts) {
					const closing = content.indexOf('*'.repeat(len), i + len);
					if (closing > i + len) {
						pushBuffer();
						const nextState: FormatStyles = { ...state };
						if (len === 3) {
							nextState.bold = true;
							nextState.italic = true;
						} else if (len === 2) {
							nextState.bold = true;
						} else {
							nextState.italic = true;
						}
						const inner = parseFormattingChunks(content.slice(i + len, closing), nextState);
						result.push(...inner);
						i = closing + len;
						continue outer;
					}
				}
			}

			buffer += char;
			i++;
		}

		pushBuffer();
		return mergeChunks(result);
	}

	function parsePlainText(content: string, tokens: InlineToken[]) {
		if (!content) return;

		const chunks = parseFormattingChunks(content);

		for (const chunk of chunks) {
			if (!chunk.text) continue;

			urlPattern.lastIndex = 0;
			let lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = urlPattern.exec(chunk.text)) !== null) {
				const startIndex = match.index;
				let endIndex = startIndex + match[0].length;

				while (endIndex > startIndex && /[)\]\}>,.;!?]/.test(chunk.text[endIndex - 1])) {
					endIndex--;
				}

				if (endIndex <= startIndex) {
					continue;
				}

				if (startIndex > lastIndex) {
					tokens.push({
						type: 'text',
						content: chunk.text.slice(lastIndex, startIndex),
						styles: chunk.styles
					});
				}

				const rawUrl = chunk.text.slice(startIndex, endIndex);
				const normalized = normalizeUrl(rawUrl);
				const invite = extractInvite(normalized);
				const youtube = extractYouTube(normalized);

				if (invite) {
					tokens.push({
						type: 'link',
						label: rawUrl,
						url: normalized,
						embed: { kind: 'invite', code: invite.code, url: normalized },
						styles: chunk.styles
					});
				} else if (youtube) {
					tokens.push({
						type: 'link',
						label: rawUrl,
						url: normalized,
						embed: { kind: 'youtube', videoId: youtube.videoId, url: normalized },
						styles: chunk.styles
					});
				} else {
					tokens.push({
						type: 'link',
						label: rawUrl,
						url: normalized,
						styles: chunk.styles
					});
				}

				lastIndex = endIndex;

				if (urlPattern.lastIndex > endIndex) {
					urlPattern.lastIndex = endIndex;
				}
			}

			if (lastIndex < chunk.text.length) {
				tokens.push({
					type: 'text',
					content: chunk.text.slice(lastIndex),
					styles: chunk.styles
				});
			}
		}
	}

        function parseInline(content: string): InlineToken[] {
                const tokens: InlineToken[] = [];
                if (!content) return tokens;

                let cursor = 0;
                let encounteredCode = false;

		while (cursor < content.length) {
			const startIndex = content.indexOf('`', cursor);

			if (startIndex === -1) {
				parsePlainText(content.slice(cursor), tokens);
				cursor = content.length;
				break;
			}

			const endIndex = content.indexOf('`', startIndex + 1);

			if (endIndex === -1) {
				parsePlainText(content.slice(cursor), tokens);
				cursor = content.length;
				break;
			}

			if (startIndex > cursor) {
				parsePlainText(content.slice(cursor, startIndex), tokens);
			}

			tokens.push({ type: 'code', content: content.slice(startIndex + 1, endIndex) });
			encounteredCode = true;
			cursor = endIndex + 1;
		}

		if (!encounteredCode && tokens.length === 0) {
			parsePlainText(content, tokens);
		} else if (cursor < content.length) {
			parsePlainText(content.slice(cursor), tokens);
                }

                return tokens;
        }

        type MessageAttachment = NonNullable<DtoMessage['attachments']>[number];

        type AttachmentKind = 'image' | 'video' | 'audio' | 'other';

        type AttachmentMeta = {
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

        type AttachmentRenderItem = {
                attachment: MessageAttachment;
                meta: AttachmentMeta;
                index: number;
        };

        type AttachmentRenderGroup =
                | { type: 'gallery'; items: AttachmentRenderItem[] }
                | { type: 'single'; item: AttachmentRenderItem };

        function formatContentType(value: unknown): string | null {
                if (typeof value !== 'string') return null;
                const trimmed = value.trim();
                return trimmed ? trimmed : null;
        }

        function attachmentUrl(attachment: MessageAttachment | undefined): string | null {
                const raw = (attachment as any)?.url;
                if (typeof raw !== 'string') return null;
                const trimmed = raw.trim();
                return trimmed ? trimmed : null;
        }

        function attachmentPreviewUrl(attachment: MessageAttachment | undefined): string | null {
                const raw = (attachment as any)?.preview_url;
                if (typeof raw !== 'string') return null;
                const trimmed = raw.trim();
                return trimmed ? trimmed : null;
        }

        function attachmentContentType(attachment: MessageAttachment | undefined): string | null {
                return formatContentType((attachment as any)?.content_type);
        }

        function attachmentFilename(attachment: MessageAttachment | undefined): string {
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

        function detectAttachmentKind(attachment: MessageAttachment | undefined): AttachmentKind {
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

        function formatAttachmentSize(value: unknown): string | null {
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

        function parseAttachmentDimension(value: unknown): number | null {
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

        function getAttachmentMeta(attachment: MessageAttachment | undefined): AttachmentMeta {
                const width = parseAttachmentDimension((attachment as any)?.width);
                const height = parseAttachmentDimension((attachment as any)?.height);
                const aspectRatio =
                        width != null && height != null ? `${width} / ${height}` : null;
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

        function groupAttachmentsForRender(
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

        type ImagePreviewState = {
                url: string;
                title: string;
                sizeLabel: string | null;
                contentType: string | null;
        };

        const IMAGE_ZOOM_MIN_DEFAULT = 0.25;
        const IMAGE_ZOOM_MAX = 6;
        const IMAGE_ZOOM_STEP = 0.25;

        const VISUAL_ATTACHMENT_MAX_DIMENSION = 350;
        const visualAttachmentWrapperStyle = `max-width: min(100%, ${VISUAL_ATTACHMENT_MAX_DIMENSION}px);`;
        const visualAttachmentMediaStyle = `max-width: 100%; max-height: ${VISUAL_ATTACHMENT_MAX_DIMENSION}px; width: auto; height: auto;`;
        const GIF_PLACEHOLDER_SRC =
                'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

        type GifPlaybackParams = {
                enabled: boolean;
                src: string | null;
                previewSrc: string | null;
        };

        function gifPlayback(node: HTMLImageElement, params: GifPlaybackParams) {
                let currentParams = params;
                let currentSrc = currentParams?.src ?? null;
                let enabled = Boolean(currentParams?.enabled && currentSrc);
                let previewSrc = currentParams?.previewSrc ?? null;
                let observer: IntersectionObserver | null = null;

                const cleanupObserver = () => {
                        observer?.disconnect();
                        observer = null;
                };

                const setPlaying = (shouldPlay: boolean) => {
                        if (!enabled) {
                                const target = previewSrc ?? GIF_PLACEHOLDER_SRC;
                                if (node.src !== target) {
                                        node.src = target;
                                }
                                return;
                        }

                        const target = shouldPlay && currentSrc ? currentSrc : previewSrc ?? GIF_PLACEHOLDER_SRC;
                        if (node.src !== target) {
                                node.src = target;
                        }
                };

                const handleIntersect = (entries: IntersectionObserverEntry[]) => {
                        for (const entry of entries) {
                                if (entry.target === node) {
                                        const shouldPlay = entry.isIntersecting && entry.intersectionRatio > 0;
                                        setPlaying(shouldPlay);
                                }
                        }
                };

                const initObserver = () => {
                        cleanupObserver();
                        currentSrc = currentParams?.src ?? null;
                        enabled = Boolean(currentParams?.enabled && currentSrc);
                        previewSrc = currentParams?.previewSrc ?? null;

                        if (!enabled) {
                                setPlaying(false);
                                return;
                        }

                        observer = new IntersectionObserver(handleIntersect, {
                                threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
                        });
                        observer.observe(node);
                        setPlaying(false);
                };

                initObserver();

                return {
                        update(nextParams: GifPlaybackParams) {
                                currentParams = nextParams;
                                initObserver();
                        },
                        destroy() {
                                cleanupObserver();
                                const target = previewSrc ?? (enabled && currentSrc ? currentSrc : GIF_PLACEHOLDER_SRC);
                                if (target) {
                                        node.src = target;
                                }
                        },
                };
        }

        function computeVisualAttachmentBounds(
                meta: Pick<AttachmentMeta, 'width' | 'height'>
        ): { width: number; height: number } {
                const { width, height } = meta;
                if (width != null && height != null) {
                        const scale = Math.min(
                                VISUAL_ATTACHMENT_MAX_DIMENSION / width,
                                VISUAL_ATTACHMENT_MAX_DIMENSION / height,
                                1
                        );
                        const scaledWidth = Math.max(1, Math.round(width * scale));
                        const scaledHeight = Math.max(1, Math.round(height * scale));
                        return { width: scaledWidth, height: scaledHeight };
                }

                return {
                        width: VISUAL_ATTACHMENT_MAX_DIMENSION,
                        height: VISUAL_ATTACHMENT_MAX_DIMENSION,
                };
        }

        function galleryGridTemplate(itemCount: number): string {
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

        function clamp(value: number, min: number, max: number): number {
                return Math.min(Math.max(value, min), max);
        }

        const me = auth.user;
        let { message, compact = false } = $props<{ message: DtoMessage; compact?: boolean }>();
	let isEditing = $state(false);
	let draft = $state(message.content ?? '');
	let saving = $state(false);
	let editTextarea = $state<HTMLTextAreaElement | null>(null);
	const dispatch = createEventDispatcher<{ deleted: void }>();
	const segments = $derived(parseMessageContent(message.content ?? ''));

	const PERMISSION_MANAGE_MESSAGES = 1 << 17;

        let canDeleteMessage = $state(false);
	let canEditMessage = $state(false);
	let primaryRoleColor = $state<string | null>(null);
        let roleColorRequest = 0;
        let resolvedAuthorMember = $state<DtoMember | null>(null);
        let imagePreview = $state<ImagePreviewState | null>(null);
        let imagePreviewZoom = $state(1);
        let imagePreviewFitZoom = $state(1);
        let imagePreviewOffsetX = $state(0);
        let imagePreviewOffsetY = $state(0);
        let imagePreviewViewport = $state<HTMLDivElement | null>(null);
        let imagePreviewDragging = $state(false);
        let imagePreviewNaturalWidth = 0;
        let imagePreviewNaturalHeight = 0;
        let imagePreviewPointerId: number | null = null;
        let imagePreviewLastPointerX = 0;
        let imagePreviewLastPointerY = 0;
        let imagePreviewDragDistance = 0;
        let imagePreviewDidPan = false;
        let detachPreviewResize: (() => void) | null = null;
        let suppressNextPointerUp = $state(false);
        let suppressContextMenuUntil = $state(0);

        function nowMs() {
                if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
                        return performance.now();
                }
                return Date.now();
        }

        function scheduleContextMenuSuppression(durationMs = 250) {
                suppressNextPointerUp = true;
                suppressContextMenuUntil = nowMs() + durationMs;
        }
        let activeVideoAttachments = $state<Record<string, boolean>>({});
        let videoPreviewPosters = $state<Record<string, string | null>>({});
        let failedPreviewKeys = $state<Record<string, true>>({});

        function markPreviewFailure(key: string) {
                if (failedPreviewKeys[key]) {
                        return;
                }

                failedPreviewKeys = { ...failedPreviewKeys, [key]: true };
        }
        const videoPosterTasks = new Map<string, () => void>();
        let componentDestroyed = false;

        function isSameOriginUrl(url: string): boolean {
                if (typeof window === 'undefined') {
                        return false;
                }

                try {
                        const parsed = new URL(url, window.location.href);
                        return parsed.origin === window.location.origin;
                } catch {
                        return false;
                }
        }

        async function capturePosterWithVideo(
                sourceUrl: string,
                signal: AbortSignal,
                options: { crossOrigin?: string | null; revoke?: (() => void) | null } = {}
        ): Promise<string | null> {
                if (signal.aborted) {
                        return null;
                }

                return new Promise<string | null>((resolve) => {
                        const video = document.createElement('video');
                        let settled = false;

                        const cleanup = () => {
                                video.removeEventListener('loadeddata', handleLoadedData);
                                video.removeEventListener('error', handleError);
                                video.removeEventListener('loadedmetadata', handleLoadedMetadata);
                                video.removeEventListener('seeked', handleSeeked);
                                signal.removeEventListener('abort', handleAbort);
                                try {
                                        video.pause();
                                } catch {
                                        // noop
                                }
                                video.src = '';
                                try {
                                        video.load();
                                } catch {
                                        // noop
                                }
                                options.revoke?.();
                        };

                        const finalize = (poster: string | null) => {
                                if (settled) {
                                        return;
                                }
                                settled = true;
                                cleanup();
                                resolve(poster);
                        };

                        const tryCaptureFrame = () => {
                                if (settled) {
                                        return;
                                }
                                try {
                                        const width = video.videoWidth;
                                        const height = video.videoHeight;
                                        if (!width || !height) {
                                                throw new Error('missing dimensions');
                                        }

                                        const maxDimension = 640;
                                        const scale = Math.min(1, maxDimension / Math.max(width, height));
                                        const targetWidth = Math.max(1, Math.round(width * scale));
                                        const targetHeight = Math.max(1, Math.round(height * scale));

                                        const canvas = document.createElement('canvas');
                                        canvas.width = targetWidth;
                                        canvas.height = targetHeight;
                                        const context = canvas.getContext('2d');
                                        if (!context) {
                                                throw new Error('no canvas context');
                                        }
                                        context.drawImage(video, 0, 0, targetWidth, targetHeight);
                                        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
                                        finalize(dataUrl);
                                } catch {
                                        finalize(null);
                                }
                        };

                        const handleAbort = () => finalize(null);

                        const handleLoadedData = () => tryCaptureFrame();

                        const handleSeeked = () => tryCaptureFrame();

                        const handleError = () => finalize(null);

                        const handleLoadedMetadata = () => {
                                try {
                                        const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
                                        const epsilon = 0.001;
                                        const safeDuration = hasDuration ? Math.max(video.duration, epsilon) : epsilon;
                                        const preferredTime = Math.min(Math.max(epsilon, safeDuration / 2), 1);
                                        const targetTime = hasDuration
                                                ? Math.min(Math.max(epsilon, Math.min(safeDuration - epsilon, preferredTime)), safeDuration)
                                                : epsilon;
                                        const haveCurrentData =
                                                typeof HTMLMediaElement !== 'undefined'
                                                        ? HTMLMediaElement.HAVE_CURRENT_DATA
                                                        : 2;
                                        if (
                                                video.readyState >= haveCurrentData &&
                                                Math.abs(video.currentTime - targetTime) < epsilon
                                        ) {
                                                tryCaptureFrame();
                                                return;
                                        }
                                        if (!Number.isNaN(targetTime) && video.currentTime !== targetTime) {
                                                video.currentTime = targetTime;
                                        }
                                } catch {
                                        // noop — if seeking fails we will rely on the default frame fetch.
                                }
                        };

                        signal.addEventListener('abort', handleAbort, { once: true });
                        video.addEventListener('loadeddata', handleLoadedData, { once: true });
                        video.addEventListener('seeked', handleSeeked, { once: true });
                        video.addEventListener('error', handleError, { once: true });
                        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

                        if (options.crossOrigin) {
                                video.crossOrigin = options.crossOrigin;
                        } else if (options.crossOrigin === null) {
                                video.removeAttribute('crossorigin');
                        }

                        video.preload = 'metadata';
                        video.muted = true;
                        video.playsInline = true;
                        if (signal.aborted) {
                                finalize(null);
                                return;
                        }
                        video.src = sourceUrl;
                        try {
                                video.load();
                        } catch {
                                // noop
                        }
                });
        }

        async function capturePosterFromFetch(
                url: string,
                signal: AbortSignal,
                sameOrigin: boolean
        ): Promise<string | null> {
                if (signal.aborted || typeof fetch !== 'function' || typeof URL === 'undefined') {
                        return null;
                }

                let response: Response;
                try {
                        response = await fetch(url, {
                                signal,
                                credentials: sameOrigin ? 'include' : 'omit',
                        });
                } catch {
                        return null;
                }

                if (!response.ok || signal.aborted) {
                        return null;
                }

                const contentType = response.headers.get('Content-Type') ?? 'video/mp4';

                try {
                        const reader = response.body?.getReader();
                        if (reader) {
                                const chunks: Uint8Array[] = [];
                                const limit = 1024 * 1024; // 1 MiB
                                let received = 0;
                                let done = false;

                                while (!done && received < limit) {
                                        const { value, done: chunkDone } = await reader.read();
                                        done = chunkDone;
                                        if (signal.aborted) {
                                                try {
                                                        await reader.cancel();
                                                } catch {
                                                        // noop
                                                }
                                                return null;
                                        }
                                        if (value && value.length) {
                                                chunks.push(value);
                                                received += value.length;
                                        }
                                }

                                if (!chunks.length) {
                                        return null;
                                }

                                const partialBlob = new Blob(chunks, { type: contentType });
                                if (signal.aborted) {
                                        return null;
                                }
                                const partialUrl = URL.createObjectURL(partialBlob);
                                const partialPoster = await capturePosterWithVideo(partialUrl, signal, {
                                        crossOrigin: null,
                                        revoke: () => URL.revokeObjectURL(partialUrl),
                                });
                                if (signal.aborted) {
                                        try {
                                                await reader.cancel();
                                        } catch {
                                                // noop
                                        }
                                        return null;
                                }
                                if (partialPoster !== null) {
                                        try {
                                                await reader.cancel();
                                        } catch {
                                                // noop
                                        }
                                        return partialPoster;
                                }
                                if (done) {
                                        return null;
                                }

                                while (!done) {
                                        const { value, done: chunkDone } = await reader.read();
                                        done = chunkDone;
                                        if (signal.aborted) {
                                                try {
                                                        await reader.cancel();
                                                } catch {
                                                        // noop
                                                }
                                                return null;
                                        }
                                        if (value && value.length) {
                                                chunks.push(value);
                                        }
                                }

                                try {
                                        await reader.cancel();
                                } catch {
                                        // noop
                                }

                                const blob = new Blob(chunks, { type: contentType });
                                if (signal.aborted) {
                                        return null;
                                }
                                const objectUrl = URL.createObjectURL(blob);
                                return capturePosterWithVideo(objectUrl, signal, {
                                        crossOrigin: null,
                                        revoke: () => URL.revokeObjectURL(objectUrl),
                                });
                        }
                } catch {
                        // noop — fall back to reading the full blob below.
                }

                if (signal.aborted) {
                        return null;
                }

                let blob: Blob;
                try {
                        blob = await response.blob();
                } catch {
                        return null;
                }

                if (signal.aborted) {
                        return null;
                }

                const objectUrl = URL.createObjectURL(blob);
                return capturePosterWithVideo(objectUrl, signal, {
                        crossOrigin: null,
                        revoke: () => URL.revokeObjectURL(objectUrl),
                });
        }

        async function generateVideoPoster(url: string, signal: AbortSignal): Promise<string | null> {
                const sameOrigin = isSameOriginUrl(url);
                const crossOrigin = sameOrigin ? null : 'anonymous';

                try {
                        const directPoster = await capturePosterWithVideo(url, signal, { crossOrigin });
                        if (signal.aborted) {
                                return null;
                        }
                        if (directPoster !== null) {
                                return directPoster;
                        }
                } catch {
                        // noop — fall back to fetch approach.
                }

                if (signal.aborted) {
                        return null;
                }

                try {
                        return await capturePosterFromFetch(url, signal, sameOrigin);
                } catch {
                        return null;
                }
        }

        function attachmentStableKey(
                attachment: MessageAttachment | undefined,
                index: number
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

                const messageId = (message as any)?.id;
                const messageKey =
                        typeof messageId === 'bigint'
                                ? messageId.toString()
                                : messageId != null
                                        ? String(messageId)
                                        : 'message';

                return `${messageKey}:${attachmentFilename(attachment)}:${index}`;
        }

        function isVideoAttachmentActive(key: string): boolean {
                return Boolean(activeVideoAttachments[key]);
        }

        function activateVideoAttachment(key: string): void {
                if (activeVideoAttachments[key]) return;
                activeVideoAttachments = { ...activeVideoAttachments, [key]: true };
        }

        function deactivateVideoAttachment(key: string): void {
                if (!activeVideoAttachments[key]) return;
                const next = { ...activeVideoAttachments };
                delete next[key];
                activeVideoAttachments = next;
        }

        function cleanupVideoPosterTasks() {
                for (const cancel of videoPosterTasks.values()) {
                        try {
                                cancel();
                        } catch {
                                // noop
                        }
                }
                videoPosterTasks.clear();
        }

        function stopVideoPosterTask(key: string) {
                const cancel = videoPosterTasks.get(key);
                if (!cancel) return;
                videoPosterTasks.delete(key);
                try {
                        cancel();
                } catch {
                        // noop
                }
        }

        function storeVideoPoster(key: string, value: string | null) {
                videoPreviewPosters = { ...videoPreviewPosters, [key]: value };
        }

        function requestVideoPoster(key: string, url: string): void {
                if (typeof window === 'undefined') {
                        return;
                }
                if (videoPreviewPosters[key] !== undefined || videoPosterTasks.has(key)) {
                        return;
                }

                const controller = new AbortController();
                const { signal } = controller;

                const run = async () => {
                        try {
                                const poster = await generateVideoPoster(url, signal);
                                if (signal.aborted || componentDestroyed) {
                                        return;
                                }
                                storeVideoPoster(key, poster);
                        } catch {
                                // noop
                        } finally {
                                videoPosterTasks.delete(key);
                        }
                };

                videoPosterTasks.set(key, () => {
                        controller.abort();
                });

                void run();
        }

        function resolveChannelPermissions(): number {
                const gid = $selectedGuildId ?? '';
                const cid = $selectedChannelId;
                if (!cid) return 0;
                const list = ($channelsByGuild[gid] ?? []) as DtoChannel[];
                const channel = list.find((c) => String((c as any)?.id) === cid);
		const perms = (channel as any)?.permissions;
		if (typeof perms === 'bigint') return Number(perms);
		if (typeof perms === 'string') {
			const parsed = Number(perms);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		if (typeof perms === 'number') return perms;
		return 0;
	}

	$effect(() => {
		const currentId = $me?.id != null ? String($me.id) : null;
		const authorRaw = (message as any)?.author?.id;
		const authorStr = authorRaw == null ? null : String(authorRaw);
		const perms = resolveChannelPermissions();
		const own = currentId != null && authorStr != null && currentId === authorStr;
		const manage = Boolean(perms & PERMISSION_MANAGE_MESSAGES);
		canEditMessage = own;
		canDeleteMessage = own || manage;
	});

        $effect(() => {
                const guildRoleCacheTick = $guildRoleCacheState;
                void guildRoleCacheTick;
                const guildId = $selectedGuildId;
                const initialRoleIds = extractAuthorRoleIds(message);
                const authorId = toSnowflake((message as any)?.author?.id);
                const guildMemberList = guildId ? ($membersByGuild[guildId] ?? undefined) : undefined;
                const memberIndex = new Map<string, DtoMember>();
                if (Array.isArray(guildMemberList)) {
                        for (const entry of guildMemberList) {
                                const id = memberUserId(entry);
                                if (id) {
                                        memberIndex.set(id, entry);
                                }
                        }
                }
                const directMember = ((message as any)?.member ?? null) as DtoMember | null;
                const cachedMember = directMember ?? (authorId ? memberIndex.get(authorId) ?? null : null);
                resolvedAuthorMember = cachedMember;
                const requestId = ++roleColorRequest;
                primaryRoleColor = null;

                if (!guildId) {
                        return;
		}

		const activeGuildId = guildId;

		void (async () => {
			try {
				let roleIds: string[] = (initialRoleIds ?? []).filter((id) => id != null && id !== '');
                                if (roleIds.length === 0 && cachedMember) {
                                        const cached = collectMemberRoleIds(cachedMember, activeGuildId);
                                        if (cached.length > 0) {
                                                roleIds = cached;
                                        }
                                }
                                if (roleIds.length === 0 && activeGuildId && authorId && cachedMember) {
                                        const fetched = await loadMemberRoleIds(activeGuildId, authorId);
                                        if (requestId !== roleColorRequest) {
                                                return;
                                        }
                                        roleIds = Array.from(fetched);
				}

				const orderedRoleIds: string[] = [];
				const seen = new Set<string>();
				const appendUnique = (raw: string | null | undefined) => {
					if (raw == null) return;
					const normalized = String(raw);
					if (!normalized || seen.has(normalized)) {
						return;
					}
					seen.add(normalized);
					orderedRoleIds.push(normalized);
				};
				for (const id of roleIds ?? []) {
					appendUnique(id);
				}
				appendUnique(activeGuildId);
				if (!orderedRoleIds.length) {
					return;
				}

				const definitions = await loadGuildRolesCached(activeGuildId);
				if (requestId !== roleColorRequest) {
					return;
				}

				let resolvedColor: string | null = null;
				for (const roleId of orderedRoleIds) {
					const matchedRole = definitions.find((role) => getRoleId(role) === roleId);
					if (!matchedRole) continue;
					const colorValue = (matchedRole as any)?.color;
					if (colorValue == null) continue;
					resolvedColor = colorIntToHex(colorValue as number | string | bigint | null);
					break;
				}

				if (requestId !== roleColorRequest) {
					return;
				}

				primaryRoleColor = resolvedColor;
			} catch {
				if (requestId === roleColorRequest) {
					primaryRoleColor = null;
				}
			}
                })();
        });

        $effect(() => {
                const attachments = (message.attachments ?? []) as MessageAttachment[];
                const keys = new Set(
                        attachments.map((attachment, index) =>
                                attachmentStableKey(attachment, index)
                        )
                );

                const entries = Object.entries(activeVideoAttachments);
                if (entries.length === 0) {
                        return;
                }

                let requiresUpdate = false;
                for (const [key] of entries) {
                        if (!keys.has(key)) {
                                requiresUpdate = true;
                                break;
                        }
                }

                if (!requiresUpdate) return;

                const next: Record<string, boolean> = {};
                for (const [key, value] of entries) {
                        if (keys.has(key)) {
                                next[key] = value;
                        }
                }

                activeVideoAttachments = next;
        });

        $effect(() => {
                if (typeof window === 'undefined') {
                        return;
                }

                const attachments = (message.attachments ?? []) as MessageAttachment[];
                const videoKeys = new Set<string>();

                attachments.forEach((attachment, index) => {
                        const meta = getAttachmentMeta(attachment);
                        if (meta.kind !== 'video' || !meta.url) {
                                return;
                        }
                        const key = attachmentStableKey(attachment, index);
                        videoKeys.add(key);
                        if (!meta.previewUrl) {
                                requestVideoPoster(key, meta.url);
                        }
                });

                for (const key of Array.from(videoPosterTasks.keys())) {
                        if (!videoKeys.has(key)) {
                                stopVideoPosterTask(key);
                        }
                }

                const storedKeys = Object.keys(videoPreviewPosters);
                if (!storedKeys.length) {
                        return;
                }

                const next = { ...videoPreviewPosters };
                let changed = false;
                for (const key of storedKeys) {
                        if (!videoKeys.has(key)) {
                                delete next[key];
                                changed = true;
                        }
                }

                if (changed) {
                        videoPreviewPosters = next;
                }
        });

        function autoSizeEditTextarea() {
                if (!editTextarea) return;
                editTextarea.style.height = 'auto';
                const nextHeight = editTextarea.scrollHeight;
                editTextarea.style.height = `${nextHeight}px`;
		const viewportHeight =
			typeof window !== 'undefined' ? window.innerHeight : Number.POSITIVE_INFINITY;
		editTextarea.style.overflowY = nextHeight > viewportHeight ? 'auto' : 'hidden';
	}

	async function startEditing() {
		draft = message.content ?? '';
		isEditing = true;
		await tick();
		autoSizeEditTextarea();
	}
	function parseBlocks(content: string): Block[] {
		const lines = content.split(/\r?\n/);
		const blocks: Block[] = [];
		let listBuffer: InlineToken[][] | null = null;
		let quoteBuffer: InlineToken[][] | null = null;

		const flushList = () => {
			if (listBuffer && listBuffer.length) {
				blocks.push({ type: 'list', items: listBuffer });
			}
			listBuffer = null;
		};

		const flushQuote = () => {
			if (quoteBuffer && quoteBuffer.length) {
				blocks.push({ type: 'quote', lines: quoteBuffer });
			}
			quoteBuffer = null;
		};

		for (const line of lines) {
			if (line.startsWith('### ')) {
				flushList();
				flushQuote();
				blocks.push({ type: 'heading', level: 3, tokens: parseInline(line.slice(4)) });
				continue;
			}

			if (line.startsWith('## ')) {
				flushList();
				flushQuote();
				blocks.push({ type: 'heading', level: 2, tokens: parseInline(line.slice(3)) });
				continue;
			}

			if (line.startsWith('# ')) {
				flushList();
				flushQuote();
				blocks.push({ type: 'heading', level: 1, tokens: parseInline(line.slice(2)) });
				continue;
			}

			if (line.startsWith('- ')) {
				flushQuote();
				if (!listBuffer) listBuffer = [];
				listBuffer.push(parseInline(line.slice(2)));
				continue;
			}

			if (line.startsWith('>')) {
				flushList();
				if (!quoteBuffer) quoteBuffer = [];
				const remainder = line.slice(1);
				const trimmed = remainder.startsWith(' ') ? remainder.slice(1) : remainder;
				quoteBuffer.push(parseInline(trimmed));
				continue;
			}

			if (line.trim() === '') {
				flushList();
				flushQuote();
				blocks.push({ type: 'break' });
				continue;
			}

			flushList();
			flushQuote();
			blocks.push({ type: 'paragraph', tokens: parseInline(line) });
		}

		flushList();
		flushQuote();

		return blocks;
	}

	function collectEmbedsFromTokens(tokens: InlineToken[]): MessageEmbed[] {
		return tokens.flatMap((token): MessageEmbed[] =>
			token.type === 'link' && token.embed ? [token.embed] : []
		);
	}

	function collectEmbedsFromBlock(block: Block): MessageEmbed[] {
		if (block.type === 'paragraph' || block.type === 'heading') {
			return collectEmbedsFromTokens(block.tokens);
		}

		if (block.type === 'quote') {
			return block.lines.flatMap((line) => collectEmbedsFromTokens(line));
		}

		if (block.type === 'list') {
			return block.items.flatMap((item) => collectEmbedsFromTokens(item));
		}

		return [];
	}

	const renderedSegments = $derived(
		segments.map((segment): RenderedSegment => {
			if (segment.type === 'code') {
				return segment;
			}
			return { type: 'blocks', blocks: parseBlocks(segment.content) };
		})
	);

	const messageEmbeds = $derived(
		renderedSegments.flatMap((segment): MessageEmbed[] => {
			if (segment.type !== 'blocks') return [];
			return segment.blocks.flatMap((block) => collectEmbedsFromBlock(block));
		})
	);

	const EPOCH_MS = Date.UTC(2008, 10, 10, 23, 0, 0, 0);

	function snowflakeToDate(id: any): Date | null {
		if (id == null) return null;
		try {
			const s = String(id).replace(/[^0-9]/g, '');
			if (!s) return null;
			const v = BigInt(s);
			const ms = Number(v >> 22n);
			return new Date(EPOCH_MS + ms);
		} catch {
			return null;
		}
	}

	function fmtMsgTime(m: DtoMessage) {
		const d = snowflakeToDate((m as any).id) || (m.updated_at ? new Date(m.updated_at) : null);
		if (!d || Number.isNaN(d.getTime())) return '';
		return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
	}

	function fmtMsgFull(m: DtoMessage) {
		const d = snowflakeToDate((m as any).id) || (m.updated_at ? new Date(m.updated_at) : null);
		if (!d || Number.isNaN(d.getTime())) return '';
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).format(d);
	}

        function fmtEditFull(m: DtoMessage) {
                if (!m.updated_at) return '';
                const d = new Date(m.updated_at);
                if (Number.isNaN(d.getTime())) return '';
                return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
                        second: '2-digit'
                }).format(d);
        }

        function messageDomId(value: any): string {
                if (value == null) return '';
                const str = String(value);
                const digits = str.replace(/[^0-9]/g, '');
                return digits || str;
        }

        async function saveEdit() {
                if (!$selectedChannelId || !message.id) return;
                saving = true;
                try {
                        await auth.api.message.messageChannelChannelIdMessageIdPatch({
				channelId: $selectedChannelId as any,
				messageId: message.id as any,
				messageUpdateMessageRequest: { content: draft }
			});
			message.content = draft;
			isEditing = false;
		} finally {
			saving = false;
		}
	}

	async function deleteMsg() {
		if (!canDeleteMessage || !$selectedChannelId || !message.id) return;
		await auth.api.message.messageChannelChannelIdMessageIdDelete({
			channelId: $selectedChannelId as any,
			messageId: message.id as any
		});
		dispatch('deleted');
	}

        function shouldSuppressContextMenuEvent(): boolean {
                if (suppressContextMenuUntil && nowMs() <= suppressContextMenuUntil) {
                        suppressContextMenuUntil = 0;
                        return true;
                }
                return false;
        }

        function openMessageMenu(e: MouseEvent) {
                if (shouldSuppressContextMenuEvent()) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                }
                e.preventDefault();
                e.stopPropagation();
                const mid = String((message as any)?.id ?? '');
                const items: ContextMenuItem[] = [];
                const deleteItem: ContextMenuItem | null = canDeleteMessage
                        ? {
                                      label: m.ctx_delete_message(),
                                      action: () => deleteMsg(),
                                      danger: true,
                                      disabled: !message?.id
                              }
                        : null;
                items.push({
                        label: m.ctx_copy_message_id(),
                        action: () => copyToClipboard(mid),
                        disabled: !mid
                });
                if (canEditMessage) {
                        items.push({
                                label: m.ctx_edit_message(),
                                action: () => {
                                        void startEditing();
                                },
                                disabled: !message?.id
                        });
                }
                if (deleteItem) {
                        items.push(deleteItem);
                }
                if (items.length === 0) return;
                contextMenu.openFromEvent(e, items);
        }

        function openUserMenu(event: MouseEvent) {
                openUserContextMenu(
                        event,
                        {
                                userId: (message as any)?.author?.id,
				user: (message as any)?.author,
				member: (message as any)?.member
			},
			{
				guildId: $selectedGuildId,
				channelId: $selectedChannelId
			}
		);
	}

        function handleRootPointerUp(event: PointerEvent) {
                if (suppressNextPointerUp || shouldSuppressContextMenuEvent()) {
                        suppressNextPointerUp = false;
                        event.preventDefault();
                        return;
                }
                if (event.button !== 0) return;
                if (event.defaultPrevented || isEditing) return;
		if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
		const target = event.target as HTMLElement | null;
		if (
			target &&
			target.closest(
				'button, a, textarea, input, [contenteditable], [role="button"], [data-user-menu="true"]'
			)
		) {
			return;
		}
                openMessageMenu(event as unknown as MouseEvent);
        }

        function openAuthorProfile(event: MouseEvent) {
                const member = resolvedAuthorMember ?? ((message as any)?.member ?? null);
                const user = (message as any)?.author ?? null;
                if (!member && !user) {
                        return;
                }
                const target = event.currentTarget as HTMLElement | null;
                let anchor: { x: number; y: number; width: number; height: number } | null = null;
                if (target && typeof window !== 'undefined') {
                        const rect = target.getBoundingClientRect();
                        anchor = {
                                x: rect.left,
                                y: rect.top,
                                width: rect.width,
                                height: rect.height
                        };
                }

                memberProfilePanel.open({
                        member: member ?? null,
                        user: user ?? null,
                        guildId: $selectedGuildId,
                        anchor
                });
        }

        function detachImagePreviewResize() {
                if (detachPreviewResize) {
                        detachPreviewResize();
                        detachPreviewResize = null;
                }
        }

        onDestroy(() => {
                componentDestroyed = true;
                detachImagePreviewResize();
                cleanupVideoPosterTasks();
        });

        function attachImagePreviewResize() {
                if (typeof window === 'undefined') {
                        return;
                }
                detachImagePreviewResize();
                const handler = () => {
                        updateImagePreviewFitZoom();
                };
                window.addEventListener('resize', handler);
                detachPreviewResize = () => {
                        window.removeEventListener('resize', handler);
                };
        }

        function computeImagePreviewFitZoom(): number {
                if (!imagePreviewViewport || !imagePreviewNaturalWidth || !imagePreviewNaturalHeight) {
                        return 1;
                }
                const viewport = imagePreviewViewport;
                const width = viewport.clientWidth;
                const height = viewport.clientHeight;
                if (!width || !height) {
                        return 1;
                }
                const scale = Math.min(width / imagePreviewNaturalWidth, height / imagePreviewNaturalHeight, 1);
                if (!Number.isFinite(scale) || scale <= 0) {
                        return 1;
                }
                return scale;
        }

        function resetImagePreviewTransform() {
                imagePreviewOffsetX = 0;
                imagePreviewOffsetY = 0;
        }

        function updateImagePreviewFitZoom(options?: { reset?: boolean }) {
                if (!imagePreview) {
                        return;
                }
                const fit = computeImagePreviewFitZoom();
                imagePreviewFitZoom = fit;
                const minZoom = Math.min(IMAGE_ZOOM_MIN_DEFAULT, fit, 1);
                if (options?.reset) {
                        imagePreviewZoom = fit;
                        resetImagePreviewTransform();
                        return;
                }
                if (imagePreviewZoom < minZoom) {
                        imagePreviewZoom = minZoom;
                }
        }

        function openImagePreview(meta: AttachmentMeta) {
                if (meta.kind !== 'image' || !meta.url) return;
                imagePreview = {
                        url: meta.url,
                        title: meta.name,
                        sizeLabel: meta.sizeLabel,
                        contentType: meta.contentType
                };
                imagePreviewZoom = 1;
                imagePreviewFitZoom = 1;
                imagePreviewOffsetX = 0;
                imagePreviewOffsetY = 0;
                imagePreviewNaturalWidth = 0;
                imagePreviewNaturalHeight = 0;
                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;
                attachImagePreviewResize();
        }

        function closeImagePreview() {
                imagePreview = null;
                imagePreviewZoom = 1;
                imagePreviewFitZoom = 1;
                imagePreviewOffsetX = 0;
                imagePreviewOffsetY = 0;
                imagePreviewNaturalWidth = 0;
                imagePreviewNaturalHeight = 0;
                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;
                detachImagePreviewResize();
        }

        function setImagePreviewZoom(
                value: number,
                options?: { anchor?: { x: number; y: number }; resetOffset?: boolean }
        ) {
                const fit = imagePreviewFitZoom;
                const minZoom = Math.min(IMAGE_ZOOM_MIN_DEFAULT, fit, 1);
                const clamped = clamp(value, minZoom, IMAGE_ZOOM_MAX);
                if (clamped === imagePreviewZoom) {
                        return;
                }

                if (options?.resetOffset || clamped <= fit + 0.001) {
                        resetImagePreviewTransform();
                } else if (options?.anchor && imagePreviewViewport) {
                        const rect = imagePreviewViewport.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        const centerY = rect.top + rect.height / 2;
                        const offsetX = options.anchor.x - centerX;
                        const offsetY = options.anchor.y - centerY;
                        const ratio = clamped / imagePreviewZoom;
                        imagePreviewOffsetX = imagePreviewOffsetX * ratio + offsetX * (1 - ratio);
                        imagePreviewOffsetY = imagePreviewOffsetY * ratio + offsetY * (1 - ratio);
                } else {
                        const ratio = clamped / imagePreviewZoom;
                        imagePreviewOffsetX = imagePreviewOffsetX * ratio;
                        imagePreviewOffsetY = imagePreviewOffsetY * ratio;
                }

                imagePreviewZoom = clamped;
        }

        function adjustImagePreviewZoom(delta: number, options?: { anchor?: { x: number; y: number } }) {
                setImagePreviewZoom(imagePreviewZoom + delta, options);
        }

        function handlePreviewWheel(event: WheelEvent) {
                if (!imagePreview) return;
                event.preventDefault();
                const direction = event.deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP;
                adjustImagePreviewZoom(direction, { anchor: { x: event.clientX, y: event.clientY } });
        }

        function handleWindowKeydown(event: KeyboardEvent) {
                if (!imagePreview) return;
                if (event.key === 'Escape') {
                        closeImagePreview();
                        return;
                }
                if (event.key === '+' || event.key === '=') {
                        adjustImagePreviewZoom(IMAGE_ZOOM_STEP);
                        return;
                }
                if (event.key === '-' || event.key === '_') {
                        adjustImagePreviewZoom(-IMAGE_ZOOM_STEP);
                        return;
                }
                if (event.key === '0') {
                        setImagePreviewZoom(imagePreviewFitZoom, { resetOffset: true });
                }
        }

        function handlePreviewOverlayClick(event: MouseEvent | PointerEvent) {
                if (event.target === event.currentTarget) {
                        scheduleContextMenuSuppression();
                        event.preventDefault();
                        event.stopPropagation();
                        closeImagePreview();
                        return;
                }

                event.stopPropagation();
        }

        function handleImagePreviewLoad(event: Event) {
                const img = event.currentTarget as HTMLImageElement | null;
                if (!img || !imagePreview) {
                        return;
                }
                imagePreviewNaturalWidth = img.naturalWidth || img.width;
                imagePreviewNaturalHeight = img.naturalHeight || img.height;
                updateImagePreviewFitZoom({ reset: true });
        }

        function toggleImagePreviewZoom(anchor?: { x: number; y: number }) {
                if (!imagePreview) {
                        return;
                }
                const fit = imagePreviewFitZoom;
                const epsilon = 0.001;
                if (imagePreviewZoom <= fit + epsilon) {
                        const target = Math.min(IMAGE_ZOOM_MAX, Math.max(1, fit * 2));
                        setImagePreviewZoom(target, anchor ? { anchor } : undefined);
                } else {
                        setImagePreviewZoom(fit, {
                                anchor,
                                resetOffset: true
                        });
                }
        }

        function handleImagePreviewPointerDown(event: PointerEvent) {
                if (!imagePreview || event.button !== 0) {
                        return;
                }
                event.preventDefault();
                const target = event.currentTarget as HTMLElement;
                imagePreviewPointerId = event.pointerId;
                imagePreviewLastPointerX = event.clientX;
                imagePreviewLastPointerY = event.clientY;
                imagePreviewDragDistance = 0;
                imagePreviewDragging = true;
                imagePreviewDidPan = false;
                target.setPointerCapture(event.pointerId);
        }

        function handleImagePreviewPointerMove(event: PointerEvent) {
                if (!imagePreviewDragging || imagePreviewPointerId !== event.pointerId) {
                        return;
                }
                event.preventDefault();
                const dx = event.clientX - imagePreviewLastPointerX;
                const dy = event.clientY - imagePreviewLastPointerY;
                imagePreviewLastPointerX = event.clientX;
                imagePreviewLastPointerY = event.clientY;
                const movement = Math.hypot(dx, dy);
                imagePreviewDragDistance += movement;
                const fit = imagePreviewFitZoom;
                if (imagePreviewZoom <= fit + 0.001) {
                        return;
                }
                imagePreviewOffsetX += dx;
                imagePreviewOffsetY += dy;
                if (imagePreviewDragDistance > 3) {
                        imagePreviewDidPan = true;
                }
        }

        function finishImagePreviewDrag(event: PointerEvent) {
                if (!imagePreviewDragging || imagePreviewPointerId !== event.pointerId) {
                        return;
                }
                const target = event.currentTarget as HTMLElement;
                target.releasePointerCapture(event.pointerId);
                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                const shouldToggleZoom = !imagePreviewDidPan && imagePreviewDragDistance < 4;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;
                if (shouldToggleZoom) {
                        toggleImagePreviewZoom({ x: event.clientX, y: event.clientY });
                }
        }

        function handleImagePreviewPointerUp(event: PointerEvent) {
                if (!imagePreview) {
                        return;
                }
                finishImagePreviewDrag(event);
        }

        function handleImagePreviewPointerCancel(event: PointerEvent) {
                if (!imagePreviewDragging || imagePreviewPointerId !== event.pointerId) {
                        return;
                }
                const target = event.currentTarget as HTMLElement;
                target.releasePointerCapture(event.pointerId);
                imagePreviewDragging = false;
                imagePreviewPointerId = null;
                imagePreviewDragDistance = 0;
                imagePreviewDidPan = false;
        }

        function handlePreviewViewportPointerDown(event: PointerEvent) {
                if (!imagePreview) {
                        return;
                }
                if (event.target === event.currentTarget) {
                        scheduleContextMenuSuppression();
                        closeImagePreview();
                }
        }

        $effect(() => {
                const viewport = imagePreviewViewport;
                if (viewport && imagePreview && imagePreviewNaturalWidth && imagePreviewNaturalHeight) {
                        updateImagePreviewFitZoom();
                }
        });

        const imagePreviewMinZoom = $derived(Math.min(IMAGE_ZOOM_MIN_DEFAULT, imagePreviewFitZoom, 1));
        const imagePreviewZoomPercent = $derived(Math.round(imagePreviewZoom * 100));
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<div
        role="listitem"
        class={`group/message flex gap-3 px-4 ${compact ? 'py-0.5' : 'py-2'} hover:bg-[var(--panel)]/30`}
        onpointerup={handleRootPointerUp}
        oncontextmenu={openMessageMenu}
        data-message-id={messageDomId((message as any)?.id)}
>
	{#if compact}
		<div
			class="w-10 shrink-0 pt-0.5 pr-1 text-right text-[10px] leading-tight text-[var(--muted)] opacity-0 transition-opacity group-hover/message:opacity-100"
			use:tooltip={() => fmtMsgFull(message)}
		>
			{fmtMsgTime(message)}
		</div>
	{:else}
                <button
                        type="button"
                        class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] text-sm"
                        data-user-menu="true"
                        data-tooltip-disabled
                        aria-label={message.author?.name ?? 'User'}
                        oncontextmenu={openUserMenu}
                        onclick={openAuthorProfile}
                >
                        {(message.author?.name ?? '?').slice(0, 2).toUpperCase()}
                </button>
        {/if}
	<div class="relative min-w-0 flex-1">
		{#if !isEditing && (canEditMessage || canDeleteMessage)}
			<div
				class="absolute top-1 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100"
			>
				{#if canEditMessage}
                                        <button
                                                class="rounded border border-[var(--stroke)] p-1 hover:bg-[var(--panel)]"
                                                aria-label="Edit"
						onclick={() => {
							void startEditing();
						}}
					>
						<Pencil class="h-3.5 w-3.5" stroke-width={2} />
					</button>
				{/if}
				{#if canDeleteMessage}
                                        <button
                                                class="rounded border border-[var(--stroke)] p-1 text-red-400 hover:bg-[var(--panel)]"
                                                aria-label="Delete"
						onclick={deleteMsg}
					>
						<Trash2 class="h-3.5 w-3.5" stroke-width={2} />
					</button>
				{/if}
			</div>
		{/if}
		{#if !compact}
			<div class="flex items-baseline gap-2 pr-20">
                                <button
                                        type="button"
                                        class="truncate font-semibold text-[var(--muted)] transition hover:underline focus-visible:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                        style:color={primaryRoleColor ?? null}
                                        data-user-menu="true"
                                        data-tooltip-disabled
                                        oncontextmenu={openUserMenu}
                                        onclick={openAuthorProfile}
                                >
                                        {message.author?.name ?? 'User'}
                                </button>
                                <div class="text-xs text-[var(--muted)]" use:tooltip={() => fmtMsgFull(message)}>
                                        {fmtMsgTime(message)}
                                </div>
			</div>
		{/if}
		{#if isEditing}
			<div class="mt-1">
				<textarea
					class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					bind:this={editTextarea}
					bind:value={draft}
					style:overflow-y={'hidden'}
					oninput={autoSizeEditTextarea}
				></textarea>
				<div class="mt-1 flex gap-2 text-sm">
					<button
						class="rounded-md bg-[var(--brand)] px-2 py-1 text-[var(--bg)]"
						disabled={saving}
						onclick={saveEdit}>{saving ? 'Saving…' : 'Save'}</button
					>
					<button
						class="rounded-md border border-[var(--stroke)] px-2 py-1"
						onclick={() => (isEditing = false)}>Cancel</button
					>
				</div>
			</div>
		{:else}
			<div class={compact ? 'mt-0 pr-16 text-sm leading-tight' : 'mt-0.5 pr-16'}>
				{#if renderedSegments.length === 0}
					<span class="break-words whitespace-pre-wrap">{message.content}</span>
				{:else}
					{#each renderedSegments as segment, index (index)}
						{#if segment.type === 'code'}
							<div class="my-2 whitespace-normal first:mt-0 last:mb-0">
								<CodeBlock code={segment.content} language={segment.language} />
							</div>
						{:else}
							{#each segment.blocks as block, blockIndex (`${index}-${blockIndex}`)}
								{#if block.type === 'heading'}
									{#if block.level === 1}
										<h1 class="m-0 text-lg leading-tight font-semibold">
											<InlineTokens tokens={block.tokens} />
										</h1>
									{:else if block.level === 2}
										<h2 class="m-0 text-base leading-tight font-semibold">
											<InlineTokens tokens={block.tokens} />
										</h2>
									{:else}
										<h3 class="m-0 text-sm leading-tight font-semibold">
											<InlineTokens tokens={block.tokens} />
										</h3>
									{/if}
								{:else if block.type === 'paragraph'}
									<p class="m-0 break-words whitespace-pre-wrap">
										{#if block.tokens.length === 0}
											<br />
										{:else}
											<InlineTokens tokens={block.tokens} />
										{/if}
									</p>
								{:else if block.type === 'quote'}
									<blockquote
										class="m-0 border-l-2 border-[var(--stroke)] pl-3 text-[var(--muted)]"
									>
										{#each block.lines as line, lineIndex (`${index}-${blockIndex}-q-${lineIndex}`)}
											<p class="m-0 break-words whitespace-pre-wrap">
												{#if line.length === 0}
													<br />
												{:else}
													<InlineTokens tokens={line} />
												{/if}
											</p>
										{/each}
									</blockquote>
								{:else if block.type === 'list'}
									<ul class="ml-4 list-disc space-y-1">
										{#each block.items as item, itemIndex (`${index}-${blockIndex}-li-${itemIndex}`)}
											<li class="break-words whitespace-pre-wrap">
												{#if item.length === 0}
													<br />
												{:else}
													<InlineTokens tokens={item} />
												{/if}
											</li>
										{/each}
									</ul>
								{:else if block.type === 'break'}
									<br />
								{/if}
							{/each}
						{/if}
					{/each}
				{/if}
				{#if message.updated_at}
                                        <span
                                                class="ml-1 align-baseline text-xs text-[var(--muted)] italic"
                                                use:tooltip={() => fmtEditFull(message)}
                                        >
						edited
					</span>
				{/if}
				{#if messageEmbeds.length}
					<div class="mt-2 flex flex-col gap-2">
						{#each messageEmbeds as embed, embedIndex (embedIndex)}
							{#if embed.kind === 'invite'}
								<div class="max-w-sm">
									<InvitePreview code={embed.code} url={embed.url} />
								</div>
							{:else if embed.kind === 'youtube'}
								<YoutubeEmbed videoId={embed.videoId} url={embed.url} />
							{/if}
						{/each}
					</div>
				{/if}
                                {#if message.attachments?.length}
                                        {@const attachmentGroups = groupAttachmentsForRender(
                                                (message.attachments ?? []) as MessageAttachment[]
                                        )}
                                        <div class={compact ? 'mt-1 flex flex-col gap-3' : 'mt-1.5 flex flex-col gap-3'}>
                                                {#each attachmentGroups as group, groupIndex (
                                                        group.type === 'gallery'
                                                                ? group.items
                                                                                .map((item) =>
                                                                                        attachmentStableKey(
                                                                                                item.attachment,
                                                                                                item.index
                                                                                        )
                                                                                )
                                                                                .join('|')
                                                                : attachmentStableKey(
                                                                                group.item.attachment,
                                                                                group.item.index
                                                                        )
                                                )}
                                                        {#if group.type === 'gallery'}
                                                                <div
                                                                        class="grid max-w-[350px] gap-2"
                                                                        style={galleryGridTemplate(group.items.length)}
                                                                >
                                                                        {#each group.items as item, tileIndex (
                                                                                attachmentStableKey(item.attachment, item.index)
                                                                        )}
                                                                                {@const tileKey = attachmentStableKey(item.attachment, item.index)}
                                                                                {@const galleryDisplaySrc =
                                                                                        item.meta.isGif
                                                                                                ? item.meta.previewUrl ?? GIF_PLACEHOLDER_SRC
                                                                                                : item.meta.previewUrl ?? item.meta.url}
                                                                                {@const galleryPreviewFailed = Boolean(failedPreviewKeys[tileKey])}
                                                                                <div class="group relative aspect-square overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]">
                                                                                        <button
                                                                                                type="button"
                                                                                                class="flex h-full w-full cursor-zoom-in items-center justify-center bg-transparent p-0 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                                                                                                onclick={() => openImagePreview(item.meta)}
                                                                                                aria-label={`Open preview for ${item.meta.name}`}
                                                                                        >
                                                                                                {#if galleryDisplaySrc && !galleryPreviewFailed}
                                                                                                        <img
                                                                                                                src={galleryDisplaySrc}
                                                                                                                alt={item.meta.name}
                                                                                                                class="block max-h-full max-w-full select-none object-contain transition group-hover:brightness-110"
                                                                                                                loading="lazy"
                                                                                                                onerror={() => markPreviewFailure(tileKey)}
                                                                                                                use:gifPlayback={{
                                                                                                                        enabled: item.meta.isGif,
                                                                                                                        src: item.meta.url,
                                                                                                                        previewSrc: item.meta.previewUrl,
                                                                                                                }}
                                                                                                        />
                                                                                                {:else}
                                                                                                        <div class="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[var(--muted)]">
                                                                                                                <ImageOff class="h-6 w-6" stroke-width={2} aria-hidden="true" />
                                                                                                                <span class="font-medium">Preview unavailable</span>
                                                                                                        </div>
                                                                                                {/if}
                                                                                        </button>
                                                                                        {#if item.meta.url}
                                                                                                <a
                                                                                                        class="pointer-events-none absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 shadow transition group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/50"
                                                                                                        href={item.meta.url}
                                                                                                        download={item.meta.name}
                                                                                                        rel="noopener noreferrer"
                                                                                                        onclick={(event) => event.stopPropagation()}
                                                                                                        aria-label={`Download ${item.meta.name}`}
                                                                                                >
                                                                                                        <Download class="h-4 w-4" stroke-width={2} />
                                                                                                </a>
                                                                                        {/if}
                                                                                </div>
                                                                        {/each}
                                                                </div>
                                                        {:else}
                                                                {@const { attachment, meta, index } = group.item}
                                                                {#if meta.kind === 'image' && (meta.previewUrl || meta.url)}
                                                                        {@const previewKey = attachmentStableKey(attachment, index)}
                                                                        {@const displaySrc =
                                                                                meta.isGif
                                                                                        ? meta.previewUrl ?? GIF_PLACEHOLDER_SRC
                                                                                        : meta.previewUrl ?? meta.url}
                                                                        {@const previewFailed = Boolean(failedPreviewKeys[previewKey])}
                                                                        {@const imageBounds = computeVisualAttachmentBounds(meta)}
                                                                        <div
                                                                                class="group relative inline-flex max-w-full items-center justify-center overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                                                                style={visualAttachmentWrapperStyle}
                                                                                style:width={`${imageBounds.width}px`}
                                                                                style:height={`${imageBounds.height}px`}
                                                                        >
                                                                                <button
                                                                                        type="button"
                                                                                        class="flex h-full w-full cursor-zoom-in items-center justify-center bg-transparent p-0 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                                                                                        onclick={() => openImagePreview(meta)}
                                                                                        aria-label={`Open preview for ${meta.name}`}
                                                                                >
                                                                                        {#if displaySrc && !previewFailed}
                                                                                                <img
                                                                                                        src={displaySrc}
                                                                                                        alt={meta.name}
                                                                                                        class="block max-h-full max-w-full select-none object-contain transition group-hover:brightness-110"
                                                                                                        loading="lazy"
                                                                                                        style={visualAttachmentMediaStyle}
                                                                                                        onerror={() => markPreviewFailure(previewKey)}
                                                                                                        use:gifPlayback={{
                                                                                                                enabled: meta.isGif,
                                                                                                                src: meta.url,
                                                                                                                previewSrc: meta.previewUrl,
                                                                                                        }}
                                                                                                />
                                                                                        {:else}
                                                                                                <div
                                                                                                        class="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[var(--muted)]"
                                                                                                        style={visualAttachmentMediaStyle}
                                                                                                >
                                                                                                        <ImageOff class="h-7 w-7" stroke-width={2} aria-hidden="true" />
                                                                                                        <span class="font-medium">Preview unavailable</span>
                                                                                                </div>
                                                                                        {/if}
                                                                                </button>
                                                                                {#if meta.url}
                                                                                        <a
                                                                                                class="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 shadow transition group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/50"
                                                                                                href={meta.url}
                                                                                                download={meta.name}
                                                                                                rel="noopener noreferrer"
                                                                                                onclick={(event) => event.stopPropagation()}
                                                                                                aria-label={`Download ${meta.name}`}
                                                                                        >
                                                                                                <Download class="h-4 w-4" stroke-width={2} />
                                                                                        </a>
                                                                                {/if}
                                                                        </div>
                                                                {:else if meta.kind === 'video' && meta.url}
                                                                        {@const attachmentKey = attachmentStableKey(attachment, index)}
                                                                        {@const previewPoster = meta.previewUrl ?? videoPreviewPosters[attachmentKey] ?? null}
                                                                        {@const videoHasExplicitDimensions = meta.aspectRatio != null}
                                                                        {@const previewAspectRatio =
                                                                                        meta.aspectRatio ?? `${VISUAL_ATTACHMENT_MAX_DIMENSION} / ${VISUAL_ATTACHMENT_MAX_DIMENSION}`}
                                                                        {@const videoBounds = computeVisualAttachmentBounds(meta)}
                                                                        {#if isVideoAttachmentActive(attachmentKey)}
                                                                                <div
                                                                                        class="group relative inline-flex max-w-full overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                                                                        style={visualAttachmentWrapperStyle}
                                                                                        style:width={`${videoBounds.width}px`}
                                                                                        style:height={`${videoBounds.height}px`}
                                                                                >
                                                                                        <div
                                                                                                class="relative h-full w-full bg-black"
                                                                                                style={visualAttachmentMediaStyle}
                                                                                                style:aspect-ratio={previewAspectRatio}
                                                                                        >
                                                                                                <!-- svelte-ignore a11y_media_has_caption -->
                                                                                                <video
                                                                                                        class="bg-black"
                                                                                                        src={meta.url}
                                                                                                        controls
                                                                                                        preload="metadata"
                                                                                                        playsinline
                                                                                                        style={`${visualAttachmentMediaStyle} display: block;${videoHasExplicitDimensions ? '' : ' width: 100%; height: 100%;'}`}
                                                                                                ></video>
                                                                                                <div class="absolute right-2 top-2 flex gap-2">
                                                                                                        {#if meta.url}
                                                                                                                <a
                                                                                                                        class="pointer-events-none grid h-8 w-8 place-items-center rounded-full border border-white/30 bg-black/60 text-white opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/45"
                                                                                                                        href={meta.url}
                                                                                                                        download={meta.name}
                                                                                                                        rel="noopener noreferrer"
                                                                                                                        onclick={(event) => event.stopPropagation()}
                                                                                                                        aria-label={`Download ${meta.name}`}
                                                                                                                >
                                                                                                                        <Download class="h-4 w-4" stroke-width={2} />
                                                                                                                </a>
                                                                                                        {/if}
                                                                                                        <button
                                                                                                                type="button"
                                                                                                                class="grid h-8 w-8 place-items-center rounded-full border border-white/40 bg-black/60 text-white transition hover:bg-black/40"
                                                                                                                onclick={() => deactivateVideoAttachment(attachmentKey)}
                                                                                                                aria-label="Close video preview"
                                                                                                        >
                                                                                                                <X class="h-4 w-4" stroke-width={2} />
                                                                                                        </button>
                                                                                                </div>
                                                                                        </div>
                                                                                </div>
                                                                        {:else}
                                                                                <div
                                                                                        class="group relative inline-flex max-w-full overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                                                                        style={visualAttachmentWrapperStyle}
                                                                                        style:width={`${videoBounds.width}px`}
                                                                                        style:height={`${videoBounds.height}px`}
                                                                                >
                                                                                        <button
                                                                                                type="button"
                                                                                                class="flex w-full cursor-pointer flex-col bg-transparent p-0 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                                                                                                onclick={() => activateVideoAttachment(attachmentKey)}
                                                                                                aria-label={`Play video ${meta.name}`}
                                                                                        >
                                                                                                <div
                                                                                                        class="relative h-full w-full overflow-hidden bg-black"
                                                                                                        style:aspect-ratio={previewAspectRatio}
                                                                                                        style={visualAttachmentMediaStyle}
                                                                                                >
                                                                                                        {#if previewPoster}
                                                                                                                <img
                                                                                                                        src={previewPoster}
                                                                                                                        alt={`Preview frame for ${meta.name}`}
                                                                                                                        class="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                                                                                                                        loading="lazy"
                                                                                                                />
                                                                                                                <div class="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/40"></div>
                                                                                                        {:else}
                                                                                                                <div class="absolute inset-0 bg-black"></div>
                                                                                                        {/if}
                                                                                                        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 text-white transition group-hover:bg-black/40">
                                                                                                                <span class="rounded-full border border-white/60 bg-black/40 p-3">
                                                                                                                        <Play class="h-6 w-6" stroke-width={2} />
                                                                                                                </span>
                                                                                                                <span class="text-sm font-medium">Play video</span>
                                                                                                        </div>
                                                                                                </div>
                                                                                        </button>
                                                                                        {#if meta.url}
                                                                                                <a
                                                                                                        class="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 shadow transition group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/50"
                                                                                                        href={meta.url}
                                                                                                        download={meta.name}
                                                                                                        rel="noopener noreferrer"
                                                                                                        onclick={(event) => event.stopPropagation()}
                                                                                                        aria-label={`Download ${meta.name}`}
                                                                                                >
                                                                                                        <Download class="h-4 w-4" stroke-width={2} />
                                                                                                </a>
                                                                                        {/if}
                                                                                </div>
                                                                        {/if}
                                                                {:else if meta.kind === 'audio' && meta.url}
                                                                        <div class="flex min-w-[16rem] max-w-sm flex-col gap-2 rounded border border-[var(--stroke)] bg-[var(--panel)] p-3 text-xs text-[var(--fg)]">
                                                                                <div class="truncate font-medium" title={meta.name}>
                                                                                        {meta.name}
                                                                                </div>
                                                                                <audio class="w-full" controls preload="metadata" src={meta.url}></audio>
                                                                                {#if meta.sizeLabel || meta.contentType}
                                                                                        <div class="flex items-center justify-between text-[var(--muted)]">
                                                                                                {#if meta.sizeLabel}
                                                                                                        <span>{meta.sizeLabel}</span>
                                                                                                {/if}
                                                                                                {#if meta.contentType}
                                                                                                        <span>{meta.contentType}</span>
                                                                                                {/if}
                                                                                        </div>
                                                                                {/if}
                                                                                <div class="text-right">
                                                                                        <a
                                                                                                class="text-[var(--brand)] hover:underline"
                                                                                                href={meta.url}
                                                                                                rel="noopener noreferrer"
                                                                                                target="_blank"
                                                                                        >
                                                                                                Open original
                                                                                        </a>
                                                                                </div>
                                                                        </div>
                                                                {:else}
                                                                        <a
                                                                                class="flex max-w-[18rem] items-center gap-2 rounded border border-[var(--stroke)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--fg)]"
                                                                                href={meta.url ?? undefined}
                                                                                rel={meta.url ? 'noopener noreferrer' : undefined}
                                                                                target={meta.url ? '_blank' : undefined}
                                                                        >
                                                                                <Paperclip class="h-3.5 w-3.5 text-[var(--muted)]" stroke-width={2} />
                                                                                <span class="truncate" title={meta.name}>
                                                                                        {meta.name}
                                                                                </span>
                                                                                {#if meta.sizeLabel}
                                                                                        <span class="ml-auto whitespace-nowrap text-[var(--muted)]">
                                                                                                {meta.sizeLabel}
                                                                                        </span>
                                                                                {/if}
                                                                        </a>
                                                                {/if}
                                                        {/if}
                                                {/each}
                                        </div>
                                {/if}
			</div>
		{/if}
        </div>
</div>

{#if imagePreview}
        <div
                class="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm"
                onpointerdown={handlePreviewOverlayClick}
        >
                <div class="border-b border-white/10 px-6 py-4 text-white">
                        <div class="flex items-start justify-between gap-4">
                                <div class="min-w-0">
                                        <div class="truncate text-base font-semibold">{imagePreview.title}</div>
                                        <div class="mt-1 flex flex-wrap gap-3 text-xs text-white/70">
                                                {#if imagePreview.sizeLabel}
                                                        <span>{imagePreview.sizeLabel}</span>
                                                {/if}
                                                {#if imagePreview.contentType}
                                                        <span>{imagePreview.contentType}</span>
                                                {/if}
                                        </div>
                                </div>
                                <div class="flex items-center gap-2 text-sm">
                                        <a
                                                class="rounded border border-white/30 px-3 py-1 text-white/90 transition hover:bg-white/10"
                                                href={imagePreview.url}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                        >
                                                Open original
                                        </a>
                                        <button
                                                class="rounded border border-white/30 px-3 py-1 text-white/90 transition hover:bg-white/10"
                                                type="button"
                                                onclick={closeImagePreview}
                                        >
                                                Close
                                        </button>
                                </div>
                        </div>
                        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/80">
                                <button
                                        class="rounded border border-white/30 px-2 py-1 transition hover:bg-white/10"
                                        type="button"
                                        onclick={() => adjustImagePreviewZoom(-IMAGE_ZOOM_STEP)}
                                >
                                        −
                                </button>
                                <input
                                        type="range"
                                        min={imagePreviewMinZoom}
                                        max={IMAGE_ZOOM_MAX}
                                        step={IMAGE_ZOOM_STEP}
                                        value={imagePreviewZoom}
                                        oninput={(event) =>
                                                setImagePreviewZoom(
                                                        Number((event.currentTarget as HTMLInputElement).value)
                                                )
                                        }
                                        class="h-1 w-32 cursor-pointer accent-[var(--brand)]"
                                />
                                <button
                                        class="rounded border border-white/30 px-2 py-1 transition hover:bg-white/10"
                                        type="button"
                                        onclick={() => adjustImagePreviewZoom(IMAGE_ZOOM_STEP)}
                                >
                                        +
                                </button>
                                <span class="w-12 text-center text-white/90">{imagePreviewZoomPercent}%</span>
                                <button
                                        class="rounded border border-white/30 px-3 py-1 text-white/90 transition hover:bg-white/10"
                                        type="button"
                                        onclick={() =>
                                                setImagePreviewZoom(imagePreviewFitZoom, { resetOffset: true })
                                        }
                                >
                                        Reset
                                </button>
                        </div>
                </div>
                <div
                        class="flex-1 overflow-hidden"
                        bind:this={imagePreviewViewport}
                        onwheel={handlePreviewWheel}
                >
                        <div
                                class="flex h-full w-full items-center justify-center p-6"
                                onpointerdown={handlePreviewViewportPointerDown}
                        >
                                <img
                                        src={imagePreview.url}
                                        alt={imagePreview.title}
                                        class={`max-h-none max-w-none select-none shadow-2xl transition-transform duration-100 ${
                                                imagePreviewDragging ? 'cursor-grabbing' : 'cursor-grab'
                                        }`}
                                        style={`transform: translate(${imagePreviewOffsetX}px, ${imagePreviewOffsetY}px) scale(${imagePreviewZoom}); transform-origin: center center;`}
                                        draggable="false"
                                        onload={handleImagePreviewLoad}
                                        onpointerdown={handleImagePreviewPointerDown}
                                        onpointermove={handleImagePreviewPointerMove}
                                        onpointerup={handleImagePreviewPointerUp}
                                        onpointercancel={handleImagePreviewPointerCancel}
                                />
                        </div>
                </div>
        </div>
{/if}
