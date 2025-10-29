<script lang="ts">
        import {
                appSettings,
                mutateAppSettings,
                settingsOpen,
                theme,
                locale,
                type UiSoundSettingKey
        } from '$lib/stores/settings';
        import { m } from '$lib/paraglide/messages.js';
	import ProfileEdit from '$lib/components/app/user/ProfileEdit.svelte';
	import SettingsPanel from '$lib/components/ui/SettingsPanel.svelte';
	import VoiceVideoSettings from '$lib/components/app/settings/VoiceVideoSettings.svelte';
	import type { Theme, Locale } from '$lib/stores/settings';
	import { localeOptions, type LocaleOption } from '$lib/i18n/locales';

	type ThemeOption = {
		value: Theme;
		label: () => string;
	};

	const languages: LocaleOption[] = localeOptions;

	const themeOptions: ThemeOption[] = [
		{ value: 'system', label: () => m.system() },
		{ value: 'light', label: () => m.light() },
		{ value: 'dark', label: () => m.dark() }
	];

        let category =
                $state<'profile' | 'general' | 'appearance' | 'notifications' | 'voice-video' | 'other'>(
                        'profile'
                );

        const soundToggleOptions: Array<{ key: UiSoundSettingKey; label: () => string }> = [
                { key: 'notification', label: () => m.settings_ui_sound_notification() },
                { key: 'mute', label: () => m.settings_ui_sound_mute() },
                { key: 'deafen', label: () => m.settings_ui_sound_deafen() },
                { key: 'voiceChannel', label: () => m.settings_ui_sound_voice_channel() }
        ];

        function closeOverlay() {
                settingsOpen.set(false);
        }

        function setUiSoundEnabled(key: UiSoundSettingKey, enabled: boolean) {
                mutateAppSettings((settings) => {
                        if (settings.uiSounds[key] === enabled) {
                                return false;
                        }
                        settings.uiSounds[key] = enabled;
                        return true;
                });
        }
</script>

<SettingsPanel bind:open={$settingsOpen} on:close={closeOverlay}>
	<svelte:fragment slot="sidebar">
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
                        class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'appearance'
                                ? 'bg-[var(--panel)] font-semibold'
                                : ''}"
                        onclick={() => (category = 'appearance')}
                >
                        {m.appearance()}
                </button>
                <button
                        class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'notifications'
                                ? 'bg-[var(--panel)] font-semibold'
                                : ''}"
                        onclick={() => (category = 'notifications')}
                >
                        {m.notifications()}
                </button>
                <button
                        class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'voice-video'
                                ? 'bg-[var(--panel)] font-semibold'
                                : ''}"
                        onclick={() => (category = 'voice-video')}
		>
			{m.voice_video()}
		</button>
		<button
			class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'other'
				? 'bg-[var(--panel)] font-semibold'
				: ''}"
			onclick={() => (category = 'other')}
		>
			{m.other()}
		</button>
	</svelte:fragment>

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
							<span class="text-base font-medium">{lang.label()}</span>
							<span
								class={`ml-4 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
									$locale === lang.code ? 'border-[var(--success)]' : 'border-[var(--stroke-2)]'
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
									$theme === option.value ? 'border-[var(--brand)]' : 'border-[var(--stroke-2)]'
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
        {:else if category === 'notifications'}
                <div class="space-y-4">
                        <div class="rounded border border-[var(--stroke)] bg-[var(--panel)] p-4">
                                <h3 class="text-sm font-semibold">{m.settings_notifications_sounds()}</h3>
                                <p class="mt-1 text-xs text-[var(--muted)]">
                                        {m.settings_notifications_sounds_description()}
                                </p>
                                <div class="mt-4 grid gap-3 sm:grid-cols-2">
                                        {#each soundToggleOptions as option (option.key)}
                                                <label class="flex items-center gap-3 text-sm">
                                                        <input
                                                                type="checkbox"
                                                                checked={$appSettings.uiSounds[option.key]}
                                                                onchange={(event) =>
                                                                        setUiSoundEnabled(
                                                                                option.key,
                                                                                (event.currentTarget as HTMLInputElement).checked
                                                                        )
                                                                }
                                                        />
                                                        <span>{option.label()}</span>
                                                </label>
                                        {/each}
                                </div>
                        </div>
                </div>
        {:else if category === 'voice-video'}
                <VoiceVideoSettings />
        {:else}
                <p>{m.other()}...</p>
        {/if}
</SettingsPanel>
