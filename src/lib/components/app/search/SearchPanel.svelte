<script lang="ts">
        import type { DtoMessage } from '$lib/api';
        import { auth } from '$lib/stores/auth';
        import {
                selectedGuildId,
                searchOpen,
                searchAnchor,
                selectedChannelId,
                channelsByGuild,
                channelReady,
                lastChannelByGuild,
                messageJumpRequest
        } from '$lib/stores/appState';
        import { tick } from 'svelte';
        import { m } from '$lib/paraglide/messages.js';
        import { Search } from 'lucide-svelte';
        import { tooltip } from '$lib/actions/tooltip';
        import MessageAttachments from '../chat/MessageAttachments.svelte';
        import type { MessageAttachment } from '../chat/messageAttachments';

        type FilterType = 'from' | 'mentions' | 'has';
        interface TextFilterToken {
                raw: string;
                display: string;
        }

        let inputValue = $state('');
        let loading = $state(false);
        let results: DtoMessage[] = $state([]);
        let error: string | null = $state(null);
        let page = $state(0);
        let pages = $state(0);
        let pageItems: (number | string)[] = $state([]);

        let authorFilter: TextFilterToken | null = $state(null);
        let mentionFilters: TextFilterToken[] = $state([]);
        let hasSelected = $state<string[]>([]);

        let pendingFilter: FilterType | null = $state(null);
        let pendingValue = $state('');

        let panelEl: HTMLDivElement | null = $state(null);
        let searchInputEl: HTMLInputElement | null = $state(null);
        let promptInputEl: HTMLInputElement | null = $state(null);
        let showKeywordHelp = $state(false);
        let pendingHasNormalized = $state<string | null>(null);

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

        const hasOptions = [
                { value: 'url', label: m.search_has_url() },
                { value: 'image', label: m.search_has_image() },
                { value: 'video', label: m.search_has_video() },
                { value: 'audio', label: m.search_has_audio() },
                { value: 'file', label: m.search_has_file() }
        ];

        function hasLabel(value: string) {
                return hasOptions.find((option) => option.value === value)?.label ?? value;
        }

        function normalizeHasValue(value: string): string | null {
                if (!value) return null;
                const normalized = value.trim().toLowerCase();
                if (!normalized) return null;
                return hasOptions.some((option) => option.value === normalized) ? normalized : null;
        }

        function addHasValue(value: string): boolean {
                const normalized = normalizeHasValue(value);
                if (!normalized) return false;
                if (hasSelected.includes(normalized)) return true;
                hasSelected = [...hasSelected, normalized];
                return true;
        }

        function removeHas(value: string) {
                const normalized = normalizeHasValue(value) ?? value.trim().toLowerCase();
                hasSelected = hasSelected.filter((item) => item !== normalized);
        }

        $effect(() => {
                pendingHasNormalized =
                        pendingFilter === 'has' ? normalizeHasValue(pendingValue) : null;
        });

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
                return new Intl.DateTimeFormat(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                }).format(d);
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

        function authorInitials(message: DtoMessage) {
                const name = message.author?.name ?? m.user_default_name();
                return name.slice(0, 2).toUpperCase();
        }

        function resolveChannelName(channelId: any) {
                if (!channelId || !$selectedGuildId) return '';
                const gid = String($selectedGuildId ?? '');
                const list = $channelsByGuild[gid] ?? [];
                const target = String(channelId);
                const found = list.find((channel: any) => String(channel?.id ?? '') === target);
                return (found as any)?.name ?? '';
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

        function closeFilterPrompt() {
                pendingFilter = null;
                pendingValue = '';
                promptInputEl = null;
                tick().then(() => searchInputEl?.focus());
        }

        function startFilterPrompt(filter: FilterType) {
                pendingFilter = filter;
                pendingValue = '';
                showKeywordHelp = false;
                tick().then(() => {
                        promptInputEl?.focus();
                        promptInputEl?.select();
                });
        }

        function detectFilterTrigger(value: string) {
                if (pendingFilter) return;
                const trimmedTrailing = value.replace(/\s+$/, '');
                const match = trimmedTrailing.match(/(?:^|\s)(from|mentions|has):$/i);
                if (!match) return;
                const keyword = match[1].toLowerCase() as FilterType;
                const lowered = trimmedTrailing.toLowerCase();
                const trigger = `${keyword}:`;
                const idx = lowered.lastIndexOf(trigger);
                if (idx < 0) return;
                const newValue = trimmedTrailing.slice(0, idx).replace(/\s+$/, ' ');
                inputValue = newValue;
                startFilterPrompt(keyword);
        }

        function onInputChange(event: Event) {
                const value = (event.target as HTMLInputElement).value;
                inputValue = value;
                showKeywordHelp = false;
                detectFilterTrigger(value);
        }

        function removeAuthor() {
                authorFilter = null;
        }

        function removeMention(index: number) {
                mentionFilters = mentionFilters.filter((_, i) => i !== index);
        }

        function addMentionToken(raw: string) {
                const display = raw.trim();
                if (!display) return;
                if (!mentionFilters.some((token) => token.display === display)) {
                        mentionFilters = [...mentionFilters, { raw, display }];
                }
        }

        function applyPendingFilter(): boolean {
                if (!pendingFilter) return false;
                if (pendingFilter === 'has') {
                        if (!pendingValue.trim()) return false;
                        if (addHasValue(pendingValue)) {
                                closeFilterPrompt();
                                return true;
                        }
                        return false;
                }
                const value = pendingValue.trim();
                if (!value) return false;
                if (pendingFilter === 'from') {
                        authorFilter = { raw: value, display: value };
                } else if (pendingFilter === 'mentions') {
                        addMentionToken(value);
                }
                closeFilterPrompt();
                return true;
        }

        function onPromptKeydown(event: KeyboardEvent) {
                if (event.key === 'Enter' || (pendingFilter === 'has' && event.key === ' ')) {
                        event.preventDefault();
                        const applied = applyPendingFilter();
                        if (applied && event.key === ' ') {
                                inputValue = `${inputValue} `;
                        }
                } else if (event.key === 'Escape') {
                        event.preventDefault();
                        closeFilterPrompt();
                }
        }

        function applyHasOption(value: string) {
                if (addHasValue(value)) {
                        closeFilterPrompt();
                }
        }

        function onSearchInputKeydown(event: KeyboardEvent) {
                if (pendingFilter) {
                        if (event.key === 'Escape') {
                                event.preventDefault();
                                closeFilterPrompt();
                        } else if (event.key === 'Enter') {
                                event.preventDefault();
                        }
                        return;
                }
                if (event.key === 'Escape' && showKeywordHelp) {
                        event.preventDefault();
                        showKeywordHelp = false;
                        return;
                }
                if (event.key === 'Enter') {
                        event.preventDefault();
                        page = 0;
                        doSearch();
                        return;
                }
                if (event.key === 'Backspace' && inputValue.length === 0) {
                        if (mentionFilters.length > 0) {
                                event.preventDefault();
                                mentionFilters = mentionFilters.slice(0, -1);
                                return;
                        }
                        if (hasSelected.length > 0) {
                                event.preventDefault();
                                hasSelected = hasSelected.slice(0, -1);
                                return;
                        }
                        if (authorFilter) {
                                event.preventDefault();
                                authorFilter = null;
                        }
                }
        }

        async function doSearch() {
                if (!$selectedGuildId) return;
                const trimmedQuery = inputValue.trim();
                const hasFilters =
                        Boolean(authorFilter) || mentionFilters.length > 0 || hasSelected.length > 0;
                if (!trimmedQuery && !hasFilters) return;
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
                        if (authorFilter) {
                                const authorSnowflake = parseSnowflake(authorFilter.raw);
                                if (authorSnowflake != null) request.author_id = authorSnowflake;
                        }
                        if (mentionFilters.length) {
                                const mentionIds = mentionFilters
                                        .map((token) => parseSnowflake(token.raw))
                                        .filter((id): id is bigint => id != null);
                                if (mentionIds.length) request.mentions = mentionIds;
                        }
                        if (hasSelected.length) request.has = hasSelected;
                        if (trimmedQuery) request.content = trimmedQuery;
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

        function normalizeId(value: any): string | null {
                if (value == null) return null;
                const str = String(value);
                const digits = str.replace(/[^0-9]/g, '');
                return digits || str;
        }

        function openMessage(m: DtoMessage) {
                const channelId = normalizeId((m as any)?.channel_id);
                const messageId = normalizeId((m as any)?.id);
                if (!channelId || !messageId) return;

                selectedChannelId.set(channelId);
                channelReady.set(true);

                const gid = $selectedGuildId ? String($selectedGuildId) : '';
                if (gid) {
                        lastChannelByGuild.update((map) => ({ ...map, [gid]: channelId }));
                        if (typeof localStorage !== 'undefined') {
                                try {
                                        const raw = localStorage.getItem('lastChannels');
                                        const saved = raw ? JSON.parse(raw) : {};
                                        saved[gid] = channelId;
                                        localStorage.setItem('lastChannels', JSON.stringify(saved));
                                } catch {
                                        /* ignore */
                                }
                        }
                }

                messageJumpRequest.set({ channelId, messageId });
                searchOpen.set(false);
        }

        $effect(() => {
                if ($searchOpen) {
                        inputValue = '';
                        results = [];
                        error = null;
                        page = 0;
                        pages = 0;
                        pageItems = [];
                        authorFilter = null;
                        mentionFilters = [];
                        hasSelected = [];
                        pendingFilter = null;
                        pendingValue = '';
                        showKeywordHelp = false;
                        updatePosition();
                        tick().then(() => searchInputEl?.focus());
                }
        });

        const MAX_PAGER_BUTTONS = 9;
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
                const middleCount = maxButtons - 2;
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
                onclick={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (pendingFilter) {
                                closeFilterPrompt();
                        } else if (showKeywordHelp) {
                                showKeywordHelp = false;
                        } else {
                                searchOpen.set(false);
                        }
                }}
                onkeydown={(e) => {
                        if (e.key === 'Escape') {
                                if (pendingFilter) {
                                        closeFilterPrompt();
                                } else if (showKeywordHelp) {
                                        showKeywordHelp = false;
                                } else {
                                        searchOpen.set(false);
                                }
                        }
                }}
        >
                <div class="absolute inset-0 bg-black/40 pointer-events-none"></div>
                <div
                        class="absolute z-10"
                        style={`left:${posX}px; top:${posY}px`}
                >
                        <div class="relative">
                                <div class="pointer-events-none absolute inset-0 z-0 rounded-xl bg-[var(--panel)]/30 backdrop-blur-sm"></div>
                                <div
                                        bind:this={panelEl}
                                        class="panel relative z-10 w-[min(90vw,720px)] p-5"
                                        role="dialog"
                                        tabindex="-1"
                                        onpointerdown={(e) => e.stopPropagation()}
                                >
                                        <div class="flex flex-col gap-3">
                                                <div
                                                        class="relative"
                                                        onpointerdown={(event) => {
                                                                if (
                                                                        showKeywordHelp &&
                                                                        !(event.target as HTMLElement | null)?.closest('#search-filter-help') &&
                                                                        !(event.target as HTMLElement | null)?.closest('#search-filter-help-button')
                                                                ) {
                                                                        showKeywordHelp = false;
                                                                }
                                                        }}
                                                >
                                                        <div
                                                                class="flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm shadow-sm transition focus-within:border-[var(--brand)] focus-within:shadow-[0_0_0_2px_var(--brand)]"
                                                        >
                                                                <Search class="h-5 w-5 text-[var(--muted)]" stroke-width={2} />
                                                                {#if authorFilter}
                                                                        <span
                                                                                class="flex items-center gap-1 rounded-full bg-[var(--panel)] px-2 py-1 text-xs text-[var(--fg)]"
                                                                        >
                                                                                <span class="font-semibold text-[var(--muted)]">
                                                                                        {m.search_filter_from()}
                                                                                </span>
                                                                                <span>{authorFilter.display}</span>
                                                                                <button
                                                                                        class="rounded-full bg-transparent p-1 text-[var(--muted)] hover:bg-[var(--panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
                                                                                        type="button"
                                                                                        aria-label={m.search_filter_remove()}
                                                                                        onclick={(event) => {
                                                                                                event.stopPropagation();
                                                                                                removeAuthor();
                                                                                        }}
                                                                                >
                                                                                        ×
                                                                                </button>
                                                                        </span>
                                                                {/if}
                                                                {#each mentionFilters as mention, index}
                                                                        <span
                                                                                class="flex items-center gap-1 rounded-full bg-[var(--panel)] px-2 py-1 text-xs text-[var(--fg)]"
                                                                        >
                                                                                <span class="font-semibold text-[var(--muted)]">
                                                                                        {m.search_filter_mentions()}
                                                                                </span>
                                                                                <span>{mention.display}</span>
                                                                                <button
                                                                                        class="rounded-full bg-transparent p-1 text-[var(--muted)] hover:bg-[var(--panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
                                                                                        type="button"
                                                                                        aria-label={m.search_filter_remove()}
                                                                                        onclick={(event) => {
                                                                                                event.stopPropagation();
                                                                                                removeMention(index);
                                                                                        }}
                                                                                >
                                                                                        ×
                                                                                </button>
                                                                        </span>
                                                                {/each}
                                                                {#each hasSelected as option}
                                                                        <span
                                                                                class="flex items-center gap-1 rounded-full bg-[var(--panel)] px-2 py-1 text-xs text-[var(--fg)]"
                                                                        >
                                                                                <span class="font-semibold text-[var(--muted)]">
                                                                                        {m.search_filter_has()}
                                                                                </span>
                                                                                <span>{hasLabel(option)}</span>
                                                                                <button
                                                                                        class="rounded-full bg-transparent p-1 text-[var(--muted)] hover:bg-[var(--panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
                                                                                        type="button"
                                                                                        aria-label={m.search_filter_remove()}
                                                                                        onclick={(event) => {
                                                                                                event.stopPropagation();
                                                                                                removeHas(option);
                                                                                        }}
                                                                                >
                                                                                        ×
                                                                                </button>
                                                                        </span>
                                                                {/each}
                                                {#if pendingFilter === 'from' || pendingFilter === 'mentions'}
                                                        <div class="flex items-center gap-2 rounded-md border border-[var(--stroke)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--fg)]">
                                                                <span class="font-semibold text-[var(--muted)]">
                                                                        {pendingFilter === 'from'
                                                                                ? m.search_filter_from()
                                                                                : m.search_filter_mentions()}
                                                                </span>
                                                                <input
                                                                        bind:this={promptInputEl}
                                                                        class="w-40 border-none bg-transparent text-sm text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                                                                        placeholder={pendingFilter === 'from'
                                                                                ? m.search_filter_from_placeholder()
                                                                                : m.search_filter_mentions_placeholder()}
                                                                        bind:value={pendingValue}
                                                                        onkeydown={onPromptKeydown}
                                                                />
                                                                <button
                                                                        class="rounded-full bg-transparent p-1 text-[var(--muted)] hover:bg-[var(--panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
                                                                        type="button"
                                                                        aria-label={m.search_filter_cancel()}
                                                                        onclick={(event) => {
                                                                                event.stopPropagation();
                                                                                closeFilterPrompt();
                                                                        }}
                                                                >
                                                                        ×
                                                                </button>
                                                                <button
                                                                        class="rounded-md bg-[var(--brand)] px-2 py-1 text-xs font-semibold text-[var(--bg)] transition hover:bg-[var(--brand)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 disabled:opacity-50"
                                                                        type="button"
                                                                        onclick={(event) => {
                                                                                event.stopPropagation();
                                                                                applyPendingFilter();
                                                                        }}
                                                                        disabled={!pendingValue.trim()}
                                                                >
                                                                        {m.search_filter_add()}
                                                                </button>
                                                        </div>
                                                {:else if pendingFilter === 'has'}
                                                        <div class="flex flex-wrap items-center gap-2 rounded-md border border-[var(--stroke)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--fg)]">
                                                                <span class="font-semibold text-[var(--muted)]">{m.search_filter_has()}</span>
                                                                <input
                                                                        bind:this={promptInputEl}
                                                                        class="w-32 border-none bg-transparent text-sm text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                                                                        placeholder={m.search_filter_has_placeholder()}
                                                                        bind:value={pendingValue}
                                                                        onkeydown={onPromptKeydown}
                                                                />
                                                                <div class="flex flex-wrap gap-1">
                                                                        {#each hasOptions as option}
                                                                                <button
                                                                                        class={`rounded-full border px-3 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 ${
                                                                                                option.value === pendingHasNormalized || hasSelected.includes(option.value)
                                                                                                        ? 'border-[var(--brand)] bg-[var(--brand)]/20 text-[var(--brand)]'
                                                                                                        : 'border-[var(--stroke)] text-[var(--fg)] hover:bg-[var(--panel)]'
                                                                                        }`}
                                                                                        type="button"
                                                                                        onclick={(event) => {
                                                                                                event.stopPropagation();
                                                                                                applyHasOption(option.value);
                                                                                        }}
                                                                                >
                                                                                        {option.label}
                                                                                </button>
                                                                        {/each}
                                                                </div>
                                                                <button
                                                                        class="rounded-full bg-transparent p-1 text-[var(--muted)] hover:bg-[var(--panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
                                                                        type="button"
                                                                        aria-label={m.search_filter_cancel()}
                                                                        onclick={(event) => {
                                                                                event.stopPropagation();
                                                                                closeFilterPrompt();
                                                                        }}
                                                                >
                                                                        ×
                                                                </button>
                                                                <button
                                                                        class="rounded-md bg-[var(--brand)] px-2 py-1 text-xs font-semibold text-[var(--bg)] transition hover:bg-[var(--brand)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 disabled:opacity-50"
                                                                        type="button"
                                                                        onclick={(event) => {
                                                                                event.stopPropagation();
                                                                                applyPendingFilter();
                                                                        }}
                                                                        disabled={!pendingHasNormalized}
                                                                >
                                                                        {m.search_filter_add()}
                                                                </button>
                                                        </div>
                                                {/if}
                                                <input
                                                        bind:this={searchInputEl}
                                                        class="min-w-[6rem] flex-1 border-none bg-transparent text-sm text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                                                        placeholder={m.search_placeholder()}
                                                        bind:value={inputValue}
                                                        oninput={onInputChange}
                                                        onkeydown={onSearchInputKeydown}
                                                />
                                                <button
                                                        id="search-filter-help-button"
                                                        class="ml-2 shrink-0 rounded-md border border-[var(--stroke)] px-2 py-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
                                                        type="button"
                                                        aria-haspopup="dialog"
                                                        aria-expanded={showKeywordHelp}
                                                        aria-controls="search-filter-help"
                                                        aria-label={m.search_filter_help_label()}
                                                        onclick={(event) => {
                                                                event.stopPropagation();
                                                                if (pendingFilter) {
                                                                        closeFilterPrompt();
                                                                }
                                                                showKeywordHelp = !showKeywordHelp;
                                                        }}
                                                >
                                                        ?
                                                </button>
                                                <button
                                                        class="ml-2 shrink-0 rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-semibold text-[var(--bg)] transition hover:bg-[var(--brand)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 disabled:opacity-50"
                                                        type="button"
                                                        onclick={() => {
                                                                showKeywordHelp = false;
                                                                page = 0;
                                                                doSearch();
                                                        }}
                                                        disabled={loading}
                                                >
                                                        {m.search()}
                                                </button>
                                        </div>
                                        {#if showKeywordHelp}
                                                <div
                                                        id="search-filter-help"
                                                        class="absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-4 text-xs text-[var(--fg)] shadow-xl"
                                                >
                                                        <div class="text-sm font-semibold text-[var(--fg)]">
                                                                {m.search_filter_help_title()}
                                                        </div>
                                                        <p class="mt-1 text-xs text-[var(--muted)]">
                                                                {m.search_filter_help_hint()}
                                                        </p>
                                                        <ul class="mt-3 space-y-2 text-left text-xs text-[var(--fg)]">
                                                                <li class="flex gap-2">
                                                                        <span class="font-mono text-[var(--muted)]">from:</span>
                                                                        <span>{m.search_filter_help_from()}</span>
                                                                </li>
                                                                <li class="flex gap-2">
                                                                        <span class="font-mono text-[var(--muted)]">mentions:</span>
                                                                        <span>{m.search_filter_help_mentions()}</span>
                                                                </li>
                                                                <li class="flex gap-2">
                                                                        <span class="font-mono text-[var(--muted)]">has:</span>
                                                                        <span>
                                                                                {m.search_filter_help_has({
                                                                                        values: hasOptions.map((option) => option.value).join(', ')
                                                                                })}
                                                                        </span>
                                                                </li>
                                                        </ul>
                                                </div>
                                        {/if}
                                </div>
                                {#if error}
                                        <div class="text-sm text-red-500">{error}</div>
                                {/if}
                                <div class="scroll-area max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                                        {#if loading}
                                                <div class="text-sm text-[var(--muted)]">{m.searching()}</div>
                                        {:else if results.length === 0}
                                                <div class="text-sm text-[var(--muted)]">{m.no_results()}</div>
                                        {:else}
                                                {#each results as message (message.id)}
                                                        <div
                                                                class="group/result flex cursor-pointer gap-3 rounded-lg border border-transparent px-3 py-2 transition hover:border-[var(--stroke)] hover:bg-[var(--panel)]"
                                                                role="button"
                                                                tabindex="0"
                                                                onclick={() => openMessage(message)}
                                                                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openMessage(message)}
                                                        >
                                                                <div
                                                                        class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--stroke)] bg-[var(--panel)] text-sm font-semibold text-[var(--fg)]"
                                                                >
                                                                        {authorInitials(message)}
                                                                </div>
                                                                <div class="min-w-0 flex-1">
                                                                        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                                                                <div class="truncate text-sm font-semibold text-[var(--fg)]">
                                                                                        {message.author?.name ?? m.user_default_name()}
                                                                                        {#if message.author?.discriminator}
                                                                                                <span class="ml-1 text-xs text-[var(--muted)]">
                                                                                                        #{message.author.discriminator}
                                                                                                </span>
                                                                                        {/if}
                                                                                </div>
                                                                                <div class="text-xs text-[var(--muted)]" use:tooltip={() => formatMsgFull(message)}>
                                                                                        {formatMsgTime(message)}
                                                                                </div>
                                                                                {#if resolveChannelName(message.channel_id)}
                                                                                        <div class="text-xs text-[var(--muted)]">
                                                                                                #{resolveChannelName(message.channel_id)}
                                                                                        </div>
                                                                                {/if}
                                                                        </div>
                                                                        {#if message.content?.trim()}
                                                                                <div class="mt-1 whitespace-pre-line text-sm leading-snug text-[var(--fg)]">
                                                                                        {message.content?.trim() ?? ''}
                                                                                </div>
                                                                        {:else if !message.attachments?.length}
                                                                                <div class="mt-1 whitespace-pre-line text-sm leading-snug text-[var(--fg)]">
                                                                                        {m.search_result_no_content()}
                                                                                </div>
                                                                        {/if}
                                                                        {#if message.attachments?.length}
                                                                                <MessageAttachments
                                                                                        attachments={(message.attachments ?? []) as MessageAttachment[]}
                                                                                        messageId={message.id}
                                                                                        compact={true}
                                                                                />
                                                                        {/if}
                                                                </div>
                                                        </div>
                                                {/each}
                                        {/if}
                                </div>
                                {#if pages > 0}
                                        <div class="flex items-center justify-center gap-1">
                                                <button
                                                        class="rounded-md border border-[var(--stroke)] px-2 py-1 text-sm disabled:opacity-50"
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
                                                                        class={`min-w-[2rem] rounded-md border border-[var(--stroke)] px-2 py-1 text-sm ${
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
                                                        class="rounded-md border border-[var(--stroke)] px-2 py-1 text-sm disabled:opacity-50"
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
                        </div>
                </div>
        </div>
{/if}
