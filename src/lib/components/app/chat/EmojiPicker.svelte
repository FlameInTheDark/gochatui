<script lang="ts">
	import emojiGroupsData from 'unicode-emoji-json/data-by-group.json';
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import type { ComponentType } from 'svelte';
	import {
		Clock,
		Gamepad2,
		Heart,
		Lamp,
		PawPrint,
		Plane,
		Smile,
		UserRound,
		UtensilsCrossed,
		Flag
	} from 'lucide-svelte';

	type EmojiEntry = {
		emoji: string;
		name: string;
		slug: string;
		skin_tone_support?: boolean;
		unicode_version?: string;
		emoji_version?: string;
		group?: string;
	};

	type EmojiGroup = {
		name: string;
		slug: string;
		emojis: EmojiEntry[];
	};

	type EmojiSelectEvent = {
		emoji: string;
	};

	const dispatch = createEventDispatcher<{ select: EmojiSelectEvent }>();

	const RAW_GROUPS = emojiGroupsData as EmojiGroup[];

	const iconMap: Record<string, ComponentType> = {
		smileys_emotion: Smile,
		people_body: UserRound,
		animals_nature: PawPrint,
		food_drink: UtensilsCrossed,
		travel_places: Plane,
		activities: Gamepad2,
		objects: Lamp,
		symbols: Heart,
		flags: Flag
	} satisfies Record<string, ComponentType>;

	const emojiGroups = RAW_GROUPS.map((group) => ({
		...group,
		emojis: group.emojis.map((emoji) => ({
			...emoji,
			group: group.slug
		}))
	}));

	type CategoryMeta = {
		slug: string;
		name: string;
		icon: ComponentType;
		emojis: EmojiEntry[];
	};

	const allEmojis: EmojiEntry[] = [];
	const emojiIndex = new Map<string, EmojiEntry>();
	for (const group of emojiGroups) {
		for (const emoji of group.emojis) {
			allEmojis.push(emoji);
			if (!emojiIndex.has(emoji.emoji)) {
				emojiIndex.set(emoji.emoji, emoji);
			}
		}
	}

	const categories: CategoryMeta[] = emojiGroups.map((group) => ({
		slug: group.slug,
		name: group.name,
		icon: iconMap[group.slug] ?? Smile,
		emojis: group.emojis
	}));

	const RECENT_STORAGE_KEY = 'gochat_recent_emojis';
	let recent: string[] = $state([]);
	let searchTerm = $state('');
	let hoveredEmoji: EmojiEntry | null = $state(null);
	let activeCategory = $state<string>(categories[0]?.slug ?? '');
	let scrollContainer: HTMLDivElement | null = null;
	let recentSection = $state<HTMLElement | null>(null);
	let observer: IntersectionObserver | null = null;
	const pendingSections: Array<{ slug: string; node: HTMLElement }> = [];
	const sectionNodes = new Map<string, HTMLElement>();
	let searchInput: HTMLInputElement | null = null;
	let previousSearch = '';

	$effect(() => {
		if (searchTerm.trim()) {
			activeCategory = 'search';
		} else if (activeCategory === 'search') {
			activeCategory = recent.length > 0 ? 'recent' : (categories[0]?.slug ?? '');
		}
	});

	$effect(() => {
		const payload = recent.slice(0, 50);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(payload));
		}
	});

	function observeSection(node: HTMLElement, slug: string) {
		sectionNodes.set(slug, node);
		if (observer) {
			observer.observe(node);
		} else {
			pendingSections.push({ slug, node });
		}
		return {
			destroy() {
				if (observer) {
					observer.unobserve(node);
				} else {
					const index = pendingSections.findIndex((entry) => entry.node === node);
					if (index !== -1) {
						pendingSections.splice(index, 1);
					}
				}
				sectionNodes.delete(slug);
			}
		};
	}

	function formatName(name: string): string {
		return name
			.split(' ')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}

	function handleSelect(emoji: EmojiEntry) {
		dispatch('select', { emoji: emoji.emoji });
		const next = [emoji.emoji, ...recent.filter((value) => value !== emoji.emoji)].slice(0, 54);
		recent = next;
	}

	function handlePointerEnter(emoji: EmojiEntry) {
		hoveredEmoji = emoji;
	}

	function handlePointerLeave(emoji: EmojiEntry) {
		if (hoveredEmoji?.emoji === emoji.emoji) {
			hoveredEmoji = null;
		}
	}

	function scrollToCategory(slug: string) {
		if (slug === 'recent') {
			recentSection?.scrollIntoView({ block: 'start' });
			activeCategory = slug;
			return;
		}
		const node = sectionNodes.get(slug);
		if (node) {
			node.scrollIntoView({ block: 'start' });
			activeCategory = slug;
		}
	}

	function clearRecent() {
		recent = [];
	}

	const trimmedSearch = $derived(searchTerm.trim().toLowerCase());
	const searchResults = $derived(
		trimmedSearch
			? allEmojis.filter((emoji) => {
					const name = emoji.name?.toLowerCase() ?? '';
					const slug = emoji.slug?.toLowerCase() ?? '';
					return name.includes(trimmedSearch) || slug.includes(trimmedSearch);
				})
			: []
	);

	const previewEmoji = $derived(
		hoveredEmoji ?? (trimmedSearch ? (searchResults[0] ?? null) : null)
	);

	$effect(() => {
		if (scrollContainer && trimmedSearch !== previousSearch) {
			scrollContainer.scrollTop = 0;
			previousSearch = trimmedSearch;
		}
	});

	$effect(() => {
		if (!trimmedSearch) {
			return;
		}
		const currentHovered = hoveredEmoji;
		if (currentHovered && !searchResults.some((emoji) => emoji.emoji === currentHovered.emoji)) {
			hoveredEmoji = null;
		}
	});

	const navCategories = $derived([
		...(recent.length > 0 ? [{ slug: 'recent', name: 'Frequently Used', icon: Clock }] : []),
		...categories
	]);

	const recentEntries = $derived(
		recent
			.map((value) => emojiIndex.get(value) ?? { emoji: value, name: value, slug: value })
			.filter((emoji) => Boolean(emoji))
	);

	function resolveDefaultSelection(): EmojiEntry | null {
		if (trimmedSearch) {
			return searchResults[0] ?? null;
		}
		if (recent.length > 0) {
			const fromRecent = emojiIndex.get(recent[0]);
			if (fromRecent) {
				return fromRecent;
			}
		}
		return categories[0]?.emojis[0] ?? null;
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') {
			return;
		}
		event.preventDefault();
		const next = resolveDefaultSelection();
		if (next) {
			handleSelect(next);
		}
	}

	onMount(() => {
		if (typeof localStorage !== 'undefined') {
			try {
				const stored = localStorage.getItem(RECENT_STORAGE_KEY);
				if (stored) {
					const parsed = JSON.parse(stored);
					if (Array.isArray(parsed)) {
						recent = parsed.filter((value): value is string => typeof value === 'string');
					}
				}
			} catch (error) {
				console.debug('Failed to restore recent emojis', error);
			}
		}

		if (!scrollContainer) {
			return;
		}

		observer = new IntersectionObserver(
			(entries) => {
				if (searchTerm.trim()) return;
				const visible = entries
					.filter((entry) => entry.isIntersecting && entry.intersectionRatio > 0)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible.length > 0) {
					const slug = visible[0].target.getAttribute('data-slug');
					if (slug && slug !== activeCategory) {
						activeCategory = slug;
					}
				}
			},
			{
				root: scrollContainer,
				threshold: [0.4]
			}
		);

		for (const { node } of pendingSections) {
			observer.observe(node);
		}
		pendingSections.length = 0;
	});

	onDestroy(() => {
		observer?.disconnect();
		observer = null;
	});

	export function focusSearch() {
		searchInput?.focus();
		searchInput?.select?.();
	}

	export function clearSearch() {
		searchTerm = '';
		hoveredEmoji = null;
	}

	export function scrollToTop() {
		if (scrollContainer) {
			scrollContainer.scrollTop = 0;
		}
	}
</script>

<div
	class="w-[360px] rounded-xl border border-[var(--stroke)] bg-[var(--panel)] text-[var(--fg)] shadow-xl"
>
	<div class="border-b border-[var(--stroke)] px-3 py-2">
		<input
			bind:this={searchInput}
			class="h-9 w-full rounded-md border border-transparent bg-[var(--panel-strong)] px-3 text-sm text-[var(--fg)] placeholder:text-[var(--muted)] focus:border-[var(--stroke)] focus:ring-0 focus:outline-none"
			type="search"
			placeholder="Search emoji"
			bind:value={searchTerm}
			aria-label="Search emoji"
			onkeydown={handleSearchKeydown}
		/>
	</div>
	<div class="max-h-[320px] overflow-hidden">
		<div class="relative max-h-[320px] overflow-y-auto px-3" bind:this={scrollContainer}>
			{#if trimmedSearch}
				<div class="py-3 text-xs tracking-wide text-[var(--muted)] uppercase">Search Results</div>
				{#if searchResults.length === 0}
					<div class="pb-6 text-sm text-[var(--muted)]">
						No emoji found for “{searchTerm}”.
					</div>
				{:else}
					<div class="grid grid-cols-8 gap-1 pb-4">
						{#each searchResults as emoji (emoji.emoji)}
							<button
								type="button"
								class="emoji-button grid h-10 w-10 place-items-center rounded-md text-2xl transition-colors hover:bg-[var(--panel-strong)]"
								title={formatName(emoji.name)}
								onpointerenter={() => handlePointerEnter(emoji)}
								onpointerleave={() => handlePointerLeave(emoji)}
								onclick={() => handleSelect(emoji)}
							>
								{emoji.emoji}
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				{#if recentEntries.length > 0}
					<section
						class="pt-3"
						data-slug="recent"
						bind:this={recentSection}
						use:observeSection={'recent'}
					>
						<div class="pb-2 text-xs tracking-wide text-[var(--muted)] uppercase">
							Frequently Used
						</div>
						<div class="grid grid-cols-8 gap-1 pb-4">
							{#each recentEntries as emoji (emoji.emoji)}
								<button
									type="button"
									class="emoji-button grid h-10 w-10 place-items-center rounded-md text-2xl transition-colors hover:bg-[var(--panel-strong)]"
									title={formatName(emoji.name ?? emoji.emoji)}
									onpointerenter={() => handlePointerEnter(emoji)}
									onpointerleave={() => handlePointerLeave(emoji)}
									onclick={() => handleSelect(emoji)}
								>
									{emoji.emoji}
								</button>
							{/each}
						</div>
					</section>
				{/if}
				{#each categories as category (category.slug)}
					<section class="pt-3" data-slug={category.slug} use:observeSection={category.slug}>
						<div class="pb-2 text-xs tracking-wide text-[var(--muted)] uppercase">
							{category.name}
						</div>
						<div class="grid grid-cols-8 gap-1 pb-4">
							{#each category.emojis as emoji (emoji.emoji)}
								<button
									type="button"
									class="emoji-button grid h-10 w-10 place-items-center rounded-md text-2xl transition-colors hover:bg-[var(--panel-strong)]"
									title={formatName(emoji.name)}
									onpointerenter={() => handlePointerEnter(emoji)}
									onpointerleave={() => handlePointerLeave(emoji)}
									onclick={() => handleSelect(emoji)}
								>
									{emoji.emoji}
								</button>
							{/each}
						</div>
					</section>
				{/each}
			{/if}
		</div>
	</div>
	<div class="flex items-center justify-between gap-2 border-t border-[var(--stroke)] px-2 py-2">
		<div class="flex flex-1 items-center justify-center gap-1">
			{#each navCategories as category (category.slug)}
				<button
					type="button"
					class={`grid h-9 w-9 place-items-center rounded-lg text-[var(--muted)] transition-colors hover:text-[var(--fg)] ${
						activeCategory === category.slug && trimmedSearch === ''
							? 'bg-[var(--panel-strong)] text-[var(--fg)]'
							: ''
					}`}
					onclick={() => {
						searchTerm = '';
						scrollToCategory(category.slug);
					}}
					aria-label={category.name}
				>
					<category.icon class="h-4 w-4" stroke-width={2} />
				</button>
			{/each}
		</div>
		<button
			type="button"
			class="rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50 disabled:hover:text-[var(--muted)]"
			onclick={clearRecent}
			disabled={recent.length === 0}
		>
			Clear
		</button>
	</div>
	<div class="border-t border-[var(--stroke)] px-3 py-3">
		{#if previewEmoji}
			<div class="flex items-center gap-3">
				<div class="text-4xl leading-none">{previewEmoji.emoji}</div>
				<div class="min-w-0">
					<div class="truncate text-sm font-medium text-[var(--fg)]">
						{formatName(previewEmoji.name ?? previewEmoji.emoji)}
					</div>
					<div class="truncate text-xs text-[var(--muted)]">
						:{previewEmoji.slug.replace(/\s+/g, '_')}:
					</div>
				</div>
			</div>
		{:else}
			<div class="text-xs text-[var(--muted)]">Hover an emoji to preview it here.</div>
		{/if}
	</div>
</div>

<style>
	.emoji-button {
		font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
	}
</style>
