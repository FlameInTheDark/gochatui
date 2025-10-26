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
        import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
        import { get } from 'svelte/store';
        import { m } from '$lib/paraglide/messages.js';
        import { Send, X, Paperclip, Smile, AtSign, Hash, BadgeCheck } from 'lucide-svelte';
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
                mentionPlaceholder,
                parseMentions,
                splitTextWithMentions,
                type MentionTrigger,
                type MentionMatch,
                type MentionType
        } from '$lib/utils/mentions';
        import { guildRoleCacheState, loadGuildRolesCached } from '$lib/utils/guildRoles';
        import {
                buildRoleMap,
                memberPrimaryName,
                resolveMemberRoleColor,
                toSnowflakeString
        } from '$lib/utils/members';
        import { colorIntToHex } from '$lib/utils/color';

        type EditorTokenInfo = {
                trigger: '@' | '#';
                query: string;
                node: Text;
                start: number;
                end: number;
        };

        type MentionSuggestion = {
                id: string;
                type: MentionType;
                label: string;
                description: string | null;
                accentColor: string | null;
                member?: DtoMember | null;
                user?: DtoUser | null;
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

        let mentionQuery = $state<MentionTrigger | null>(null);
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

        const mentionMatches = $derived.by(() => parseMentions(content));
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
        function memberUserId(member: DtoMember | null | undefined): string | null {
                if (!member) return null;
                return (
                        toSnowflakeString((member as any)?.user?.id) ?? toSnowflakeString((member as any)?.id) ?? null
                );
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
                let accentColor: string | null = null;
                if (guildId && guildId !== '@me' && member) {
                        accentColor = resolveMemberRoleColor(member, guildId, mentionRoleMap) ?? null;
                }
                return {
                        label: `@${name.replace(/^@+/, '').trim()}`,
                        accentColor,
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
                        return { label: `@Role ${roleId}`, accentColor: null };
                }
                const name = typeof (role as any)?.name === 'string' ? (role as any).name : `Role ${roleId}`;
                const colorValue = (role as any)?.color;
                const accentColor =
                        colorValue != null ? colorIntToHex(colorValue as number | string | bigint | null) : null;
                return {
                        label: `@${String(name)}`,
                        accentColor
                };
        }

        function resolveChannelMentionLabel(channelId: string): string {
                const guildId = $selectedGuildId ?? '';
                const list = ($channelsByGuild[guildId] ?? []) as DtoChannel[];
                const channel = list.find((candidate) => toSnowflakeString((candidate as any)?.id) === channelId);
                if (!channel) {
                        return `#channel-${channelId}`;
                }
                const name = (channel as any)?.name;
                if (typeof name === 'string' && name.trim()) {
                        return `#${name.trim()}`;
                }
                return `#channel-${channelId}`;
        }

        function mentionDisplayDetails(mention: MentionMatch): { label: string; accentColor: string | null } {
                if (mention.type === 'user') {
                        const details = resolveUserMentionDetails(mention.id);
                        return { label: details.label, accentColor: details.accentColor };
                }
                if (mention.type === 'role') {
                        const details = resolveRoleMentionDetails(mention.id);
                        return { label: details.label, accentColor: details.accentColor };
                }
                return { label: resolveChannelMentionLabel(mention.id), accentColor: null };
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
                                        user: details.user
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
                                        accentColor: null,
                                        member: null,
                                        user
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
                                user: null
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
                        const id = toSnowflakeString((channel as any)?.id);
                        if (!id) continue;
                        const type = Number((channel as any)?.type ?? 0);
                        if (type === 2) continue;
                        const name = resolveChannelMentionLabel(id);
                        suggestions.push({
                                id,
                                type: 'channel',
                                label: name,
                                description: (channel as any)?.topic ?? null,
                                accentColor: null,
                                member: null,
                                user: null
                        });
                }
                return suggestions;
        }
        function updateMentionSuggestionList(trigger: MentionTrigger | null) {
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

                const normalizedQuery = trigger.query.replace(/^&/, '').trim().toLowerCase();

                let pool: MentionSuggestion[] = [];
                if (trigger.trigger === '@') {
                        const combined = [...buildUserSuggestions(), ...buildRoleSuggestions()];
                        const deduped = new Map<string, MentionSuggestion>();
                        for (const suggestion of combined) {
                                deduped.set(`${suggestion.type}:${suggestion.id}`, suggestion);
                        }
                        pool = Array.from(deduped.values());
                } else {
                        pool = buildChannelSuggestions();
                }

                if (normalizedQuery) {
                        pool = pool.filter((suggestion) => {
                                const label = suggestion.label.toLowerCase();
                                if (label.includes(normalizedQuery)) return true;
                                const desc = suggestion.description?.toLowerCase() ?? '';
                                return desc.includes(normalizedQuery);
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
                                        previous.accentColor !== suggestion.accentColor
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
                        return node.nodeValue ?? '';
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

        function createMentionBadge(
                mention: MentionMatch,
                details: { label: string; accentColor: string | null }
        ): HTMLSpanElement {
                const badge = document.createElement('span');
                badge.className = 'mention-badge';
                badge.contentEditable = 'false';
                badge.dataset.mentionType = mention.type;
                badge.dataset.mentionId = mention.id;
                badge.textContent = details.label;
                if (details.accentColor) {
                        badge.style.setProperty('--mention-accent', details.accentColor);
                }
                return badge;
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
                                editorEl.appendChild(document.createTextNode(' '));
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
                if (trigger !== '@' && trigger !== '#') return null;
                if (/\s/.test(trigger)) return null;
                return {
                        trigger,
                        query: token.slice(1),
                        node: textNode,
                        start,
                        end: offset
                };
        }

        function updateMentionMenuPosition() {
                if (!mentionMenuEl || !editorWrapperEl) return;
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
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
                const wrapperRect = editorWrapperEl.getBoundingClientRect();
                mentionMenuPosition = {
                        left: rect.left - wrapperRect.left,
                        top: rect.bottom - wrapperRect.top + (editorEl?.scrollTop ?? 0)
                };
        }

        function refreshMentionState() {
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection || selection.rangeCount === 0 || !selectionInsideEditor(selection)) {
                        updateMentionSuggestionList(null);
                        return;
                }
                const cursor = getCaretIndex();
                const trigger = detectMentionTrigger(content, cursor);
                if (!trigger) {
                        updateMentionSuggestionList(null);
                        return;
                }
                activeTokenInfo = getCurrentTokenInfo();
                updateMentionSuggestionList(trigger);
                updateMentionMenuPosition();
                scrollActiveSuggestionIntoView();
        }
        async function applyMentionSuggestion(suggestion: MentionSuggestion) {
                if (!editorEl) return;
                const selection = typeof window !== 'undefined' ? window.getSelection() : null;
                if (!selection) return;
                const info = activeTokenInfo ?? getCurrentTokenInfo();
                const mention: MentionMatch = {
                        type: suggestion.type,
                        id: suggestion.id,
                        start: 0,
                        end: 0,
                        raw: mentionPlaceholder(suggestion.type, suggestion.id)
                };
                const details = { label: suggestion.label, accentColor: suggestion.accentColor };
                const badge = createMentionBadge(mention, details);
                const spaceNode = document.createTextNode(' ');

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
                        fragment.appendChild(spaceNode);
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
                                fragment.appendChild(spaceNode);
                                range.insertNode(fragment);
                        } else {
                                editorEl.appendChild(badge);
                                editorEl.appendChild(spaceNode);
                        }
                }

                const range = document.createRange();
                range.setStart(spaceNode, 1);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
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
                        if ((text.nodeValue ?? '').startsWith(' ')) {
                                text.deleteData(0, 1);
                        }
                        if ((text.nodeValue ?? '').length === 0) {
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
                win.addEventListener('selectionchange', selectionListener);

                return () => {
                        win.removeEventListener('selectionchange', selectionListener);
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
                class="composer-shell relative flex items-end gap-3 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 focus-within:border-[var(--stroke)] focus-within:shadow-none focus-within:ring-0 focus-within:ring-offset-0 focus-within:outline-none"
        >
                <div class="flex items-end pb-1">
                        <AttachmentUploader
                                bind:this={uploaderRef}
                                {attachments}
                                inline
                                on:updated={(event: CustomEvent<PendingAttachment[]>) => {
                                        mergeAttachments(event.detail);
                                }}
                        />
                </div>
                <div class="relative flex min-h-[2.75rem] flex-1" bind:this={editorWrapperEl}>
                        <div
                                class="editor-body w-full rounded-md px-2 py-2 text-sm leading-[1.4] text-[var(--fg)] caret-[var(--fg)] outline-none"
                                contenteditable="true"
                                role="textbox"
                                aria-multiline="true"
                                spellcheck="true"
                                tabindex="0"
                                data-placeholder={m.message_placeholder({ channel: channelName() })}
                                bind:this={editorEl}
                                oninput={handleEditorInput}
                                onkeydown={handleEditorKeydown}
                                onfocus={handleEditorFocus}
                                onblur={handleEditorBlur}
                        ></div>
                        {#if mentionMenuOpen}
                                <div
                                        class="mention-menu absolute z-20 w-72 max-w-[min(18rem,calc(100vw-4rem))]"
                                        bind:this={mentionMenuEl}
                                        style={`left: ${mentionMenuPosition?.left ?? 0}px; top: ${mentionMenuPosition?.top ?? 0}px;`}
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
                                                                                        <span class="icon text-[var(--muted)]">
                                                                                                {#if suggestion.type === 'user'}
                                                                                                        <AtSign class="h-4 w-4" stroke-width={2} />
                                                                                                {:else if suggestion.type === 'role'}
                                                                                                        <BadgeCheck class="h-4 w-4" stroke-width={2} />
                                                                                                {:else}
                                                                                                        <Hash class="h-4 w-4" stroke-width={2} />
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
                <div class="flex items-center gap-2 pb-1">
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
        :global(.editor-body:empty)::before {
                content: attr(data-placeholder);
                color: var(--muted);
                pointer-events: none;
        }

        :global(.editor-body) {
                min-height: 2.25rem;
                white-space: pre-wrap;
                word-break: break-word;
        }

        :global(.mention-badge) {
                display: inline-flex;
                align-items: center;
                border-radius: 4px;
                padding: 0 4px;
                margin: 0 1px;
                background: var(--mention-accent, var(--panel));
                color: var(--mention-accent, var(--fg));
                font-weight: 500;
                font-size: 0.95em;
                line-height: 1.3;
        }

        :global(.mention-badge[style*='--mention-accent']) {
                color: #fff;
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
