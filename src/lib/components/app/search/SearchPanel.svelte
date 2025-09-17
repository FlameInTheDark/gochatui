<script lang="ts">
	import type { DtoMessage } from '$lib/api';
	import { auth } from '$lib/stores/auth';
	import {
		selectedGuildId,
		searchOpen,
		searchAnchor,
		selectedChannelId
	} from '$lib/stores/appState';
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	let query = $state('');
	let loading = $state(false);
	let results: DtoMessage[] = $state([]);
	let error: string | null = $state(null);
	let page = $state(0);
	let pages = $state(0);
	let pageItems: (number | string)[] = $state([]);
	let author = $state('');
	let mentions = $state('');
	let hasSelected = $state<string[]>([]);

	let panelEl: HTMLDivElement | null = $state(null);
	let posX = $state(0);
	let posY = $state(0);
	function clamp(v: number, min: number, max: number) {
		return Math.max(min, Math.min(max, v));
	}
	function parseSnowflake(value: string | null): bigint | undefined {
		if (!value) return undefined;
		try {
			const digits = String(value)
				.trim()
				.replace(/[^0-9]/g, '');
			if (!digits) return undefined;
			return BigInt(digits);
		} catch (err) {
			console.error('Failed to parse snowflake', err);
			return undefined;
		}
	}
	function parseMentionsInput(value: string): bigint[] {
		const parts = value
			.split(/[\,\s]+/)
			.map((part) => part.trim())
			.filter(Boolean);
		const ids: bigint[] = [];
		for (const part of parts) {
			const parsed = parseSnowflake(part);
			if (parsed != null) ids.push(parsed);
		}
		return ids;
	}
	const hasOptions = [
		{ value: 'link', label: m.search_has_link() },
		{ value: 'embed', label: m.search_has_embed() },
		{ value: 'file', label: m.search_has_file() },
		{ value: 'image', label: m.search_has_image() }
	];
	function toggleHas(value: string) {
		hasSelected = hasSelected.includes(value)
			? hasSelected.filter((item) => item !== value)
			: [...hasSelected, value];
	}
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
	function formatMsgTime(msg: DtoMessage) {
		const d =
			snowflakeToDate((msg as any)?.id) || (msg.updated_at ? new Date(msg.updated_at) : null);
		if (!d || Number.isNaN(d.getTime())) return '';
		return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
	}
	function formatMsgFull(msg: DtoMessage) {
		const d =
			snowflakeToDate((msg as any)?.id) || (msg.updated_at ? new Date(msg.updated_at) : null);
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

	async function updatePosition() {
		if (typeof window === 'undefined') return;
		await tick();
		const pad = 8;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const rect = panelEl ? panelEl.getBoundingClientRect() : ({ width: 480, height: 320 } as any);
		const anchor = $searchAnchor || { x: vw - pad, y: 56 };
		posX = clamp(anchor.x, pad, vw - rect.width - pad);
		posY = clamp(anchor.y, pad, vh - rect.height - pad);
	}

	async function doSearch() {
		if (!$selectedGuildId || !query.trim()) return;
		loading = true;
		error = null;
		results = [];
		try {
			const guildId = parseSnowflake($selectedGuildId);
			if (!guildId) {
				throw new Error('Invalid guild id');
			}
			const request: any = { page };
			const channelSnowflake = parseSnowflake($selectedChannelId);
			if (channelSnowflake != null) request.channel_id = channelSnowflake;
			const authorSnowflake = parseSnowflake(author);
			if (authorSnowflake != null) request.author_id = authorSnowflake;
			const mentionIds = parseMentionsInput(mentions);
			if (mentionIds.length) request.mentions = mentionIds;
			if (hasSelected.length) request.has = hasSelected;
			if (query.trim()) request.content = query.trim();
			const res = await auth.api.search.searchGuildIdMessagesPost({
				guildId: guildId as any,
				searchMessageSearchRequest: request
			});
			const data: any = res.data;
			const collected: DtoMessage[] = [];
			let totalPages = 0;
			const appendResults = (chunk: any) => {
				if (!chunk) return;
				if (Array.isArray(chunk.messages)) {
					collected.push(...chunk.messages);
				}
				const p = Number(chunk.pages ?? 0);
				if (!Number.isNaN(p)) totalPages = Math.max(totalPages, p);
			};
			if (Array.isArray(data)) {
				for (const entry of data) appendResults(entry);
			} else {
				appendResults(data);
			}
			results = collected;
			pages = totalPages > 0 ? totalPages : collected.length > 0 ? page + 1 : 0;
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'Search failed';
		} finally {
			loading = false;
		}
	}

	function openMessage(m: DtoMessage) {
		if (!m.channel_id) return;
		selectedChannelId.set(String(m.channel_id));
		searchOpen.set(false);
	}

	$effect(() => {
		if ($searchOpen) {
			query = '';
			results = [];
			error = null;
			page = 0;
			pages = 0;
			pageItems = [];
			author = '';
			mentions = '';
			hasSelected = [];
			updatePosition();
		}
	});

	const MAX_PAGER_BUTTONS = 9; // total slots, including first/last and ellipses
	function visiblePageItems(
		total: number,
		current: number,
		maxButtons = MAX_PAGER_BUTTONS
	): (number | string)[] {
		total = Number(total) || 0;
		current = Number(current) || 0;
		if (total <= 0) return [];
		if (total <= maxButtons) return Array.from({ length: total }, (_, i) => i);
		const items: (number | string)[] = [];
		const first = 0;
		const last = total - 1;
		const middleCount = maxButtons - 2; // minus first/last
		let start = Math.max(1, current - Math.floor(middleCount / 2));
		let end = start + middleCount - 1;
		if (end > last - 1) {
			end = last - 1;
			start = end - middleCount + 1;
		}
		items.push(first);
		if (start > 1) items.push('...');
		for (let i = start; i <= end; i++) items.push(i);
		if (end < last - 1) items.push('...');
		items.push(last);
		return items;
	}
	$effect(() => {
		pageItems = visiblePageItems(pages, page);
	});
</script>

{#if $searchOpen}
	<div
		class="fixed inset-0 z-[1000]"
		role="button"
		tabindex="0"
		onpointerdown={() => searchOpen.set(false)}
		onkeydown={(e) => e.key === 'Escape' && searchOpen.set(false)}
	>
		<div
			bind:this={panelEl}
			class="panel absolute w-[min(80vw,640px)] p-4"
			role="dialog"
			tabindex="-1"
			style={`left:${posX}px; top:${posY}px`}
			onpointerdown={(e) => e.stopPropagation()}
		>
			<div class="flex gap-2">
				<input
					class="flex-1 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					placeholder={m.search_placeholder()}
					bind:value={query}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							page = 0;
							doSearch();
						}
					}}
				/>
				<button
					class="rounded-md bg-[var(--brand)] px-3 py-2 text-[var(--bg)]"
					onclick={() => {
						page = 0;
						doSearch();
					}}>{m.search()}</button
				>
			</div>
			<div class="mt-3 space-y-3">
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="flex flex-col gap-1 text-sm">
						<span class="text-[var(--muted)]">{m.search_author_id()}</span>
						<input
							class="rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
							bind:value={author}
							placeholder={m.search_author_id_placeholder()}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									page = 0;
									doSearch();
								}
							}}
						/>
					</label>
					<label class="flex flex-col gap-1 text-sm">
						<span class="text-[var(--muted)]">{m.search_mentions()}</span>
						<input
							class="rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
							bind:value={mentions}
							placeholder={m.search_mentions_placeholder()}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									page = 0;
									doSearch();
								}
							}}
						/>
					</label>
				</div>
				<div class="flex flex-col gap-2 text-sm">
					<span class="text-[var(--muted)]">{m.search_has()}</span>
					<div class="flex flex-wrap gap-2">
						{#each hasOptions as option}
							<button
								class={`rounded-full border px-3 py-1 text-xs transition hover:bg-[var(--panel)] ${
									hasSelected.includes(option.value)
										? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]'
										: 'border-[var(--stroke)]'
								}`}
								type="button"
								onclick={() => {
									page = 0;
									toggleHas(option.value);
									doSearch();
								}}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</div>
			</div>
			{#if error}<div class="mt-2 text-sm text-red-500">{error}</div>{/if}

			<div class="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
				{#if loading}
					<div class="text-sm text-[var(--muted)]">{m.searching()}</div>
				{:else if results.length === 0}
					<div class="text-sm text-[var(--muted)]">{m.no_results()}</div>
				{:else}
					{#each results as message (message.id)}
						<div
							class="cursor-pointer rounded p-2 hover:bg-[var(--panel)]"
							role="button"
							tabindex="0"
							onclick={() => openMessage(message)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openMessage(message)}
						>
							<div class="flex items-baseline justify-between gap-2">
								<div class="truncate text-sm font-semibold text-[var(--muted)]">
									{message.author?.name ?? m.user_default_name()}
								</div>
								<div class="shrink-0 text-xs text-[var(--muted)]" title={formatMsgFull(message)}>
									{formatMsgTime(message)}
								</div>
							</div>
							<div class="mt-1 text-xs tracking-wide text-[var(--muted)] uppercase">
								{message.channel_id
									? m.search_result_in_channel({
											channel: String(message.channel_id)
										})
									: ''}
							</div>
							<div class="mt-1 text-sm leading-snug whitespace-pre-line text-[var(--fg)]">
								{message.content?.trim() || m.search_result_no_content()}
							</div>
							{#if message.attachments && message.attachments.length > 0}
								<div class="mt-1 text-xs text-[var(--muted)]">
									{m.search_result_attachments({
										count: String(message.attachments.length)
									})}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>

			{#if pages > 0}
				<div class="mt-3 flex items-center justify-center gap-1">
					<button
						class="rounded-md border border-[var(--stroke)] px-2 py-1 disabled:opacity-50"
						aria-label={m.pager_prev()}
						disabled={loading || page <= 0}
						onclick={() => {
							if (page > 0) {
								page -= 1;
								doSearch();
							}
						}}
					>
						&lsaquo;
					</button>

					{#each pageItems as p}
						{#if typeof p === 'string'}
							<span class="px-2 text-[var(--muted)] select-none">{p}</span>
						{:else}
							<button
								class={`min-w-[2rem] rounded-md border border-[var(--stroke)] px-2 py-1 ${
									p === page ? 'bg-[var(--panel)]' : ''
								}`}
								aria-current={p === page ? 'page' : undefined}
								onclick={() => {
									if (!loading && p !== page) {
										page = p;
										doSearch();
									}
								}}
								disabled={loading}
							>
								{p + 1}
							</button>
						{/if}
					{/each}

					<button
						class="rounded-md border border-[var(--stroke)] px-2 py-1 disabled:opacity-50"
						aria-label={m.pager_next()}
						disabled={loading || (pages ? page >= pages - 1 : false)}
						onclick={() => {
							if (!pages || page < pages - 1) {
								page += 1;
								doSearch();
							}
						}}
					>
						&rsaquo;
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
