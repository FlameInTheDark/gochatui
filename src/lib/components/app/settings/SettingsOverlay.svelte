<script lang="ts">
	import { settingsOpen, theme, locale } from '$lib/stores/settings';
	import { m } from '$lib/paraglide/messages.js';
	import type { Theme, Locale } from '$lib/stores/settings';

	let category = $state<'general' | 'appearance' | 'other'>('general');

	function close() {
		settingsOpen.set(false);
	}
</script>

<svelte:window on:keydown={(e) => $settingsOpen && e.key === 'Escape' && close()} />
{#if $settingsOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		onpointerdown={close}
	>
		<div
			class="relative flex h-[80vh] w-full max-w-3xl overflow-hidden rounded-lg bg-[var(--bg)] shadow-xl"
			onpointerdown={(e) => e.stopPropagation()}
		>
			<button
				aria-label={m.close()}
				class="absolute top-3 right-3 rounded p-1 text-xl leading-none hover:bg-[var(--panel)]"
				onclick={close}
			>
				&times;
			</button>
			<aside class="w-48 space-y-2 border-r border-[var(--stroke)] p-4">
				<button
					class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'general'
						? 'bg-[var(--panel)] font-semibold'
						: ''}"
					onclick={() => (category = 'general')}
				>
					{m.general()}
				</button>
				<button
					class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category ===
					'appearance'
						? 'bg-[var(--panel)] font-semibold'
						: ''}"
					onclick={() => (category = 'appearance')}
				>
					{m.appearance()}
				</button>
				<button
					class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'other'
						? 'bg-[var(--panel)] font-semibold'
						: ''}"
					onclick={() => (category = 'other')}
				>
					{m.other()}
				</button>
			</aside>
			<section class="flex-1 space-y-4 overflow-y-auto p-4">
				{#if category === 'general'}
					<div>
						<label for="language-select" class="mb-2 block">{m.language()}</label>
						<div class="relative">
							<select
								id="language-select"
								class="w-full appearance-none rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 pr-8 focus:ring-2 focus:ring-blue-500 focus:outline-none"
								value={$locale}
								onchange={(e) => locale.set((e.target as HTMLSelectElement).value as Locale)}
							>
								<option value="en">English</option>
								<option value="ru">Русский</option>
							</select>
							<span
								class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--fg-muted)]"
								>▾</span
							>
						</div>
					</div>
				{:else if category === 'appearance'}
					<div>
						<label for="theme-select" class="mb-2 block">{m.theme()}</label>
						<div class="relative">
							<select
								id="theme-select"
								class="w-full appearance-none rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 pr-8 focus:ring-2 focus:ring-blue-500 focus:outline-none"
								value={$theme}
								onchange={(e) => theme.set((e.target as HTMLSelectElement).value as Theme)}
							>
								<option value="system">{m.system()}</option>
								<option value="light">{m.light()}</option>
								<option value="dark">{m.dark()}</option>
							</select>
							<span
								class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--fg-muted)]"
								>▾</span
							>
						</div>
					</div>
				{:else}
					<p>{m.other()}...</p>
				{/if}
			</section>
		</div>
	</div>
{/if}
