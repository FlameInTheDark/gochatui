<script lang="ts">
	import type { DtoChannel, DtoMember, DtoMessage, DtoRole } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import {
		channelsByGuild,
		membersByGuild,
		selectedChannelId,
		selectedGuildId
	} from '$lib/stores/appState';
	import { createEventDispatcher, tick } from 'svelte';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	import type { ContextMenuItem } from '$lib/stores/contextMenu';
	import { m } from '$lib/paraglide/messages.js';
	import CodeBlock from './CodeBlock.svelte';
	import InlineTokens from './InlineTokens.svelte';
	import InvitePreview from './InvitePreview.svelte';
	import YoutubeEmbed from './YoutubeEmbed.svelte';
	import { extractInvite } from './extractInvite';
	import { Pencil, Trash2 } from 'lucide-svelte';
	import { colorIntToHex } from '$lib/utils/color';
	import { loadGuildRolesCached } from '$lib/utils/guildRoles';
	import { openUserContextMenu } from '$lib/utils/userContextMenu';

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

	function toSnowflake(value: unknown): string | null {
		if (value == null) return null;
		if (typeof value === 'string') return value;
		if (typeof value === 'bigint') return value.toString();
		if (typeof value === 'number') {
			try {
				return BigInt(value).toString();
			} catch {
				return String(value);
			}
		}
		return null;
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

        function collectMemberRoleIds(
                member: DtoMember | null | undefined,
                guildId: string | null
        ): string[] {
                const ids = new Set<string>();
                const roles = (member as any)?.roles;
                const list = Array.isArray(roles) ? roles : [];

                for (const entry of list) {
                        const id =
                                entry && typeof entry === 'object'
                                        ? toSnowflake(
                                                  (entry as any)?.id ??
                                                          (entry as any)?.role_id ??
                                                          (entry as any)?.roleId ??
                                                          entry
                                          )
                                        : toSnowflake(entry);
                        if (id) {
                                ids.add(id);
                        }
                }

                if (guildId) {
                        ids.add(guildId);
                }

                return Array.from(ids);
        }

	function extractAuthorRoleIds(msg: DtoMessage | null | undefined): string[] {
		if (!msg) return [];
		const anyMsg = msg as any;
		const candidates = [
			anyMsg?.member?.roles,
			anyMsg?.member_roles,
			anyMsg?.member?.role_ids,
			anyMsg?.member?.roleIds,
			anyMsg?.memberRoles
		];

		for (const candidate of candidates) {
			if (!candidate) continue;

			const list = Array.isArray(candidate)
				? candidate
				: typeof candidate[Symbol.iterator] === 'function'
					? Array.from(candidate as Iterable<unknown>)
					: [];

			if (!list.length) continue;

			const normalized: string[] = [];
			for (const value of list) {
				const id = toSnowflake(value);
				if (id) {
					normalized.push(id);
				}
			}

			if (normalized.length) {
				return normalized;
			}
		}

		return [];
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
                const cachedMember = authorId ? memberIndex.get(authorId) ?? null : null;
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

        function openMessageMenu(e: MouseEvent) {
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
</script>

<div
	role="listitem"
	class={`group/message flex gap-3 px-4 ${compact ? 'py-0.5' : 'py-2'} hover:bg-[var(--panel)]/30`}
	onpointerup={handleRootPointerUp}
	oncontextmenu={openMessageMenu}
>
	{#if compact}
		<div
			class="w-10 shrink-0 pt-0.5 pr-1 text-right text-[10px] leading-tight text-[var(--muted)] opacity-0 transition-opacity group-hover/message:opacity-100"
			title={fmtMsgFull(message)}
		>
			{fmtMsgTime(message)}
		</div>
	{:else}
		<button
			type="button"
			class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] text-sm"
			data-user-menu="true"
			aria-label={message.author?.name ?? 'User'}
			oncontextmenu={openUserMenu}
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
						title="Edit"
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
						title="Delete"
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
				<div
					role="contentinfo"
					class="truncate font-semibold text-[var(--muted)]"
					style:color={primaryRoleColor ?? null}
					data-user-menu="true"
					oncontextmenu={openUserMenu}
				>
					{message.author?.name ?? 'User'}
				</div>
				<div class="text-xs text-[var(--muted)]" title={fmtMsgFull(message)}>
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
						title={fmtEditFull(message)}
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
					<div class={compact ? 'mt-1 flex flex-wrap gap-2' : 'mt-1.5 flex flex-wrap gap-2'}>
						{#each message.attachments as a}
							<div
								class="rounded border border-[var(--stroke)] bg-[var(--panel)] px-2 py-0.5 text-xs"
							>
								{a.filename}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
