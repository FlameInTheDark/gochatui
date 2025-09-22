<script lang="ts">
        import { settingsOpen, theme, locale } from '$lib/stores/settings';
        import { m } from '$lib/paraglide/messages.js';
        import ProfileEdit from '$lib/components/app/user/ProfileEdit.svelte';
        import type { Theme, Locale } from '$lib/stores/settings';

	type LanguageOption = {
		code: Locale;
		label: string;
	};

	type ThemeOption = {
		value: Theme;
		label: () => string;
	};

	const languages: LanguageOption[] = [
		{ code: 'en', label: 'English' },
		{ code: 'de', label: 'Deutsch' },
		{ code: 'fr', label: 'Français' },
		{ code: 'ru', label: 'Русский' }
	];

	const themeOptions: ThemeOption[] = [
		{ value: 'system', label: () => m.system() },
		{ value: 'light', label: () => m.light() },
		{ value: 'dark', label: () => m.dark() }
	];

        let category = $state<'profile' | 'general' | 'appearance' | 'other'>('profile');

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
                                        class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'profile'
                                                ? 'bg-[var(--panel)] font-semibold'
                                                : ''}"
                                        onclick={() => (category = 'profile')}
                                >
                                        {m.profile()}
                                </button>
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
                        <section class="scroll-area flex-1 space-y-4 overflow-y-auto p-4">
                                {#if category === 'profile'}
                                        <div class="space-y-4">
                                                <ProfileEdit />
                                        </div>
                                {:else if category === 'general'}
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
						<p id="theme-group-label" class="mb-2 block">{m.theme()}</p>
						<div class="space-y-2" role="radiogroup" aria-labelledby="theme-group-label">
							{#each themeOptions as option (option.value)}
								<div>
									<input
										type="radio"
										name="theme"
										id={`theme-${option.value}`}
										class="sr-only"
										value={option.value}
										checked={$theme === option.value}
										onchange={() => theme.set(option.value)}
									/>
									<label
										for={`theme-${option.value}`}
										class={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition select-none focus-within:ring-2 focus-within:ring-[var(--brand)]/60 focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg)] ${
											$theme === option.value
												? 'border-[var(--brand)] bg-[var(--panel-strong)] shadow-sm'
												: 'border-[var(--stroke)] bg-[var(--panel)] hover:border-[var(--brand)]/60 hover:bg-[var(--panel-strong)]'
										}`}
									>
										<span class="text-base font-medium">{option.label()}</span>
										<span
											class={`ml-4 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
												$theme === option.value
													? 'border-[var(--brand)]'
													: 'border-[var(--stroke-2)]'
											}`}
											aria-hidden="true"
										>
											<span
												class={`h-2.5 w-2.5 rounded-full transition-colors duration-150 ${
													$theme === option.value ? 'bg-[var(--brand)]' : 'bg-transparent'
												}`}
											></span>
										</span>
									</label>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<p>{m.other()}...</p>
				{/if}
			</section>
		</div>
	</div>
{/if}
