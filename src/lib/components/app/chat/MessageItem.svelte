<script lang="ts">
	import type { DtoMessage } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import { selectedChannelId } from '$lib/stores/appState';
	import { createEventDispatcher } from 'svelte';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	import { m } from '$lib/paraglide/messages.js';
	import CodeBlock from './CodeBlock.svelte';

	type MessageSegment =
		| { type: 'text'; content: string }
		| { type: 'code'; content: string; language?: string };

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
			const codeBody = body ?? '';
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

	let { message, compact = false } = $props<{ message: DtoMessage; compact?: boolean }>();
	let isEditing = $state(false);
	let draft = $state(message.content ?? '');
	let saving = $state(false);
	const dispatch = createEventDispatcher<{ deleted: void }>();
	const segments = $derived(parseMessageContent(message.content ?? ''));

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
				class={compact
					? 'mt-0 pr-16 text-sm leading-tight whitespace-pre-wrap'
					: 'mt-0.5 pr-16 whitespace-pre-wrap'}
				title={fmtMsgFull(message)}
			>
				{#if segments.length === 0}
					{message.content}
				{:else}
					{#each segments as segment, index (index)}
						{#if segment.type === 'code'}
							<div class="my-2 first:mt-0 last:mb-0">
								<CodeBlock code={segment.content} language={segment.language} />
							</div>
						{:else}
							<span class="whitespace-pre-wrap">{segment.content}</span>
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
