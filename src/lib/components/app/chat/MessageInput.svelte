<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import type { DtoChannel, DtoMember, DtoRole, DtoUser } from '$lib/api';
        import {
                selectedChannelId,
                selectedGuildId,
                channelsByGuild,
                membersByGuild
        } from '$lib/stores/appState';
        import AttachmentUploader from './AttachmentUploader.svelte';
        import EmojiPicker from './EmojiPicker.svelte';
        import type EmojiPickerComponent from './EmojiPicker.svelte';
        import emojiGroupsData from 'unicode-emoji-json/data-by-group.json';
        import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
        import { get } from 'svelte/store';
        import { m } from '$lib/paraglide/messages.js';
        import { Send, X, Paperclip, Smile, AtSign, Hash, BadgeCheck, Volume2 } from 'lucide-svelte';
        import {
                addPendingMessage,
                removePendingMessage,
                updatePendingAttachment,
                updatePendingMessage,
                type PendingAttachment,
                type PendingMessage
        } from '$lib/stores/pendingMessages';
        import {
                detectMentionTrigger,
                findMentionAtIndex,
                mentionPlaceholder,
                parseMentions,
                splitTextWithMentions,
                MENTION_ACCENT_COLORS,
                type MentionTrigger,
                type MentionMatch,
                type MentionType,
                type SpecialMention
        } from '$lib/utils/mentions';
        import { guildRoleCacheState, loadGuildRolesCached } from '$lib/utils/guildRoles';
        import {
                buildRoleMap,
                memberPrimaryName,
                toSnowflakeString
        } from '$lib/utils/members';

        type EditorTokenInfo = {
                trigger: '@' | '#' | ':';
                query: string;
                node: Text;
                start: number;
                end: number;
        };

        type ChannelKind = 'text' | 'voice';

        type MentionSuggestion = {
                id: string;
                type: MentionType | 'emoji';
                label: string;
                description: string | null;
                accentColor: string | null;
                member?: DtoMember | null;
                user?: DtoUser | null;
                channelKind?: ChannelKind;
                special?: SpecialMention | null;
                emoji?: string | null;
                searchTerms?: string[];
        };

        const dispatch = createEventDispatcher<{ sent: void }>();

        let content = $state('');
        let attachments = $state<PendingAttachment[]>([]);
        let sending = $state(false);

        let editorEl: HTMLDivElement | null = null;
        let editorWrapperEl: HTMLDivElement | null = null;
        let mentionMenuEl = $state<HTMLDivElement | null>(null);

        let uploaderRef: {
                addFiles?: (files: FileList | File[] | null | undefined) => Promise<PendingAttachment[] | void>;
        } | null = null;
        let dropActive = $state(false);
        let dragCounter = $state(0);
        let removeGlobalDragListeners: (() => void) | null = null;

        let showEmojiPicker = $state(false);
        let emojiButton = $state<HTMLButtonElement | null>(null);
        let emojiMenuEl = $state<HTMLDivElement | null>(null);
        let emojiPickerRef = $state<EmojiPickerComponent | null>(null);
        let removeEmojiMenuListeners: (() => void) | null = null;

        type SuggestionTrigger = MentionTrigger | EmojiTrigger;

        let mentionQuery = $state<SuggestionTrigger | null>(null);
        let mentionSuggestions = $state<MentionSuggestion[]>([]);
        let mentionActiveIndex = $state(0);
        const mentionMenuOpen = $derived.by(() => Boolean(mentionQuery && mentionSuggestions.length > 0));
        let mentionListEl = $state<HTMLDivElement | null>(null);
        let mentionMenuPosition = $state<{ left: number; top: number } | null>(null);
        let activeTokenInfo: EditorTokenInfo | null = null;
        let editorFocused = $state(false);

        let typingResetTimer: ReturnType<typeof setTimeout> | null = null;
        let typingLastSentAt = 0;
        let typingActive = false;
        let typingChannelId: string | null = null;

        let mentionRoleMap = $state<Record<string, DtoRole>>({});
        const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
        const ZERO_WIDTH_SPACE_REGEX = new RegExp(ZERO_WIDTH_SPACE, 'g');

        const editorIsEmpty = $derived.by(
                () => content.replace(ZERO_WIDTH_SPACE_REGEX, '').trim().length === 0
        );
        const mentionMemberMap = $derived.by(() => {
                const guildId = $selectedGuildId ?? '';
                const list = ($membersByGuild[guildId] ?? []) as DtoMember[] | undefined;
                const map = new Map<string, DtoMember>();
                if (Array.isArray(list)) {
                        for (const entry of list) {
                                const id = memberUserId(entry);
                                if (id) {
                                        map.set(id, entry);
                                }
                        }
                }
                return map;
        });

        type EmojiDatasetEntry = {
                emoji: string;
                name?: string;
                slug: string;
        };

        type EmojiDatasetGroup = {
                emojis: EmojiDatasetEntry[];
        };

        type EmojiTrigger = {
                trigger: ':';
                start: number;
                query: string;
                hasTerminator: boolean;
        };

        const RAW_EMOJI_GROUPS = emojiGroupsData as EmojiDatasetGroup[];

        function formatEmojiLabel(name: string | undefined, fallback: string): string {
                if (!name) {
                        return fallback;
                }
                const trimmed = name.trim();
                if (!trimmed) {
                        return fallback;
                }
                return trimmed
                        .split(/\s+/)
                        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
        }

        const emojiSuggestionPool: MentionSuggestion[] = [];
        const emojiSuggestionIndex = new Map<string, MentionSuggestion>();

        for (const group of RAW_EMOJI_GROUPS) {
                if (!group || !Array.isArray(group.emojis)) continue;
                for (const entry of group.emojis) {
                        if (!entry || typeof entry.emoji !== 'string' || typeof entry.slug !== 'string') {
                                continue;
                        }
                        const emoji = entry.emoji;
                        const slug = entry.slug;
                        if (!emoji || !slug) continue;
                        const underscoreSlug = slug.replace(/-/g, '_');
                        const fallbackLabel = underscoreSlug.replace(/_/g, ' ');
                        const label = formatEmojiLabel(entry.name, fallbackLabel);
                        const description = `:${underscoreSlug}:`;
                        const searchTerms = new Set<string>();
                        searchTerms.add(slug.toLowerCase());
                        searchTerms.add(underscoreSlug.toLowerCase());
                        searchTerms.add(description.toLowerCase());
                        const normalizedName = entry.name?.toLowerCase() ?? '';
                        if (normalizedName) {
                                searchTerms.add(normalizedName);
                                normalizedName.split(/\s+/).forEach((word) => {
                                        if (word) {
                                                searchTerms.add(word);
                                        }
                                });
                        }
                        const suggestion: MentionSuggestion = {
                                id: underscoreSlug,
                                type: 'emoji',
                                label,
                                description,
                                accentColor: null,
                                special: null,
                                emoji,
                                searchTerms: Array.from(searchTerms)
                        };
                        emojiSuggestionPool.push(suggestion);
                        const keys = [underscoreSlug.toLowerCase(), slug.toLowerCase()];
                        for (const key of keys) {
                                if (!emojiSuggestionIndex.has(key)) {
                                        emojiSuggestionIndex.set(key, suggestion);
                                }
                        }
                }
        }

        emojiSuggestionPool.sort((a, b) => a.label.localeCompare(b.label));
        function memberUserId(member: DtoMember | null | undefined): string | null {
                if (!member) return null;
                return (
                        toSnowflakeString((member as any)?.user?.id) ?? toSnowflakeString((member as any)?.id) ?? null
                );
        }

        const VOICE_CHANNEL_TYPES = new Set([1, 3]);

        function detectChannelKind(channel: DtoChannel | null | undefined): ChannelKind {
                const type = Number((channel as any)?.type ?? 0);
                if (VOICE_CHANNEL_TYPES.has(type)) {
                        return 'voice';
                }
                return 'text';
        }

        function isCategoryChannel(channel: DtoChannel | null | undefined): boolean {
                return Number((channel as any)?.type ?? 0) === 2;
        }

        function formatUserDisplayName(candidate: any): string | null {
                if (!candidate || typeof candidate !== 'object') return null;
                const fields = [
                        candidate.global_name,
                        candidate.globalName,
                        candidate.display_name,
                        candidate.displayName,
                        candidate.username,
                        candidate.name,
                        candidate.nick,
                        candidate.nickname
                ];
                for (const field of fields) {
                        if (typeof field !== 'string') continue;
                        const trimmed = field.trim();
                        if (trimmed) return trimmed;
                }
                return null;
        }

        function fallbackUserLabel(userId: string): string {
                if (!userId) return '@Unknown';
                const suffix = userId.length > 4 ? userId.slice(-4) : userId;
                return `@User ${suffix}`;
        }

        function activeDmChannel(): DtoChannel | null {
                const channelId = $selectedChannelId;
                if (!channelId) return null;
                const dmChannels = ($channelsByGuild['@me'] ?? []) as DtoChannel[];
                return (
                        dmChannels.find((candidate) => toSnowflakeString((candidate as any)?.id) === channelId) ??
                        null
                );
        }

        function gatherDmRecipients(): DtoUser[] {
                const channel = activeDmChannel();
                if (!channel) return [];
                const recipients = Array.isArray((channel as any)?.recipients)
                        ? ((channel as any)?.recipients as DtoUser[])
                        : [];
                const direct = (channel as any)?.recipient;
                if (direct) {
                        recipients.push(direct as DtoUser);
                }
                const seen = new Set<string>();
                const result: DtoUser[] = [];
                for (const entry of recipients) {
                        const id = toSnowflakeString((entry as any)?.id);
                        if (!id || seen.has(id)) continue;
                        seen.add(id);
                        result.push(entry);
                }
                return result;
        }

        function resolveUserMentionDetails(userId: string): {
                label: string;
                accentColor: string | null;
                member: DtoMember | null;
                user: DtoUser | null;
        } {
                const guildId = $selectedGuildId;
                const member = guildId && guildId !== '@me' ? (mentionMemberMap.get(userId) ?? null) : null;
                const userFromMember = (member as any)?.user as DtoUser | undefined;
                let dmUser: DtoUser | null = null;
                if (!member) {
                        const dmCandidates = gatherDmRecipients();
                        dmUser = dmCandidates.find((entry) => toSnowflakeString((entry as any)?.id) === userId) ?? null;
                }
                const user: DtoUser | null = (userFromMember ?? dmUser ?? null) as DtoUser | null;
                const name = memberPrimaryName(member) || formatUserDisplayName(user) || fallbackUserLabel(userId);
                return {
                        label: `@${name.replace(/^@+/, '').trim()}`,
                        accentColor: MENTION_ACCENT_COLORS.user,
                        member,
                        user
                };
        }

        function resolveRoleMentionDetails(roleId: string): {
                label: string;
                accentColor: string | null;
        } {
                const role = mentionRoleMap[roleId] ?? null;
                if (!role) {
                        return { label: `@Role ${roleId}`, accentColor: MENTION_ACCENT_COLORS.role };
                }
                const name = typeof (role as any)?.name === 'string' ? (role as any).name : `Role ${roleId}`;
                return {
                        label: `@${String(name)}`,
                        accentColor: MENTION_ACCENT_COLORS.role
                };
        }

        function resolveChannelMentionDetails(
                channelId: string,
                channel?: DtoChannel | null
        ): { label: string; accentColor: string | null; channelKind: ChannelKind } {
                const guildId = $selectedGuildId ?? '';
                const list = ($channelsByGuild[guildId] ?? []) as DtoChannel[];
                const resolvedChannel = channel ?? list.find((candidate) => {
                        return toSnowflakeString((candidate as any)?.id) === channelId;
                });
                const kind = detectChannelKind(resolvedChannel);
                const rawName = (resolvedChannel as any)?.name;
                const baseName =
                        typeof rawName === 'string' && rawName.trim() ? rawName.trim() : `channel-${channelId}`;
                const sanitized = baseName.replace(/^#+/, '');
                const label = kind === 'voice' ? sanitized : `#${sanitized}`;
                return {
                        label,
                        accentColor: MENTION_ACCENT_COLORS.channel,
                        channelKind: kind
                };
        }

        function mentionDisplayDetails(
                mention: MentionMatch
        ): { label: string; accentColor: string | null; channelKind?: ChannelKind } {
                if (mention.special === 'everyone' || mention.special === 'here') {
                        return {
                                label: `@${mention.special}`,
                                accentColor: MENTION_ACCENT_COLORS.user
                        };
                }
                if (mention.type === 'user') {
                        const details = resolveUserMentionDetails(mention.id);
                        return { label: details.label, accentColor: details.accentColor };
                }
                if (mention.type === 'role') {
                        const details = resolveRoleMentionDetails(mention.id);
                        return { label: details.label, accentColor: details.accentColor };
                }
                const details = resolveChannelMentionDetails(mention.id);
                return {
                        label: details.label,
                        accentColor: details.accentColor,
                        channelKind: details.channelKind
                };
        }

        function formatUserDescriptor(user: DtoUser | null | undefined): string | null {
                if (!user) return null;
                const name = formatUserDisplayName(user);
                const discriminator = (user as any)?.discriminator;
                if (typeof name === 'string' && typeof discriminator === 'string' && discriminator.trim()) {
                        return `${name}#${discriminator.trim()}`;
                }
                return name;
        }

        function buildUserSuggestions(): MentionSuggestion[] {
                const suggestions: MentionSuggestion[] = [];
                const seen = new Set<string>();
                const guildId = $selectedGuildId;

                if (guildId && guildId !== '@me') {
                        for (const [id, member] of mentionMemberMap.entries()) {
                                if (!id || seen.has(`user:${id}`)) continue;
                                seen.add(`user:${id}`);
                                const details = resolveUserMentionDetails(id);
                                suggestions.push({
                                        id,
                                        type: 'user',
                                        label: details.label,
                                        description: formatUserDescriptor(details.user),
                                        accentColor: details.accentColor,
                                        member,
                                        user: details.user,
                                        special: null
                                });
                        }
                } else {
                        for (const user of gatherDmRecipients()) {
                                const id = toSnowflakeString((user as any)?.id);
                                if (!id || seen.has(`user:${id}`)) continue;
                                seen.add(`user:${id}`);
                                const name = formatUserDisplayName(user) || fallbackUserLabel(id);
                                suggestions.push({
                                        id,
                                        type: 'user',
                                        label: `@${name.replace(/^@+/, '').trim()}`,
                                        description: formatUserDescriptor(user),
                                        accentColor: MENTION_ACCENT_COLORS.user,
                                        member: null,
                                        user,
                                        special: null
                                });
                        }
                }

                return suggestions;
        }

        function buildRoleSuggestions(): MentionSuggestion[] {
                const guildId = $selectedGuildId;
                if (!guildId || guildId === '@me') {
                        return [];
                }
                const suggestions: MentionSuggestion[] = [];
                for (const [roleId, role] of Object.entries(mentionRoleMap)) {
                        if (!roleId) continue;
                        const details = resolveRoleMentionDetails(roleId);
                        suggestions.push({
                                id: roleId,
                                type: 'role',
                                label: details.label,
                                description: (role as any)?.description ?? null,
                                accentColor: details.accentColor,
                                member: null,
                                user: null,
                                special: null
                        });
                }
                return suggestions;
        }

        function buildChannelSuggestions(): MentionSuggestion[] {
                const guildId = $selectedGuildId;
                if (!guildId || guildId === '@me') {
                        return [];
                }
                const suggestions: MentionSuggestion[] = [];
                const list = ($channelsByGuild[guildId] ?? []) as DtoChannel[];
                for (const channel of list) {
                        if (isCategoryChannel(channel)) continue;
                        const id = toSnowflakeString((channel as any)?.id);
                        if (!id) continue;
                        const details = resolveChannelMentionDetails(id, channel);
                        suggestions.push({
                                id,
                                type: 'channel',
                                label: details.label,
                                description: (channel as any)?.topic ?? null,
                                accentColor: details.accentColor,
                                member: null,
                                user: null,
                                channelKind: details.channelKind,
                                special: null
                        });
                }
                return suggestions;
        }

        function buildBroadcastSuggestions(): MentionSuggestion[] {
                const guildId = $selectedGuildId;
                if (!guildId || guildId === '@me') {
                        return [];
                }
                return [
                        {
                                id: 'everyone',
                                type: 'user',
                                label: '@everyone',
                                description: null,
                                accentColor: MENTION_ACCENT_COLORS.user,
                                member: null,
                                user: null,
                                special: 'everyone'
                        },
                        {
                                id: 'here',
                                type: 'user',
                                label: '@here',
                                description: null,
                                accentColor: MENTION_ACCENT_COLORS.user,
                                member: null,
                                user: null,
                                special: 'here'
                        }
                ];
        }
        function updateMentionSuggestionList(trigger: SuggestionTrigger | null) {
                if (!trigger) {
                        const hadQuery = mentionQuery !== null;
                        const hadSuggestions = mentionSuggestions.length > 0;
                        const hadIndex = mentionActiveIndex !== 0;

                        if (!hadQuery && !hadSuggestions && !hadIndex) {
                                mentionMenuPosition = null;
                                activeTokenInfo = null;
                                return;
                        }

                        if (hadQuery) {
                                mentionQuery = null;
                        }
                        if (hadSuggestions) {
                                mentionSuggestions = [];
                        }
                        if (hadIndex) {
                                mentionActiveIndex = 0;
                        }
                        mentionMenuPosition = null;
                        activeTokenInfo = null;
                        return;
                }

                const previousQuery = mentionQuery;
                const previousSuggestions = mentionSuggestions;
                const previousIndex = mentionActiveIndex;

                const previousKey = previousQuery
                        ? `${previousQuery.trigger}:${previousQuery.start}:${previousQuery.query}`
                        : null;
                const nextKey = `${trigger.trigger}:${trigger.start}:${trigger.query}`;
                const queryChanged = previousKey !== nextKey;

                const normalizedQuery =
                        trigger.trigger === '@'
                                ? trigger.query.replace(/^&/, '').trim().toLowerCase()
                                : trigger.query.trim().toLowerCase();

                let pool: MentionSuggestion[] = [];
                if (trigger.trigger === '@') {
                        const combined = [
                                ...buildBroadcastSuggestions(),
                                ...buildUserSuggestions(),
                                ...buildRoleSuggestions()
                        ];
                        const deduped = new Map<string, MentionSuggestion>();
                        for (const suggestion of combined) {
                                deduped.set(`${suggestion.type}:${suggestion.id}`, suggestion);
                        }
                        pool = Array.from(deduped.values());
                } else if (trigger.trigger === '#') {
                        pool = buildChannelSuggestions();
                } else {
                        pool = emojiSuggestionPool;
                }

                if (normalizedQuery) {
                        pool = pool.filter((suggestion) => {
                                const label = suggestion.label.toLowerCase();
                                if (label.includes(normalizedQuery)) return true;
                                const desc = suggestion.description?.toLowerCase() ?? '';
                                if (desc.includes(normalizedQuery)) return true;
                                if (suggestion.searchTerms?.length) {
                                        return suggestion.searchTerms.some((term) => term.includes(normalizedQuery));
                                }
                                return false;
                        });
                }

                const nextSuggestions = pool.slice(0, 50);
                const suggestionsChanged =
                        nextSuggestions.length !== previousSuggestions.length ||
                        nextSuggestions.some((suggestion, index) => {
                                const previous = previousSuggestions[index];
                                if (!previous) return true;
                                return (
                                        previous.id !== suggestion.id ||
                                        previous.type !== suggestion.type ||
                                        previous.label !== suggestion.label ||
                                        previous.description !== suggestion.description ||
                                        previous.accentColor !== suggestion.accentColor ||
                                        previous.channelKind !== suggestion.channelKind ||
                                        previous.emoji !== suggestion.emoji
                                );
                        });

                if (!queryChanged && !suggestionsChanged) {
                        return;
                }

                if (queryChanged) {
                        mentionQuery = trigger;
                }

                if (suggestionsChanged) {
                        mentionSuggestions = nextSuggestions;
                }

                if (queryChanged) {
                        mentionActiveIndex = 0;
                } else if (nextSuggestions.length === 0) {
                        mentionActiveIndex = 0;
                } else {
                        mentionActiveIndex = Math.min(previousIndex, Math.max(nextSuggestions.length - 1, 0));
                }
        }
        $effect(() => {
                const guildId = $selectedGuildId;
                const revision = $guildRoleCacheState;
                void revision;
                if (!guildId || guildId === '@me') {
                        mentionRoleMap = {};
                        return;
                }
                const activeGuild = guildId;
                void (async () => {
                        try {
                                const roles = await loadGuildRolesCached(activeGuild);
                                if ($selectedGuildId !== activeGuild) {
                                        return;
                                }
                                mentionRoleMap = buildRoleMap(roles);
                                refreshMentionState();
                        } catch {
                                if ($selectedGuildId === activeGuild) {
                                        mentionRoleMap = {};
                                        refreshMentionState();
                                }
                        }
                })();
        });
        function serializeNode(node: Node | null): string {
                if (!node) return '';
                if (node.nodeType === Node.TEXT_NODE) {
                        return (node.nodeValue ?? '').replace(ZERO_WIDTH_SPACE_REGEX, '');
                }
                if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                        let result = '';
                        node.childNodes.forEach((child) => {
                                result += serializeNode(child);
                        });
                        return result;
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        const special = el.dataset.specialMention as SpecialMention | undefined;
                        if (special === 'everyone' || special === 'here') {
                                return `@${special}`;
                        }
                        if (el.dataset.mentionType && el.dataset.mentionId) {
                                const type = el.dataset.mentionType as MentionType;
                                const id = el.dataset.mentionId ?? '';
                                return mentionPlaceholder(type, id);
                        }
                        const tag = el.tagName.toLowerCase();
                        if (tag === 'br') {
                                return '\n';
                        }
                        let result = '';
                        el.childNodes.forEach((child) => {
                                result += serializeNode(child);
                        });
                        if (tag === 'div' || tag === 'p') {
                                return `${result}\n`;
                        }
                        return result;
                }
                return '';
        }

        function serializeEditorContent(): string {
                if (!editorEl) return '';
                let result = '';
                editorEl.childNodes.forEach((child) => {
                        result += serializeNode(child);
                });
                return result;
        }

        function appendTextContent(container: HTMLElement, text: string) {
                const parts = text.split('\n');
                parts.forEach((part, index) => {
                        if (part) {
                                container.appendChild(document.createTextNode(part));
                        }
                        if (index < parts.length - 1) {
                                container.appendChild(document.createElement('br'));
                        }
                });
        }

        type IconNode = [string, Record<string, string>][];
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const VOLUME2_ICON_NODE: IconNode = [
                [
                        'path',
                        {
                                d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z'
                        }
                ],
                ['path', { d: 'M16 9a5 5 0 0 1 0 6' }],
                ['path', { d: 'M19.364 18.364a9 9 0 0 0 0-12.728' }]
        ];

        function createSvgIcon(node: IconNode): SVGSVGElement {
                const svg = document.createElementNS(SVG_NS, 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                svg.setAttribute('aria-hidden', 'true');
                svg.classList.add('mention-badge__icon');
                for (const [tag, attrs] of node) {
                        const child = document.createElementNS(SVG_NS, tag);
                        for (const [name, value] of Object.entries(attrs)) {
                                child.setAttribute(name, value);
                        }
                        svg.appendChild(child);
                }
                return svg;
        }

        function createMentionBadge(
                mention: MentionMatch,
                details: { label: string; accentColor: string | null; channelKind?: ChannelKind }
        ): HTMLSpanElement {
                const badge = document.createElement('span');
                badge.className = 'mention-badge';
                badge.contentEditable = 'false';
                badge.dataset.mentionType = mention.type;
                badge.dataset.mentionId = mention.id;
                if (mention.special) {
                        badge.dataset.specialMention = mention.special;
                }
                badge.textContent = '';
                if (mention.type === 'channel') {
                        const kind = details.channelKind ?? 'text';
                        badge.dataset.channelKind = kind;
                        if (kind === 'voice') {
                                const icon = createSvgIcon(VOLUME2_ICON_NODE);
                                badge.appendChild(icon);
                        }
                } else {
                        badge.removeAttribute('data-channel-kind');
                }
                const labelEl = document.createElement('span');
                labelEl.className = 'mention-badge__label';
                labelEl.textContent = details.label;
                badge.appendChild(labelEl);
                if (details.accentColor) {
                        badge.style.setProperty('--mention-accent', details.accentColor);
                }
                return badge;
        }

        function pruneTriggerBeforeBadge(badge: HTMLElement) {
                let sibling: ChildNode | null = badge.previousSibling;
                while (sibling && sibling.nodeType !== Node.TEXT_NODE) {
                        sibling = sibling.previousSibling;
                }
                if (!sibling || sibling.nodeType !== Node.TEXT_NODE) return;
                const textNode = sibling as Text;
                const rawValue = textNode.nodeValue ?? '';
                if (!rawValue) return;
                const cleanedValue = rawValue.replace(ZERO_WIDTH_SPACE_REGEX, '');
                if (cleanedValue !== rawValue) {
                        textNode.nodeValue = cleanedValue;
                }
                const value = textNode.nodeValue ?? '';
                if (!value) {
                        textNode.parentNode?.removeChild(textNode);
                        return;
                }
                const match = value.match(/(^|[\s>"'([{])([@#])([^\s@#<>{}]*)$/);
                if (!match) return;
                const token = match[2] + match[3];
                const tokenLength = token.length;
                if (tokenLength === 0) return;
                const startIndex = value.length - tokenLength;
                textNode.deleteData(startIndex, tokenLength);
                if ((textNode.nodeValue ?? '').length === 0) {
                        textNode.parentNode?.removeChild(textNode);
                }
        }

        function renderContentToEditor(text: string) {
                if (!editorEl) return;
                editorEl.innerHTML = '';
                if (!text) {
                        return;
                }
                const segments = splitTextWithMentions(text);
                for (const segment of segments) {
                        if (segment.type === 'text') {
                                appendTextContent(editorEl, segment.value);
                        } else {
                                const details = mentionDisplayDetails(segment.mention);
                                const badge = createMentionBadge(segment.mention, details);
                                editorEl.appendChild(badge);
                        }
                }
        }

        function syncContentFromEditor() {
                const serialized = serializeEditorContent();
                content = serialized;
        }
        function selectionInsideEditor(selection: Selection | null): boolean {
                if (!selection) return false;
                if (!editorEl) return false;
                const anchor = selection.anchorNode;
                const focus = selection.focusNode;
                if (!anchor || !focus) return false;
                return editorEl.contains(anchor) && editorEl.contains(focus);
        }

        function getCaretIndex(): number {
                if (!editorEl) return content.length;
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection || selection.rangeCount === 0) {
                        return content.length;
                }
                if (!selectionInsideEditor(selection)) {
                        return content.length;
                }
                const range = selection.getRangeAt(0).cloneRange();
                range.collapse(true);
                const preRange = range.cloneRange();
                preRange.selectNodeContents(editorEl);
                preRange.setEnd(range.startContainer, range.startOffset);
                const fragment = preRange.cloneContents();
                return serializeNode(fragment).length;
        }

        function getCurrentTokenInfo(): EditorTokenInfo | null {
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection || selection.rangeCount === 0) return null;
                if (!selectionInsideEditor(selection)) return null;
                const range = selection.getRangeAt(0);
                if (!range.collapsed) return null;
                let container = range.startContainer;
                let offset = range.startOffset;

                if (container.nodeType !== Node.TEXT_NODE) {
                        if (container.childNodes.length > 0 && offset > 0) {
                                const candidate = container.childNodes[offset - 1];
                                if (candidate && candidate.nodeType === Node.TEXT_NODE) {
                                        container = candidate;
                                        offset = (candidate.textContent ?? '').length;
                                } else {
                                        return null;
                                }
                        } else {
                                return null;
                        }
                }

                const textNode = container as Text;
                const text = textNode.nodeValue ?? '';
                let start = offset;
                while (start > 0) {
                        const ch = text[start - 1];
                        if (/\s/.test(ch)) break;
                        start -= 1;
                }
                const token = text.slice(start, offset);
                if (!token || token.length < 2) return null;
                const trigger = token[0];
                if (trigger !== '@' && trigger !== '#' && trigger !== ':') return null;
                if (/\s/.test(trigger)) return null;
                return {
                        trigger,
                        query: token.slice(1),
                        node: textNode,
                        start,
                        end: offset
                };
        }

        function clamp(value: number, min: number, max: number): number {
                return Math.min(Math.max(value, min), max);
        }

        const EMOJI_TRIGGER_PATTERN = /(^|[\s>"'([{]):([a-z0-9_\-+]{1,})(:?$)/i;

        function detectEmojiTrigger(content: string, cursor: number): EmojiTrigger | null {
                if (!content) return null;
                if (cursor < 0 || cursor > content.length) return null;
                const before = content.slice(0, cursor);
                const match = before.match(EMOJI_TRIGGER_PATTERN);
                if (!match) return null;
                const [, , rawQuery = '', terminator = ''] = match;
                const query = rawQuery.trim();
                if (!query) return null;
                const hasTerminator = Boolean(terminator);
                const start = cursor - query.length - 1 - (hasTerminator ? 1 : 0);
                if (start < 0) return null;
                return {
                        trigger: ':',
                        start,
                        query,
                        hasTerminator
                };
        }

        function updateMentionMenuPosition() {
                if (typeof window === 'undefined') return;
                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0) return;
                if (!selectionInsideEditor(selection)) return;
                const range = selection.getRangeAt(0).cloneRange();
                range.collapse(true);
                let rect = range.getBoundingClientRect();
                if (!rect || (rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0)) {
                        const rects = range.getClientRects();
                        if (rects.length > 0) {
                                rect = rects[0];
                        }
                }
                if (!rect) return;

                if (!mentionMenuEl) {
                        void tick().then(() => {
                                if (mentionMenuOpen) {
                                        updateMentionMenuPosition();
                                }
                        });
                }

                const viewportPadding = 12;
                const menuEl = mentionMenuEl;
                const menuWidth = menuEl?.offsetWidth ?? 0;
                const menuHeight = menuEl?.offsetHeight ?? 0;
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const spacing = 8;

                let left = rect.left;
                if (menuWidth > 0) {
                        const maxLeft = Math.max(viewportPadding, viewportWidth - menuWidth - viewportPadding);
                        left = Math.min(Math.max(viewportPadding, left), maxLeft);
                } else {
                        left = clamp(left, viewportPadding, viewportWidth - viewportPadding);
                }

                const maxTopWithMenu = menuHeight > 0
                        ? Math.max(viewportPadding, viewportHeight - menuHeight - viewportPadding)
                        : viewportHeight - viewportPadding;
                const preferredTop = menuHeight > 0
                        ? rect.top - spacing - menuHeight
                        : rect.top - spacing;
                const fallbackTop = rect.bottom + spacing;

                let top = preferredTop;
                if (menuHeight > 0) {
                        if (preferredTop < viewportPadding && fallbackTop <= maxTopWithMenu) {
                                top = Math.min(Math.max(viewportPadding, fallbackTop), maxTopWithMenu);
                        } else {
                                top = clamp(preferredTop, viewportPadding, maxTopWithMenu);
                        }
                } else {
                        top = clamp(preferredTop, viewportPadding, maxTopWithMenu);
                        if (top === viewportPadding && fallbackTop < maxTopWithMenu) {
                                top = Math.min(Math.max(viewportPadding, fallbackTop), maxTopWithMenu);
                        }
                }

                mentionMenuPosition = { left, top };
        }

        function refreshMentionState() {
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection || selection.rangeCount === 0 || !selectionInsideEditor(selection)) {
                        updateMentionSuggestionList(null);
                        return;
                }
                const cursor = getCaretIndex();
                const mentions = parseMentions(content);
                const mentionBeforeCursor = cursor > 0 ? findMentionAtIndex(mentions, cursor - 1) : null;
                if (mentionBeforeCursor) {
                        updateMentionSuggestionList(null);
                        return;
                }
                const mentionTrigger = detectMentionTrigger(content, cursor);
                if (mentionTrigger) {
                        activeTokenInfo = getCurrentTokenInfo();
                        updateMentionSuggestionList(mentionTrigger);
                        updateMentionMenuPosition();
                        scrollActiveSuggestionIntoView();
                        return;
                }
                const emojiTrigger = detectEmojiTrigger(content, cursor);
                if (emojiTrigger) {
                        const info = getCurrentTokenInfo();
                        if (emojiTrigger.hasTerminator) {
                                const normalized = emojiTrigger.query.toLowerCase();
                                const underscore = normalized.replace(/-/g, '_');
                                const direct = emojiSuggestionIndex.get(underscore) ??
                                        emojiSuggestionIndex.get(normalized);
                                if (direct) {
                                        activeTokenInfo = info;
                                        void applyMentionSuggestion(direct);
                                        return;
                                }
                        }
                        activeTokenInfo = info;
                        updateMentionSuggestionList(emojiTrigger);
                        updateMentionMenuPosition();
                        scrollActiveSuggestionIntoView();
                        return;
                }
                updateMentionSuggestionList(null);
        }
        async function applyMentionSuggestion(suggestion: MentionSuggestion) {
                if (!editorEl) return;
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection) return;
                const info = activeTokenInfo ?? getCurrentTokenInfo();
                if (suggestion.type === 'emoji') {
                        const emoji = suggestion.emoji ?? '';
                        if (!info || !emoji) {
                                return;
                        }
                        const range = selection.getRangeAt(0).cloneRange();
                        range.setStart(info.node, info.start);
                        range.setEnd(info.node, info.end);
                        range.deleteContents();
                        const textNode = document.createTextNode(emoji);
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                        editorEl.focus();
                        syncContentFromEditor();
                        updateMentionSuggestionList(null);
                        handleTypingActivity(content);
                        await tick();
                        refreshMentionState();
                        return;
                }
                const isSpecial = suggestion.special === 'everyone' || suggestion.special === 'here';
                let mention: MentionMatch;
                if (isSpecial) {
                        const specialId = suggestion.special as SpecialMention;
                        mention = {
                                type: 'user',
                                id: specialId,
                                start: 0,
                                end: 0,
                                raw: `@${specialId}`,
                                special: specialId
                        };
                } else {
                        mention = {
                                type: suggestion.type,
                                id: suggestion.id,
                                start: 0,
                                end: 0,
                                raw: mentionPlaceholder(suggestion.type, suggestion.id),
                                special: null
                        };
                }
                const details = isSpecial
                        ? { label: `@${suggestion.special}`, accentColor: MENTION_ACCENT_COLORS.user }
                        : suggestion.type === 'channel'
                        ? {
                                  label: suggestion.label,
                                  accentColor: suggestion.accentColor,
                                  channelKind: suggestion.channelKind ?? 'text'
                          }
                        : { label: suggestion.label, accentColor: suggestion.accentColor };
                const badge = createMentionBadge(mention, details);

                if (info) {
                        const node = info.node;
                        const text = node.nodeValue ?? '';
                        const before = text.slice(0, info.start);
                        const after = text.slice(info.end);
                        const fragment = document.createDocumentFragment();
                        if (before) {
                                fragment.appendChild(document.createTextNode(before));
                        }
                        fragment.appendChild(badge);
                        if (after) {
                                fragment.appendChild(document.createTextNode(after));
                        }
                        node.parentNode?.replaceChild(fragment, node);
                } else {
                        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                        if (range) {
                                range.deleteContents();
                                const fragment = document.createDocumentFragment();
                                fragment.appendChild(badge);
                                range.insertNode(fragment);
                        } else {
                                editorEl.appendChild(badge);
                        }
                }

                pruneTriggerBeforeBadge(badge);

                if (badge.parentNode) {
                        const range = document.createRange();
                        const nextSibling = badge.nextSibling;
                        if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
                                range.setStart(nextSibling, 0);
                        } else {
                                range.setStartAfter(badge);
                        }
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                }
                editorEl.focus();

                syncContentFromEditor();
                updateMentionSuggestionList(null);
                handleTypingActivity(content);
                await tick();
                refreshMentionState();
        }

        function handleMentionClick(index: number) {
                const suggestion = mentionSuggestions[index];
                if (!suggestion) return;
                void applyMentionSuggestion(suggestion);
        }
        function removeMentionElement(el: HTMLElement): { node: Node; offset: number } | null {
                const parent = el.parentNode;
                if (!parent) return null;
                const index = Array.prototype.indexOf.call(parent.childNodes, el);
                const next = el.nextSibling;
                el.remove();
                if (next && next.nodeType === Node.TEXT_NODE) {
                        const text = next as Text;
                        // Strip any spacer characters we may have injected after the mention
                        while (true) {
                                const value = text.nodeValue ?? '';
                                if (value.startsWith(' ') || value.startsWith(ZERO_WIDTH_SPACE)) {
                                        text.deleteData(0, 1);
                                        continue;
                                }
                                break;
                        }
                        if (((text.nodeValue ?? '').replace(ZERO_WIDTH_SPACE_REGEX, '')).length === 0) {
                                next.parentNode?.removeChild(next);
                        }
                }

                const before = parent.childNodes[index - 1];
                const after = parent.childNodes[index] ?? null;

                if (before && before.nodeType === Node.TEXT_NODE) {
                        const text = before as Text;
                        return { node: text, offset: (text.nodeValue ?? '').length };
                }

                if (after && after.nodeType === Node.TEXT_NODE) {
                        return { node: after, offset: 0 };
                }

                return { node: parent, offset: index }; 
        }

        function handleMentionDeletion(event: KeyboardEvent): boolean {
                if (!editorEl) return false;
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection || selection.rangeCount === 0) return false;
                if (!selectionInsideEditor(selection)) return false;
                if (!selection.isCollapsed) return false;
                const range = selection.getRangeAt(0);

                if (event.key === 'Backspace') {
                        if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
                                return false;
                        }
                        let container = range.startContainer;
                        let offset = range.startOffset;
                        if (container.nodeType === Node.TEXT_NODE) {
                                container = container.parentNode as Node;
                                offset = Array.prototype.indexOf.call(container.childNodes, range.startContainer);
                        }
                        if (!container || container.nodeType !== Node.ELEMENT_NODE) return false;
                        const target = (container.childNodes[offset - 1] ?? container.previousSibling) as Node | null;
                        const element =
                                target?.nodeType === Node.ELEMENT_NODE
                                        ? (target as HTMLElement)
                                        : null;
                        if (element && element.dataset?.mentionType && element.dataset?.mentionId) {
                                event.preventDefault();
                                const caret = removeMentionElement(element);
                                syncContentFromEditor();
                                refreshMentionState();
                                handleTypingActivity(content);
                                if (caret) {
                                        const sel = window.getSelection();
                                        const caretRange = document.createRange();
                                        caretRange.setStart(caret.node, caret.offset);
                                        caretRange.collapse(true);
                                        sel?.removeAllRanges();
                                        sel?.addRange(caretRange);
                                }
                                return true;
                        }
                }

                if (event.key === 'Delete') {
                        if (
                                range.startContainer.nodeType === Node.TEXT_NODE &&
                                range.startOffset < (range.startContainer.nodeValue ?? '').length
                        ) {
                                return false;
                        }
                        let container = range.startContainer;
                        let offset = range.startOffset;
                        if (container.nodeType === Node.TEXT_NODE) {
                                container = container.parentNode as Node;
                                offset = Array.prototype.indexOf.call(container.childNodes, range.startContainer) + 1;
                        }
                        if (!container || container.nodeType !== Node.ELEMENT_NODE) return false;
                        const target = container.childNodes[offset] ?? container.nextSibling;
                        const element =
                                target && target.nodeType === Node.ELEMENT_NODE
                                        ? (target as HTMLElement)
                                        : null;
                        if (element && element.dataset?.mentionType && element.dataset?.mentionId) {
                                event.preventDefault();
                                const caret = removeMentionElement(element);
                                syncContentFromEditor();
                                refreshMentionState();
                                handleTypingActivity(content);
                                if (caret) {
                                        const sel = window.getSelection();
                                        const caretRange = document.createRange();
                                        caretRange.setStart(caret.node, caret.offset);
                                        caretRange.collapse(true);
                                        sel?.removeAllRanges();
                                        sel?.addRange(caretRange);
                                }
                                return true;
                        }
                }

                return false;
        }
        function handleEditorInput() {
                syncContentFromEditor();
                handleTypingActivity(content);
                refreshMentionState();
        }

        async function handleEditorKeydown(event: KeyboardEvent) {
                if (mentionMenuOpen && mentionSuggestions.length > 0) {
                        if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                mentionActiveIndex = (mentionActiveIndex + 1) % mentionSuggestions.length;
                                scrollActiveSuggestionIntoView();
                                return;
                        }
                        if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                mentionActiveIndex =
                                        (mentionActiveIndex - 1 + mentionSuggestions.length) % mentionSuggestions.length;
                                scrollActiveSuggestionIntoView();
                                return;
                        }
                        if (event.key === 'Enter' || event.key === 'Tab') {
                                event.preventDefault();
                                const selected = mentionSuggestions[mentionActiveIndex];
                                if (selected) {
                                        await applyMentionSuggestion(selected);
                                }
                                return;
                        }
                        if (event.key === 'Escape') {
                                event.preventDefault();
                                updateMentionSuggestionList(null);
                                return;
                        }
                }

                if (event.key === 'Backspace' || event.key === 'Delete') {
                        if (handleMentionDeletion(event)) {
                                return;
                        }
                }

                if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        send();
                        return;
                }
        }

        function handleEditorFocus() {
                editorFocused = true;
                refreshMentionState();
        }

        function handleEditorBlur() {
                editorFocused = false;
                updateMentionSuggestionList(null);
        }

        function insertTextAtSelection(text: string) {
                if (!editorEl) {
                        content = `${content}${text}`;
                        return;
                }
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection || selection.rangeCount === 0) {
                        editorEl.appendChild(document.createTextNode(text));
                        syncContentFromEditor();
                        handleTypingActivity(content);
                        refreshMentionState();
                        return;
                }
                const range = selection.getRangeAt(0);
                if (!range) {
                        editorEl.appendChild(document.createTextNode(text));
                        syncContentFromEditor();
                        handleTypingActivity(content);
                        refreshMentionState();
                        return;
                }
                range.deleteContents();
                const node = document.createTextNode(text);
                range.insertNode(node);
                const caret = document.createRange();
                caret.setStart(node, node.length);
                caret.collapse(true);
                selection.removeAllRanges();
                selection.addRange(caret);
                editorEl.focus();
                syncContentFromEditor();
                handleTypingActivity(content);
                refreshMentionState();
        }
        function scrollActiveSuggestionIntoView() {
                const container = mentionListEl;
                if (!container) return;
                const target = container.querySelector<HTMLElement>(
                        `[data-mention-index="${mentionActiveIndex}"]`
                );
                if (!target) return;
                const top = target.offsetTop;
                const bottom = top + target.offsetHeight;
                const viewTop = container.scrollTop;
                const viewBottom = viewTop + container.clientHeight;
                if (top < viewTop) {
                        container.scrollTop = top;
                        return;
                }
                if (bottom > viewBottom) {
                        container.scrollTop = bottom - container.clientHeight;
                }
        }
        const TYPING_RENEWAL_INTERVAL_MS = 10_000;

        function clearTypingTimer() {
                if (typingResetTimer) {
                        clearTimeout(typingResetTimer);
                        typingResetTimer = null;
                }
        }

        function resetTypingState() {
                typingActive = false;
                typingLastSentAt = 0;
                typingChannelId = null;
                clearTypingTimer();
        }

        async function postTypingIndicator(channelId: string) {
                const messageApi = auth.api.message;
                if (!messageApi?.messageChannelChannelIdTypingPost) {
                        return;
                }
                await messageApi.messageChannelChannelIdTypingPost({
                        channelId: channelId as any
                });
        }

        async function dispatchTypingIndicator(channelId: string) {
                typingChannelId = channelId;
                typingActive = true;
                typingLastSentAt = Date.now();
                clearTypingTimer();
                typingResetTimer = setTimeout(() => {
                        typingActive = false;
                        typingResetTimer = null;
                }, TYPING_RENEWAL_INTERVAL_MS);
                try {
                        await postTypingIndicator(channelId);
                } catch (error) {
                        console.debug('Failed to send typing indicator', error);
                }
        }

        function handleTypingActivity(value: string) {
                const trimmed = value.trim();
                if (!trimmed) {
                        resetTypingState();
                        return;
                }
                const channelId = $selectedChannelId;
                if (!channelId) {
                        return;
                }
                const now = Date.now();
                const shouldSend =
                        !typingActive || channelId !== typingChannelId || now - typingLastSentAt >= TYPING_RENEWAL_INTERVAL_MS;
                if (shouldSend) {
                        void dispatchTypingIndicator(channelId);
                }
        }
        function hasFileTransfer(event: DragEvent): boolean {
                const dt = event.dataTransfer;
                if (!dt) return false;
                if (dt.files && dt.files.length > 0) return true;
                const types = dt.types ? Array.from(dt.types) : [];
                return types.includes('Files');
        }

        function mergeAttachments(added: readonly PendingAttachment[] | null | undefined) {
                if (!added || added.length === 0) {
                        return;
                }

                const next: PendingAttachment[] = attachments.slice();

                for (const incoming of added) {
                        const index = next.findIndex((attachment) => attachment.localId === incoming.localId);
                        const isOversizeError =
                                incoming.status === 'error' && incoming.error === 'File size is too big';

                        if (isOversizeError) {
                                if (index !== -1) {
                                        const [removed] = next.splice(index, 1);
                                        if (removed) {
                                                releasePreviewUrl(removed);
                                        }
                                }
                                continue;
                        }

                        if (index !== -1) {
                                const previous = next[index];
                                if (previous.previewUrl && previous.previewUrl !== incoming.previewUrl) {
                                        releasePreviewUrl(previous);
                                }
                                next[index] = incoming;
                                continue;
                        }

                        next.push(incoming);
                }

                attachments = next;
        }

        async function handleDroppedFiles(files: FileList | null | undefined) {
                if (!files || files.length === 0) return;
                if (!uploaderRef?.addFiles) return;
                try {
                        const added = await uploaderRef.addFiles(files);
                        mergeAttachments(added ?? []);
                } catch (err) {
                        console.error('Failed to add dropped files', err);
                }
        }

        function handleDragEnter(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                dragCounter += 1;
                dropActive = true;
        }

        function handleDragOver(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = 'copy';
                }
        }

        function handleDragLeave(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                dragCounter = Math.max(0, dragCounter - 1);
                if (dragCounter === 0) {
                        dropActive = false;
                }
        }

        function handleDragEnd(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                dragCounter = 0;
                dropActive = false;
        }

        async function handleDrop(event: DragEvent) {
                if (!hasFileTransfer(event)) return;
                event.preventDefault();
                dragCounter = 0;
                dropActive = false;
                await handleDroppedFiles(event.dataTransfer?.files ?? null);
                event.dataTransfer?.clearData();
        }

        function releasePreviewUrl(attachment: PendingAttachment | undefined) {
                if (!attachment?.previewUrl) return;
                if (!attachment.previewUrl.startsWith('blob:')) return;
                try {
                        URL.revokeObjectURL(attachment.previewUrl);
                } catch {
                        /* ignore */
                }
        }

        function clearLocalAttachments(options?: { releasePreviews?: boolean }) {
                const shouldRelease = options?.releasePreviews ?? false;
                if (shouldRelease) {
                        for (const attachment of attachments) {
                                releasePreviewUrl(attachment);
                        }
                }
                attachments = [];
        }

        function removeAttachment(localId: string) {
                const index = attachments.findIndex((attachment) => attachment.localId === localId);
                if (index === -1) return;
                const [removed] = attachments.splice(index, 1);
                attachments = [...attachments];
                releasePreviewUrl(removed);
        }

        function createLocalMessageId(): string {
                if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                        return crypto.randomUUID();
                }
                return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }

        function cloneAttachmentForSend(attachment: PendingAttachment): PendingAttachment {
                let previewUrl = attachment.previewUrl;
                if (previewUrl && previewUrl.startsWith('blob:')) {
                        try {
                                previewUrl = URL.createObjectURL(attachment.file);
                        } catch {
                                previewUrl = attachment.previewUrl;
                        }
                }
                return {
                        ...attachment,
                        previewUrl,
                        status: 'queued',
                        progress: 0,
                        uploadedBytes: 0,
                        error: null
                };
        }
        async function send() {
                const channelId = $selectedChannelId;
                const trimmedContent = content.trim();
                if (!channelId || (!trimmedContent && attachments.length === 0)) return;
                sending = true;

                const localMessageId = createLocalMessageId();
                const attachmentsForSend = attachments.map(cloneAttachmentForSend);
                const pendingMessage: PendingMessage = {
                        localId: localMessageId,
                        channelId,
                        content: trimmedContent,
                        createdAt: new Date(),
                        attachments: attachmentsForSend,
                        status: 'pending',
                        error: null
                };

                addPendingMessage(pendingMessage);

                content = '';
                updateMentionSuggestionList(null);
                resetTypingState();
                typingChannelId = $selectedChannelId ?? null;
                clearLocalAttachments({ releasePreviews: true });
                await tick();
                if (editorEl) {
                        editorEl.innerHTML = '';
                        editorEl.focus();
                }
                dispatch('sent');
                sending = false;

                await processPendingMessage(pendingMessage);
        }

        function getErrorMessage(err: unknown): string {
                const error = err as { response?: { data?: { message?: string } }; message?: string };
                return error.response?.data?.message ?? error.message ?? 'Failed to send message';
        }

        async function uploadAttachmentWithProgress(
                channelId: bigint,
                attachment: PendingAttachment,
                onProgress: (uploaded: number, total: number) => void
        ) {
                if (!attachment.attachmentId) {
                        throw new Error('Missing attachment id');
                }

                const totalBytes = attachment.file.size || 0;

                await auth.api.upload.uploadAttachmentsChannelIdAttachmentIdPost(
                        {
                                channelId: channelId as any,
                                attachmentId: attachment.attachmentId as any,
                                requestBody: attachment.file as any
                        },
                        {
                                headers: {
                                        'Content-Type': attachment.mimeType || 'application/octet-stream'
                                },
                                onUploadProgress: (event) => {
                                        const uploaded = typeof event.loaded === 'number' ? event.loaded : 0;
                                        const total =
                                                typeof event.total === 'number' && event.total > 0 ? event.total : totalBytes;
                                        onProgress(uploaded, total > 0 ? total : totalBytes);
                                }
                        }
                );
        }

        async function processPendingMessage(message: PendingMessage) {
                const { localId, attachments: pendingAttachments, content: messageContent, channelId } = message;
                const successfulIds: bigint[] = [];

                let channelSnowflake: bigint;
                try {
                        channelSnowflake = BigInt(channelId);
                } catch {
                        updatePendingMessage(localId, (current) => ({
                                ...current,
                                status: 'error',
                                error: 'Invalid channel id'
                        }));
                        return;
                }

                for (const attachment of pendingAttachments) {
                        if (attachment.attachmentId == null) {
                                updatePendingAttachment(localId, attachment.localId, () => ({
                                        ...attachment,
                                        status: 'error',
                                        progress: 0,
                                        uploadedBytes: 0,
                                        error: 'Missing attachment metadata'
                                }));
                                continue;
                        }

                        updatePendingAttachment(localId, attachment.localId, () => ({
                                ...attachment,
                                status: 'uploading',
                                progress: 0,
                                uploadedBytes: 0,
                                error: null
                        }));

                        try {
                                await uploadAttachmentWithProgress(channelSnowflake, attachment, (uploaded, total) => {
                                        updatePendingAttachment(localId, attachment.localId, (current) => ({
                                                ...current,
                                                status: 'uploading',
                                                progress: total > 0 ? uploaded / total : 0,
                                                uploadedBytes: uploaded,
                                                error: null
                                        }));
                                });
                                successfulIds.push(BigInt(attachment.attachmentId));
                                updatePendingAttachment(localId, attachment.localId, (current) => ({
                                        ...current,
                                        status: 'success',
                                        progress: 1,
                                        uploadedBytes: attachment.file.size,
                                        error: null
                                }));
                        } catch (error) {
                                console.error('Failed to upload attachment', error);
                                updatePendingAttachment(localId, attachment.localId, (current) => ({
                                        ...current,
                                        status: 'error',
                                        progress: 0,
                                        uploadedBytes: 0,
                                        error: getErrorMessage(error)
                                }));
                        }
                }

                try {
                        await auth.api.message.messageChannelChannelIdPost({
                                channelId: channelSnowflake as any,
                                messageSendMessageRequest: {
                                        content: messageContent,
                                        attachments: successfulIds as any
                                }
                        });
                        removePendingMessage(localId);
                } catch (error) {
                        console.error('Failed to send message', error);
                        updatePendingMessage(localId, (current) => ({
                                ...current,
                                status: 'error',
                                error: getErrorMessage(error)
                        }));
                }
        }
        async function insertEmoji(emoji: string) {
                if (!emoji) return;
                insertTextAtSelection(emoji);
        }

        async function handleEmojiSelection(emoji: string) {
                await insertEmoji(emoji);
                closeEmojiMenu();
        }

        async function openEmojiMenu() {
                showEmojiPicker = true;
                await tick();
                emojiPickerRef?.clearSearch?.();
                emojiPickerRef?.scrollToTop?.();
                emojiMenuEl?.focus?.();
        }

        function closeEmojiMenu() {
                showEmojiPicker = false;
        }

        async function toggleEmojiMenu() {
                if (showEmojiPicker) {
                        closeEmojiMenu();
                } else {
                        await openEmojiMenu();
                }
        }

        function handleGlobalPointerDown(event: PointerEvent) {
                const target = event.target as Node | null;
                if (showEmojiPicker && emojiMenuEl && !emojiMenuEl.contains(target as Node) && target !== emojiButton) {
                        closeEmojiMenu();
                }
                if (mentionMenuOpen && mentionMenuEl && !mentionMenuEl.contains(target as Node) && !editorEl?.contains(target)) {
                        updateMentionSuggestionList(null);
                }
        }

        function handleGlobalKeydown(event: KeyboardEvent) {
                if (event.key === 'Escape') {
                        if (showEmojiPicker) {
                                closeEmojiMenu();
                        }
                        if (mentionMenuOpen) {
                                updateMentionSuggestionList(null);
                        }
                }
        }
        const VISUAL_ATTACHMENT_PREVIEW_SIZE = 218;
        const visualAttachmentWrapperStyle = `width: min(100%, ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px); max-width: min(100%, ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px);`;
        const visualAttachmentMediaStyle = `width: 100%; height: ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px; object-fit: contain;`;
        const visualAttachmentPlaceholderStyle = `height: ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px;`;

        function currentChannel() {
                const gid = $selectedGuildId ?? '';
                return ($channelsByGuild[gid] ?? []).find((c) => String((c as any).id) === $selectedChannelId);
        }

        function channelName() {
                const ch = currentChannel() as any;
                return (ch?.name ?? '').toString();
        }
        onMount(() => {
                renderContentToEditor(content);
                refreshMentionState();

                if (typeof window === 'undefined') {
                        return;
                }

                const win = window;
                const dragListeners: Array<[keyof WindowEventMap, (event: DragEvent) => void]> = [
                        ['dragenter', handleDragEnter],
                        ['dragover', handleDragOver],
                        ['dragleave', handleDragLeave],
                        ['drop', handleDrop],
                        ['dragend', handleDragEnd]
                ];
                const dragOpts: boolean = true;
                dragListeners.forEach(([event, handler]) => {
                        win.addEventListener(event, handler as EventListener, dragOpts);
                });
                removeGlobalDragListeners = () => {
                        dragListeners.forEach(([event, handler]) => {
                                win.removeEventListener(event, handler as EventListener, dragOpts);
                        });
                };

                const pointerListener = (event: PointerEvent) => {
                        handleGlobalPointerDown(event);
                };
                const keyListener = (event: KeyboardEvent) => {
                        handleGlobalKeydown(event);
                };
                win.addEventListener('pointerdown', pointerListener, true);
                win.addEventListener('keydown', keyListener);
                removeEmojiMenuListeners = () => {
                        win.removeEventListener('pointerdown', pointerListener, true);
                        win.removeEventListener('keydown', keyListener);
                };

                const selectionListener = () => {
                        refreshMentionState();
                        updateMentionMenuPosition();
                };
                const repositionListener = () => {
                        if (mentionMenuOpen) {
                                updateMentionMenuPosition();
                        }
                };
                win.addEventListener('selectionchange', selectionListener);
                win.addEventListener('resize', repositionListener);
                document.addEventListener('scroll', repositionListener, true);

                return () => {
                        win.removeEventListener('selectionchange', selectionListener);
                        win.removeEventListener('resize', repositionListener);
                        document.removeEventListener('scroll', repositionListener, true);
                };
        });

        onDestroy(() => {
                clearLocalAttachments({ releasePreviews: true });
                if (removeGlobalDragListeners) {
                        removeGlobalDragListeners();
                        removeGlobalDragListeners = null;
                }
                if (removeEmojiMenuListeners) {
                        removeEmojiMenuListeners();
                        removeEmojiMenuListeners = null;
                }
                resetTypingState();
        });

        $effect(() => {
                const channelId = $selectedChannelId;
                if (channelId !== typingChannelId) {
                        resetTypingState();
                        typingChannelId = channelId ?? null;
                }
        });

        $effect(() => {
                if (mentionMenuOpen) {
                        void tick().then(() => updateMentionMenuPosition());
                }
        });
</script>

<div class="relative border-t border-[var(--stroke)] p-3">
        {#if dropActive}
                <div
                        class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[var(--brand)]/70 bg-[var(--panel-strong)]/80 text-center text-sm font-semibold text-[var(--fg)]"
                >
                        <Paperclip class="h-5 w-5" stroke-width={2} />
                        <span>{m.chat_drop_to_attach()}</span>
                </div>
        {/if}
        {#if showEmojiPicker}
                <div class="absolute right-3 bottom-[calc(100%+0.75rem)] z-30" bind:this={emojiMenuEl}>
                        <EmojiPicker
                                bind:this={emojiPickerRef}
                                on:select={(event) => {
                                        void handleEmojiSelection(event.detail.emoji);
                                }}
                        />
                </div>
        {/if}
        {#if attachments.length}
                <div class="mb-3 flex flex-wrap gap-3">
                        {#each attachments as attachment (attachment.localId)}
                                <div
                                        class="relative inline-flex max-w-full flex-col overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)]"
                                        style={visualAttachmentWrapperStyle}
                                >
                                        {#if attachment.isImage && attachment.previewUrl}
                                                <img
                                                        src={attachment.previewUrl}
                                                        alt={attachment.filename}
                                                        class="block select-none"
                                                        style={visualAttachmentMediaStyle}
                                                />
                                        {:else}
                                                <div
                                                        class="grid place-items-center bg-[var(--panel-strong)] text-[var(--muted)]"
                                                        style={`${visualAttachmentMediaStyle} ${visualAttachmentPlaceholderStyle}`}
                                                >
                                                        <Paperclip class="h-6 w-6" stroke-width={2} />
                                                </div>
                                        {/if}
                                        <div class="flex items-start gap-2 px-2 py-2">
                                                <div class="flex-1 truncate text-xs text-[var(--fg)]">
                                                        {attachment.filename}
                                                </div>
                                        </div>
                                        <button
                                                class="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-[var(--panel-strong)] text-[var(--muted)] hover:text-[var(--fg)]"
                                                type="button"
                                                onclick={() => removeAttachment(attachment.localId)}
                                                aria-label="Remove attachment"
                                        >
                                                <X class="h-3.5 w-3.5" stroke-width={2} />
                                        </button>
                                </div>
                        {/each}
                </div>
        {/if}
        <div
                class="composer-shell relative flex min-h-[2.75rem] items-center gap-3 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-1 focus-within:border-[var(--stroke)] focus-within:shadow-none focus-within:ring-0 focus-within:ring-offset-0 focus-within:outline-none"
        >
                <div class="flex items-center">
                        <AttachmentUploader
                                bind:this={uploaderRef}
                                {attachments}
                                inline
                                on:updated={(event: CustomEvent<PendingAttachment[]>) => {
                                        mergeAttachments(event.detail);
                                }}
                        />
                </div>
                <div class="relative flex min-h-[1.75rem] flex-1" bind:this={editorWrapperEl}>
                        <div
                                class="editor-body w-full rounded-md px-2 py-1 text-sm leading-[1.4] text-[var(--fg)] caret-[var(--fg)] outline-none"
                                contenteditable="true"
                                role="textbox"
                                aria-multiline="true"
                                spellcheck="true"
                                tabindex="0"
                                data-placeholder={m.message_placeholder({ channel: channelName() })}
                                data-empty={editorIsEmpty ? 'true' : 'false'}
                                bind:this={editorEl}
                                oninput={handleEditorInput}
                                onkeydown={handleEditorKeydown}
                                onfocus={handleEditorFocus}
                                onblur={handleEditorBlur}
                        ></div>
                        {#if mentionMenuOpen}
                                <div
                                        class="mention-menu fixed z-40 w-72 max-w-[min(18rem,calc(100vw-4rem))]"
                                        bind:this={mentionMenuEl}
                                        style={`left: ${mentionMenuPosition?.left ?? 0}px; top: ${mentionMenuPosition?.top ?? 0}px; visibility: ${mentionMenuPosition ? 'visible' : 'hidden'};`}
                                >
                                        <div class="rounded-lg backdrop-blur-md">
                                                <div class="menu-surface overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)] shadow-lg">
                                                        <div class="max-h-60 overflow-y-auto" bind:this={mentionListEl}>
                                                                {#if mentionSuggestions.length === 0}
                                                                        <div class="px-3 py-2 text-sm text-[var(--muted)]">{m.no_results()}</div>
                                                                {:else}
                                                                        {#each mentionSuggestions as suggestion, index}
                                                                                <button
                                                                                        type="button"
                                                                                        class={`mention-option flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                                                                                                index === mentionActiveIndex ? 'is-active' : ''
                                                                                        }`}
                                                                                        data-mention-index={index}
                                                                                        style={suggestion.accentColor
                                                                                                ? `--mention-accent: ${suggestion.accentColor}`
                                                                                                : undefined}
                                                                                        onpointerdown={(event) => event.preventDefault()}
                                                                                        onclick={() => handleMentionClick(index)}
                                                                                >
                                                                                        <span
                                                                                                class={`icon flex h-5 w-5 items-center justify-center ${
                                                                                                        suggestion.type === 'emoji'
                                                                                                                ? ''
                                                                                                                : 'text-[var(--muted)]'
                                                                                                }`}
                                                                                        >
                                                                                                {#if suggestion.type === 'user'}
                                                                                                        <AtSign class="h-4 w-4" stroke-width={2} />
                                                                                                {:else if suggestion.type === 'role'}
                                                                                                        <BadgeCheck class="h-4 w-4" stroke-width={2} />
                                                                                                {:else if suggestion.type === 'emoji'}
                                                                                                        <span class="text-lg leading-none">{suggestion.emoji}</span>
                                                                                                {:else}
                                                                                                        {#if suggestion.channelKind === 'voice'}
                                                                                                                <Volume2 class="h-4 w-4" stroke-width={2} />
                                                                                                        {:else}
                                                                                                                <Hash class="h-4 w-4" stroke-width={2} />
                                                                                                        {/if}
                                                                                                {/if}
                                                                                        </span>
                                                                                        <span class="flex min-w-0 flex-1 flex-col">
                                                                                                <span class="label truncate">{suggestion.label}</span>
                                                                                                {#if suggestion.description}
                                                                                                        <span class="description truncate">{suggestion.description}</span>
                                                                                                {/if}
                                                                                        </span>
                                                                                </button>
                                                                        {/each}
                                                                {/if}
                                                        </div>
                                                </div>
                                        </div>
                                </div>
                        {/if}
                </div>
                <div class="flex items-center gap-2">
                        <button
                                bind:this={emojiButton}
                                class={`grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] transition-colors hover:text-[var(--fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${
                                        showEmojiPicker ? 'bg-[var(--panel)] text-[var(--fg)]' : ''
                                }`}
                                type="button"
                                aria-label="Insert emoji"
                                aria-pressed={showEmojiPicker}
                                onclick={() => {
                                        void toggleEmojiMenu();
                                }}
                        >
                                <Smile class="h-[18px] w-[18px]" stroke-width={2} />
                        </button>
                        <button
                                class="grid h-8 w-8 place-items-center rounded-md bg-[var(--brand)] text-[var(--bg)] disabled:opacity-50"
                                disabled={sending || (!content.trim() && attachments.length === 0)}
                                onclick={send}
                                aria-label={m.send()}
                        >
                                <Send class="h-[18px] w-[18px]" stroke-width={2} />
                        </button>
                </div>
        </div>
</div>

<style>
        :global(.editor-body[data-empty='true'])::before {
                content: attr(data-placeholder);
                color: var(--muted);
                pointer-events: none;
                position: absolute;
                inset-inline-start: 0.5rem;
                inset-inline-end: 0.5rem;
                inset-block-start: 0.25rem;
                white-space: pre-wrap;
        }

        :global(.editor-body) {
                min-height: 1.75rem;
                white-space: pre-wrap;
                word-break: break-word;
                position: relative;
        }

        :global(.mention-badge) {
                display: inline-flex;
                align-items: center;
                gap: 0.3em;
                border-radius: 4px;
                padding: 0 0.35em;
                margin: 0;
                background-color: color-mix(in srgb, var(--mention-accent, #5865f2) 18%, transparent);
                color: var(--mention-accent, #5865f2);
                font-weight: 500;
                font-size: 0.95em;
                line-height: 1.3;
        }

        :global(.mention-badge__icon) {
                width: 1em;
                height: 1em;
                flex-shrink: 0;
        }

        :global(.mention-badge__label) {
                display: inline-flex;
                align-items: center;
        }

        :global(.mention-badge[data-mention-type='channel']) {
                background-color: color-mix(in srgb, var(--mention-accent, #4f545c) 35%, transparent);
                color: #f2f3f5;
        }

        :global(.mention-badge[data-mention-type='user']),
        :global(.mention-badge[data-mention-type='role']) {
                color: var(--mention-accent, #5865f2);
        }

        :global(.mention-menu .mention-option) {
                transition: background-color 0.12s ease;
        }

        :global(.mention-menu .mention-option.is-active),
        :global(.mention-menu .mention-option:hover) {
                background-color: rgba(255, 255, 255, 0.05);
        }

        :global(.mention-menu .mention-option .label) {
                color: var(--fg);
        }

        :global(.mention-menu .mention-option .description) {
                color: var(--muted);
                font-size: 0.875rem;
        }
</style>
