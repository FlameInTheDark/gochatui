<script lang="ts">
	import type { DtoMessage } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import { selectedChannelId } from '$lib/stores/appState';
	import { createEventDispatcher } from 'svelte';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	import { m } from '$lib/paraglide/messages.js';
	import CodeBlock from './CodeBlock.svelte';
	import InvitePreview from './InvitePreview.svelte';

	type MessageSegment =
		| { type: 'text'; content: string }
		| { type: 'code'; content: string; language?: string };

	type MessageEmbed =
		| { kind: 'invite'; code: string; url: string }
		| { kind: 'youtube'; videoId: string; url: string };

	type TextToken =
		| { type: 'text'; content: string }
		| { type: 'link'; label: string; url: string; embed?: MessageEmbed };

	type RenderedSegment =
		| { type: 'code'; content: string; language?: string }
		| { type: 'text'; tokens: TextToken[] };

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

	function extractInvite(url: string): { code: string } | null {
		try {
			const parsed = new URL(url);
			const segments = parsed.pathname.split('/').filter(Boolean);
			if (
				segments.length >= 3 &&
				segments[0]?.toLowerCase() === 'app' &&
				segments[1]?.toLowerCase() === 'i'
			) {
				const code = segments[2];
				if (code) {
					return { code };
				}
			}
		} catch {
			return null;
		}
		return null;
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

	function tokenizeText(content: string): TextToken[] {
		const tokens: TextToken[] = [];
		if (!content) return tokens;

		urlPattern.lastIndex = 0;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = urlPattern.exec(content)) !== null) {
			const startIndex = match.index;
			let endIndex = startIndex + match[0].length;

			while (endIndex > startIndex && /[)\]\}>,.;!?]/.test(content[endIndex - 1])) {
				endIndex--;
			}

			if (endIndex <= startIndex) {
				continue;
			}

			if (startIndex > lastIndex) {
				tokens.push({ type: 'text', content: content.slice(lastIndex, startIndex) });
			}

			const rawUrl = content.slice(startIndex, endIndex);
			const normalized = normalizeUrl(rawUrl);
			const invite = extractInvite(normalized);
			const youtube = extractYouTube(normalized);

			if (invite) {
				tokens.push({
					type: 'link',
					label: rawUrl,
					url: normalized,
					embed: { kind: 'invite', code: invite.code, url: normalized }
				});
			} else if (youtube) {
				tokens.push({
					type: 'link',
					label: rawUrl,
					url: normalized,
					embed: { kind: 'youtube', videoId: youtube.videoId, url: normalized }
				});
			} else {
				tokens.push({ type: 'link', label: rawUrl, url: normalized });
			}

			lastIndex = endIndex;

			if (urlPattern.lastIndex > endIndex) {
				urlPattern.lastIndex = endIndex;
			}
		}

		if (lastIndex < content.length) {
			tokens.push({ type: 'text', content: content.slice(lastIndex) });
		}

		return tokens;
	}

	let { message, compact = false } = $props<{ message: DtoMessage; compact?: boolean }>();
	let isEditing = $state(false);
	let draft = $state(message.content ?? '');
	let saving = $state(false);
	const dispatch = createEventDispatcher<{ deleted: void }>();
	const segments = $derived(parseMessageContent(message.content ?? ''));
	const renderedSegments = $derived(
		segments.map((segment): RenderedSegment => {
			if (segment.type === 'code') {
				return segment;
			}
			return { type: 'text', tokens: tokenizeText(segment.content) };
		})
	);

	const messageEmbeds = $derived(
		renderedSegments.flatMap((segment): MessageEmbed[] => {
			if (segment.type !== 'text') return [];
			return segment.tokens.flatMap((token): MessageEmbed[] =>
				token.type === 'link' && token.embed ? [token.embed] : []
			);
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
		if (!$selectedChannelId || !message.id) return;
		await auth.api.message.messageChannelChannelIdMessageIdDelete({
			channelId: $selectedChannelId as any,
			messageId: message.id as any
		});
		dispatch('deleted');
	}

	function openMenu(e: MouseEvent) {
		e.preventDefault();
		const mid = String((message as any)?.id ?? '');
		const uid = String(((message as any)?.author as any)?.id ?? '');
		const items = [
			{ label: m.ctx_copy_message_id(), action: () => copyToClipboard(mid), disabled: !mid },
			{ label: m.ctx_copy_user_id(), action: () => copyToClipboard(uid), disabled: !uid },
			{
				label: m.ctx_edit_message(),
				action: () => {
					isEditing = true;
					draft = message.content ?? '';
				},
				disabled: !message?.id
			},
			{
				label: m.ctx_delete_message(),
				action: () => deleteMsg(),
				danger: true,
				disabled: !message?.id
			}
		];
		contextMenu.openFromEvent(e, items);
	}
</script>

<div
	role="listitem"
	class={`group/message flex gap-3 px-4 ${compact ? 'py-0.5' : 'py-2'} hover:bg-[var(--panel)]/30`}
	oncontextmenu={openMenu}
>
	{#if compact}
		<div
			class="w-10 shrink-0 pt-0.5 pr-1 text-right text-[10px] leading-tight text-[var(--muted)] opacity-0 transition-opacity group-hover/message:opacity-100"
			title={fmtMsgFull(message)}
		>
			{fmtMsgTime(message)}
		</div>
	{:else}
		<div
			class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)] text-sm"
		>
			{(message.author?.name ?? '?').slice(0, 2).toUpperCase()}
		</div>
	{/if}
	<div class="relative min-w-0 flex-1">
		{#if !isEditing}
			<div
				class="absolute top-1 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100"
			>
				<button
					class="rounded border border-[var(--stroke)] p-1 hover:bg-[var(--panel)]"
					title="Edit"
					aria-label="Edit"
					onclick={() => {
						isEditing = true;
						draft = message.content ?? '';
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="14"
						height="14"
						fill="currentColor"
						><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" /><path
							d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
						/></svg
					>
				</button>
				<button
					class="rounded border border-[var(--stroke)] p-1 text-red-400 hover:bg-[var(--panel)]"
					title="Delete"
					aria-label="Delete"
					onclick={deleteMsg}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width="14"
						height="14"
						fill="currentColor"
						><path d="M6 7h12v2H6z" /><path d="M8 9h8l-1 11H9L8 9z" /><path
							d="M10 4h4v2h-4z"
						/></svg
					>
				</button>
			</div>
		{/if}
		{#if !compact}
			<div class="flex items-baseline gap-2 pr-20">
				<div
					role="contentinfo"
					class="truncate font-semibold text-[var(--muted)]"
					oncontextmenu={(e) => {
						e.preventDefault();
						const uid = String(((message as any)?.author as any)?.id ?? '');
						contextMenu.openFromEvent(e, [
							{ label: 'Copy user ID', action: () => copyToClipboard(uid), disabled: !uid }
						]);
					}}
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
					bind:value={draft}
					rows={3}
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
			<div
				class={compact ? 'mt-0 pr-16 text-sm leading-tight' : 'mt-0.5 pr-16'}
				title={fmtMsgFull(message)}
			>
				{#if renderedSegments.length === 0}
					<span class="break-words whitespace-pre-wrap">{message.content}</span>
				{:else}
					{#each renderedSegments as segment, index (index)}
						{#if segment.type === 'code'}
							<div class="my-2 whitespace-normal first:mt-0 last:mb-0">
								<CodeBlock code={segment.content} language={segment.language} />
							</div>
						{:else}
							{#each segment.tokens as token, tokenIndex (`${index}-${tokenIndex}`)}
								{#if token.type === 'text'}
									<span class="break-words whitespace-pre-wrap">{token.content}</span>
								{:else}
									<a
										class="font-medium break-words text-[var(--brand)] underline underline-offset-2 transition hover:text-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
										href={token.url}
										rel="noopener noreferrer"
										target="_blank"
									>
										{token.label}
									</a>
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
			</div>
			{#if messageEmbeds.length}
				<div class="mt-2 flex flex-col gap-2">
					{#each messageEmbeds as embed, embedIndex (embedIndex)}
						{#if embed.kind === 'invite'}
							<div class="max-w-sm">
								<InvitePreview code={embed.code} url={embed.url} />
							</div>
						{:else if embed.kind === 'youtube'}
							<div
								class="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--stroke)] bg-black"
								style="aspect-ratio: 16 / 9;"
							>
								<iframe
									class="h-full w-full"
									src={`https://www.youtube.com/embed/${embed.videoId}`}
									title="YouTube video player"
									allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
									allowfullscreen
								></iframe>
							</div>
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
		{/if}
	</div>
</div>
