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
	import { computeApiBase } from '$lib/runtime/api';
	import EmojiPicker from './EmojiPicker.svelte';
	import type EmojiPickerComponent from './EmojiPicker.svelte';
	import {
		detectMentionTrigger,
		findMentionAtIndex,
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

	let content = $state('');
	let attachments = $state<PendingAttachment[]>([]);
	let sending = $state(false);
	const dispatch = createEventDispatcher<{ sent: void }>();

	let ta: HTMLTextAreaElement | null = null;
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

        type InputDisplayToken =
                | { type: 'text'; value: string }
                | { type: 'mention'; mention: MentionMatch; label: string; accentColor: string | null };

	type MentionSuggestion = {
		id: string;
		type: MentionType;
		label: string;
		description: string | null;
		accentColor: string | null;
		member?: DtoMember | null;
		user?: DtoUser | null;
	};

        const mentionMatches = $derived.by(() => parseMentions(content));
        let editorFocused = $state(false);

        const mentionDisplayTokens = $derived.by(() => {
                const segments = splitTextWithMentions(content);
                const tokens: InputDisplayToken[] = [];

                for (const segment of segments) {
                        if (segment.type === 'text') {
                                if (segment.value) {
                                        tokens.push({ type: 'text', value: segment.value });
                                }
                                continue;
                        }

                        tokens.push(buildMentionDisplayToken(segment.mention));
                }

                return tokens;
        });
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
	let mentionRoleMap = $state<Record<string, DtoRole>>({});
	let mentionQuery = $state<MentionTrigger | null>(null);
	let mentionSuggestions = $state<MentionSuggestion[]>([]);
	let mentionActiveIndex = $state(0);
	const mentionMenuOpen = $derived.by(() => Boolean(mentionQuery && mentionSuggestions.length > 0));
	let mentionListEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
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
	});

	$effect(() => {
		const _memberMap = mentionMemberMap;
		void _memberMap;
		refreshMentionState();
	});

	const TYPING_RENEWAL_INTERVAL_MS = 10_000;
	let typingResetTimer: ReturnType<typeof setTimeout> | null = null;
	let typingLastSentAt = 0;
	let typingActive = false;
	let typingChannelId: string | null = null;

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
			dmUser =
				dmCandidates.find((entry) => toSnowflakeString((entry as any)?.id) === userId) ?? null;
		}
		const user: DtoUser | null = (userFromMember ?? dmUser ?? null) as DtoUser | null;
		const name =
			memberPrimaryName(member) || formatUserDisplayName(user) || fallbackUserLabel(userId);
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
                const channel = list.find(
                        (candidate) => toSnowflakeString((candidate as any)?.id) === channelId
                );
		if (!channel) {
			return `#channel-${channelId}`;
		}
		const name = (channel as any)?.name;
		if (typeof name === 'string' && name.trim()) {
			return `#${name.trim()}`;
		}
		return `#channel-${channelId}`;
	}

        function buildMentionDisplayToken(mention: MentionMatch): InputDisplayToken {
                if (mention.type === 'user') {
                        const details = resolveUserMentionDetails(mention.id);
                        return {
                                type: 'mention',
                                mention,
                                label: details.label,
                                accentColor: details.accentColor
                        };
                }

                if (mention.type === 'role') {
                        const details = resolveRoleMentionDetails(mention.id);
                        return {
                                type: 'mention',
                                mention,
                                label: details.label,
                                accentColor: details.accentColor
                        };
                }

                return {
                        type: 'mention',
                        mention,
                        label: resolveChannelMentionLabel(mention.id),
                        accentColor: null
                };
        }

        function clampSelectionIndex(value: number, limit: number): number {
                if (!Number.isFinite(value)) return limit;
                if (value < 0) return 0;
                if (value > limit) return limit;
                return value;
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
                        mentionActiveIndex = Math.min(
                                previousIndex,
                                Math.max(nextSuggestions.length - 1, 0)
                        );
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

        function refreshMentionState() {
                const target = ta;
                const fallback = content.length;
                const rawStart = target?.selectionStart ?? fallback;
                const rawEnd = target?.selectionEnd ?? rawStart;
                const start = clampSelectionIndex(rawStart, fallback);
                const end = clampSelectionIndex(rawEnd, fallback);

                if (!target) {
                        updateMentionSuggestionList(null);
                        return;
                }

                if (start !== end) {
                        updateMentionSuggestionList(null);
                        return;
                }

                const inside = mentionMatches.find((mention) => start > mention.start && start < mention.end);
                if (inside) {
                        try {
                                target.setSelectionRange(inside.end, inside.end);
                        } catch {
                                /* ignore */
                        }
                        updateMentionSuggestionList(null);
                        return;
		}

		const trigger = detectMentionTrigger(content, start);
		updateMentionSuggestionList(trigger);
	}

	async function removeMention(match: MentionMatch) {
		const before = content.slice(0, match.start);
		const after = content.slice(match.end);
		content = before + after;
		await tick();
		if (ta) {
			const pos = before.length;
			ta.focus();
			try {
				ta.setSelectionRange(pos, pos);
			} catch {
				/* ignore */
			}
		}
		autoResize();
		handleTypingActivity(content);
		refreshMentionState();
	}

        async function applyMentionSuggestion(suggestion: MentionSuggestion) {
                if (!ta) return;
                const currentStart = ta.selectionStart ?? content.length;
                const currentEnd = ta.selectionEnd ?? content.length;
                const start = mentionQuery ? mentionQuery.start : currentStart;
                const end = currentEnd;
		const before = content.slice(0, start);
		const after = content.slice(end);
		const placeholder = mentionPlaceholder(suggestion.type, suggestion.id);
		const needsSpace = after.startsWith(' ') || after.startsWith('\n') || after.length === 0;
		const insertion = needsSpace ? `${placeholder} ` : placeholder;
		content = `${before}${insertion}${after}`;
		mentionQuery = null;
		mentionSuggestions = [];
		mentionActiveIndex = 0;
		await tick();
		if (ta) {
			const cursor = before.length + insertion.length;
			ta.focus();
			try {
				ta.setSelectionRange(cursor, cursor);
			} catch {
				/* ignore */
			}
		}
		autoResize();
		handleTypingActivity(content);
		refreshMentionState();
	}

	async function handleMentionDeletion(event: KeyboardEvent): Promise<boolean> {
		if (!ta) return false;
		const start = ta.selectionStart ?? 0;
		const end = ta.selectionEnd ?? 0;
		if (start !== end) {
			return false;
		}
		if (event.key === 'Backspace') {
			const match = mentionMatches.find((entry) => entry.end === start);
			if (match) {
				event.preventDefault();
				await removeMention(match);
				return true;
			}
		}
		if (event.key === 'Delete') {
			const match = mentionMatches.find((entry) => entry.start === start);
			if (match) {
				event.preventDefault();
				await removeMention(match);
				return true;
			}
		}
		return false;
	}

	async function handleTextareaKeydown(event: KeyboardEvent) {
		if (mentionMenuOpen && mentionSuggestions.length > 0) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				mentionActiveIndex = (mentionActiveIndex + 1) % mentionSuggestions.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				mentionActiveIndex =
					(mentionActiveIndex - 1 + mentionSuggestions.length) % mentionSuggestions.length;
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
			if (await handleMentionDeletion(event)) {
				return;
			}
		}

		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
			return;
		}
	}

        function handleTextareaSelectionChange() {
                refreshMentionState();
        }

        function handleTextareaFocus() {
                editorFocused = true;
                refreshMentionState();
        }

        function handleTextareaBlur() {
                editorFocused = false;
                refreshMentionState();
        }

	function handleMentionClick(index: number) {
		const suggestion = mentionSuggestions[index];
		if (!suggestion) return;
		void applyMentionSuggestion(suggestion);
	}

	async function insertEmoji(emoji: string) {
		if (!emoji) return;
		const target = ta;
		if (!target) {
			content = `${content}${emoji}`;
			handleTypingActivity(content);
			refreshMentionState();
			return;
		}

		const start = target.selectionStart ?? content.length;
		const end = target.selectionEnd ?? content.length;
		const next = content.slice(0, start) + emoji + content.slice(end);
		content = next;
		await tick();
		const cursor = start + emoji.length;
		target.focus();
		try {
			target.setSelectionRange(cursor, cursor);
		} catch {
			/* ignore */
		}
		autoResize();
		handleTypingActivity(next);
		refreshMentionState();
	}

	async function openEmojiMenu() {
		showEmojiPicker = true;
		await tick();
		emojiPickerRef?.clearSearch?.();
		emojiPickerRef?.scrollToTop?.();
		emojiPickerRef?.focusSearch?.();
	}

	function closeEmojiMenu() {
		showEmojiPicker = false;
	}

	async function toggleEmojiMenu() {
		if (showEmojiPicker) {
			closeEmojiMenu();
			return;
		}
		await openEmojiMenu();
	}

	async function handleEmojiSelection(value: string) {
		await insertEmoji(value);
		closeEmojiMenu();
	}

	function handleGlobalPointerDown(event: PointerEvent) {
		if (!showEmojiPicker) return;
		const path = event.composedPath();
		if (emojiMenuEl && path.includes(emojiMenuEl)) return;
		if (emojiButton && path.includes(emojiButton)) return;
		closeEmojiMenu();
	}

	function handleGlobalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && showEmojiPicker) {
			event.preventDefault();
			event.stopPropagation();
			closeEmojiMenu();
		}
	}

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
			!typingActive ||
			channelId !== typingChannelId ||
			now - typingLastSentAt >= TYPING_RENEWAL_INTERVAL_MS;
		if (shouldSend) {
			void dispatchTypingIndicator(channelId);
		}
	}

	const VISUAL_ATTACHMENT_PREVIEW_SIZE = 218;
	const visualAttachmentWrapperStyle = `width: min(100%, ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px); max-width: min(100%, ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px);`;
	const visualAttachmentMediaStyle = `width: 100%; height: ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px; object-fit: contain;`;
	const visualAttachmentPlaceholderStyle = `height: ${VISUAL_ATTACHMENT_PREVIEW_SIZE}px;`;

	// Derive current channel name to show in placeholder
	function currentChannel() {
		const gid = $selectedGuildId ?? '';
		return ($channelsByGuild[gid] ?? []).find((c) => String((c as any).id) === $selectedChannelId);
	}
	function channelName() {
		const ch = currentChannel() as any;
		return (ch?.name ?? '').toString();
	}

	function autoResize() {
		if (!ta) return;
		ta.style.height = 'auto';
		const max = Math.floor((window?.innerHeight || 800) * 0.4);
		const next = Math.min(ta.scrollHeight, max);
		ta.style.height = next + 'px';
		ta.style.overflowY = ta.scrollHeight > next ? 'auto' : 'hidden';
	}

	function handleInput(event: Event) {
		autoResize();
		const target = event.currentTarget as HTMLTextAreaElement | null;
		const value = target?.value ?? '';
		handleTypingActivity(value);
		refreshMentionState();
	}

	onMount(() => {
		autoResize();

		if (typeof window === 'undefined') {
			return;
		}

		const win = window;
		const listeners: Array<[keyof WindowEventMap, (event: DragEvent) => void]> = [
			['dragenter', handleDragEnter],
			['dragover', handleDragOver],
			['dragleave', handleDragLeave],
			['drop', handleDrop],
			['dragend', handleDragEnd]
		];
		const opts: boolean = true;
		listeners.forEach(([event, handler]) => {
			win.addEventListener(event, handler as EventListener, opts);
		});
		removeGlobalDragListeners = () => {
			listeners.forEach(([event, handler]) => {
				win.removeEventListener(event, handler as EventListener, opts);
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
                // wait for DOM to reflect cleared content, then collapse height
                await tick();
                if (ta) {
                        ta.style.height = 'auto';
                        ta.style.overflowY = 'hidden';
                        try {
                                ta.setSelectionRange(0, 0);
                        } catch {
                                /* ignore */
                        }
                }
                refreshMentionState();
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
		const {
			localId,
			attachments: pendingAttachments,
			content: messageContent,
			channelId
		} = message;
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
					updatePendingAttachment(localId, attachment.localId, (current) => {
						const fallbackTotal = current.size > 0 ? current.size : total;
						const denominator = total > 0 ? total : fallbackTotal;
						const ratio = denominator > 0 ? Math.min(1, uploaded / denominator) : 1;
						return {
							...current,
							uploadedBytes: denominator > 0 ? Math.min(uploaded, denominator) : uploaded,
							progress: ratio
						};
					});
				});
				successfulIds.push(attachment.attachmentId);
				updatePendingAttachment(localId, attachment.localId, (current) => ({
					...current,
					status: 'success',
					progress: 1,
					uploadedBytes: current.size,
					error: null
				}));
			} catch (err) {
				const message = getErrorMessage(err);
				updatePendingAttachment(localId, attachment.localId, (current) => ({
					...current,
					status: 'error',
					error: message,
					progress: current.progress,
					uploadedBytes: current.uploadedBytes
				}));
			}
		}

		if (!messageContent && successfulIds.length === 0) {
			updatePendingMessage(localId, (current) => ({
				...current,
				status: 'error',
				error: 'All attachments failed to upload'
			}));
			return;
		}

		try {
			await auth.api.message.messageChannelChannelIdPost({
				channelId: channelId as any,
				messageSendMessageRequest: {
					content: messageContent,
					attachments: successfulIds as any
				}
			});
			removePendingMessage(localId);
		} catch (err) {
			const messageText = getErrorMessage(err);
			updatePendingMessage(localId, (current) => ({
				...current,
				status: 'error',
				error: messageText
			}));
		}
	}
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
                class="chat-input relative flex min-h-[2.625rem] items-center gap-2 rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-2 focus-within:border-[var(--stroke)] focus-within:shadow-none focus-within:ring-0 focus-within:ring-offset-0 focus-within:outline-none"
        >
                {#if mentionMenuOpen}
                        <div
                                class="mention-menu absolute bottom-full left-0 mb-2 w-72 max-w-[min(18rem,calc(100vw-4rem))]"
                        >
                                <div class="rounded-lg backdrop-blur-md">
                                        <div
                                                class="menu-surface overflow-hidden rounded-md border border-[var(--stroke)] bg-[var(--panel)] shadow-lg"
                                        >
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
                <div class="flex items-center gap-1">
                        <AttachmentUploader
                                bind:this={uploaderRef}
                                {attachments}
                                inline
                                on:updated={(event: CustomEvent<PendingAttachment[]>) => {
                                        mergeAttachments(event.detail);
                                }}
                        />
                </div>
                <div class="relative flex flex-1 items-center">
                        <div
                                class="input-overlay pointer-events-none absolute inset-0 z-0 overflow-hidden px-2 py-2 leading-[1.5]"
                                aria-hidden="true"
                        >
                                <div class="overlay-layer">
                                        <span class="overlay-text">
                                                {#each mentionDisplayTokens as token, index}
                                                        {#if token.type === 'text'}
                                                                <span class="input-text">{token.value}</span>
                                                        {:else if token.type === 'mention'}
                                                                <span class="mention-wrapper">
                                                                        <span class="mention-ghost">
                                                                                {mentionPlaceholder(token.mention.type, token.mention.id)}
                                                                        </span>
                                                                        <span
                                                                                class="mention-pill-input"
                                                                                style={
                                                                                        token.accentColor
                                                                                                ? `--mention-accent: ${token.accentColor}`
                                                                                                : undefined
                                                                                }
                                                                        >
                                                                                {token.label}
                                                                        </span>
                                                                </span>
                                                        {/if}
                                                {/each}
                                        </span>
                                        {#if !content && !editorFocused}
                                                <span class="placeholder text-[var(--muted)]"
                                                        >{m.message_placeholder({ channel: channelName() })}</span
                                                >
                                        {/if}
                                </div>
                        </div>
                        <textarea
                                bind:this={ta}
                                class="textarea-editor relative z-[1] box-border max-h-[40vh] min-h-[2.625rem] w-full resize-none appearance-none border-0 bg-transparent px-2 py-2 text-transparent leading-[1.5] selection:bg-[var(--brand)]/20 selection:text-transparent focus:border-0 focus:border-transparent focus:shadow-none focus:ring-0 focus:ring-transparent focus:ring-offset-0 focus:outline-none"
                                style:caretColor="var(--fg, #fff)"
                                rows={1}
                                aria-label={m.message_placeholder({ channel: channelName() })}
                                bind:value={content}
                                oninput={handleInput}
                                onkeydown={handleTextareaKeydown}
                                onkeyup={handleTextareaSelectionChange}
                                onmouseup={handleTextareaSelectionChange}
                                onfocus={handleTextareaFocus}
                                onblur={handleTextareaBlur}
                                onselect={handleTextareaSelectionChange}
                        ></textarea>
                </div>
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

<style>
        .input-overlay {
                color: var(--fg);
                font-size: inherit;
                line-height: inherit;
                white-space: pre-wrap;
                word-break: break-word;
                user-select: none;
                box-sizing: border-box;
                z-index: 0;
        }

        .overlay-layer {
                position: relative;
                min-height: 100%;
        }

        .overlay-text {
                position: relative;
                z-index: 1;
                display: inline-block;
                min-height: 1.25em;
        }

        .textarea-editor {
                position: relative;
                z-index: 1;
                caret-color: var(--fg, #fff);
        }

        .input-overlay .input-text {
                white-space: pre-wrap;
        }

        .input-overlay .placeholder {
                position: absolute;
                left: 0;
                top: 0;
                white-space: pre-wrap;
                pointer-events: none;
                z-index: 0;
        }

        .mention-wrapper {
                display: inline-grid;
                grid-auto-flow: column;
                align-items: center;
        }

        .mention-wrapper .mention-ghost,
        .mention-wrapper .mention-pill-input {
                grid-area: 1 / 1;
        }

        .mention-wrapper .mention-ghost {
                visibility: hidden;
                white-space: pre;
        }

        .mention-pill-input {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0 0.5rem;
                border-radius: 9999px;
                font-weight: 500;
                white-space: nowrap;
                background-color: rgba(88, 101, 242, 0.16);
                background-color: color-mix(in srgb, var(--mention-accent, var(--brand)) 16%, transparent);
                color: var(--mention-accent, var(--brand));
        }

	.mention-menu {
		z-index: 20;
	}

	.mention-option {
		background: transparent;
		border: none;
		color: var(--fg);
		transition: background-color 0.15s ease;
	}

	.mention-option .icon {
		color: var(--mention-accent, var(--muted));
	}

	.mention-option .label {
		font-weight: 600;
		color: var(--mention-accent, var(--fg));
	}

	.mention-option .description {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.mention-option.is-active {
		background-color: var(--panel-strong);
	}

	.mention-option.is-active .label {
		color: var(--fg);
	}

	.mention-option:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.textarea-editor::placeholder {
		color: transparent;
	}
</style>
