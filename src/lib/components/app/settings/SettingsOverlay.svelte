<script lang="ts">
	import { settingsOpen, theme, locale } from '$lib/stores/settings';
	import { m } from '$lib/paraglide/messages.js';
	import type { Theme } from '$lib/stores/settings';

	let category = $state<'general' | 'appearance' | 'other'>('general');

	function close() {
		settingsOpen.set(false);
	}
</script>

<svelte:window on:keydown={(e) => $settingsOpen && e.key === 'Escape' && close()} />
{#if $settingsOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" on:click={close}>
		<div
			class="flex h-[80vh] w-full max-w-3xl overflow-hidden rounded-lg bg-[var(--bg)]"
			on:click|stopPropagation
		>
			<aside class="w-48 space-y-2 border-r border-[var(--stroke)] p-4">
				<button
					class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'general'
						? 'bg-[var(--panel)] font-semibold'
						: ''}"
					on:click={() => (category = 'general')}
				>
					{m.general()}
				</button>
				<button
					class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category ===
					'appearance'
						? 'bg-[var(--panel)] font-semibold'
						: ''}"
					on:click={() => (category = 'appearance')}
				>
					{m.appearance()}
				</button>
				<button
					class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'other'
						? 'bg-[var(--panel)] font-semibold'
						: ''}"
					on:click={() => (category = 'other')}
				>
					{m.other()}
				</button>
			</aside>
			<section class="flex-1 space-y-4 overflow-y-auto p-4">
				{#if category === 'general'}
					<div>
						<label class="mb-2 block">{m.language()}</label>
						<select
							class="rounded border px-2 py-1"
							value={$locale}
							on:change={(e) => locale.set((e.target as HTMLSelectElement).value)}
						>
							<option value="en">English</option>
							<option value="ru">Русский</option>
						</select>
					</div>
				{:else if category === 'appearance'}
					<div>
						<label class="mb-2 block">{m.theme()}</label>
						<select
							class="rounded border px-2 py-1"
							value={$theme}
							on:change={(e) => theme.set((e.target as HTMLSelectElement).value as Theme)}
						>
							<option value="system">{m.system()}</option>
							<option value="light">{m.light()}</option>
							<option value="dark">{m.dark()}</option>
						</select>
					</div>
				{:else}
					<p>{m.other()}...</p>
				{/if}
				<div>
					<button class="mt-4 rounded border border-[var(--stroke)] px-4 py-2" on:click={close}
						>{m.close()}</button
					>
				</div>
			</section>
		</div>
	</div>
{/if}
