<script lang="ts">
	import { settingsOpen, theme, locale } from '$lib/stores/settings';
	import { m } from '$lib/paraglide/messages.js';
	import type { Theme, Locale } from '$lib/stores/settings';

	type LanguageOption = {
		code: Locale;
		label: string;
	};

	const languages: LanguageOption[] = [
		{ code: 'en', label: 'English' },
		{ code: 'ru', label: 'Русский' }
	];

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
						<p id="language-group-label" class="mb-2 block">{m.language()}</p>
						<div class="space-y-2" role="radiogroup" aria-labelledby="language-group-label">
							{#each languages as lang (lang.code)}
								<div>
									<input
										type="radio"
										name="language"
										id={`language-${lang.code}`}
										class="sr-only"
										value={lang.code}
										checked={$locale === lang.code}
										onchange={() => locale.set(lang.code)}
									/>
									<label
										for={`language-${lang.code}`}
										class={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition select-none focus-within:ring-2 focus-within:ring-[var(--brand)]/60 focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg)] ${
											$locale === lang.code
												? 'border-[var(--brand)] bg-[var(--panel-strong)] shadow-sm'
												: 'border-[var(--stroke)] bg-[var(--panel)] hover:border-[var(--brand)]/60 hover:bg-[var(--panel-strong)]'
										}`}
									>
										<span class="text-base font-medium">{lang.label}</span>
										<span
											class={`ml-4 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
												$locale === lang.code
													? 'border-[var(--success)]'
													: 'border-[var(--stroke-2)]'
											}`}
											aria-hidden="true"
										>
											<span
												class={`h-2.5 w-2.5 rounded-full transition-colors duration-150 ${
													$locale === lang.code ? 'bg-[var(--success)]' : 'bg-transparent'
												}`}
											></span>
										</span>
									</label>
								</div>
							{/each}
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
