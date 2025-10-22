<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { settingsOpen } from '$lib/stores/settings';
	import { m } from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
        import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff, Settings, Check } from 'lucide-svelte';
        import {
                presenceIndicatorClass,
                selfCustomStatusText,
                selfPresenceMode,
                selfPresenceStatus,
                setSelfCustomStatusText,
                setSelfPresenceMode,
                type PresenceMode,
                type PresenceStatus
        } from '$lib/stores/presence';
        import { presenceStatusLabel } from '$lib/utils/presenceLabels';
        import { resolveAvatarUrl } from '$lib/utils/avatar';
        import { channelsByGuild } from '$lib/stores/appState';
        import {
                leaveVoiceChannel,
                toggleVoiceMuted as toggleVoiceMutedStore,
                toggleVoiceDeafened as toggleVoiceDeafenedStore,
                voiceSession
        } from '$lib/stores/voice';

        const user = auth.user;
        const presenceMode = selfPresenceMode;
        const presenceStatus = selfPresenceStatus;
        const customStatusText = selfCustomStatusText;
        const voice = voiceSession;
        const guildChannels = channelsByGuild;
        let statusMenuOpen = $state(false);
        let statusMenuEl: HTMLDivElement | null = $state(null);
        let statusTriggerEl: HTMLButtonElement | null = $state(null);
        let customStatusDraft = $state('');
        let customStatusDirty = $state(false);

	const displayName = $derived.by(() => {
		const candidates = [
			$user?.name,
			($user as any)?.display_name,
			($user as any)?.global_name,
			($user as any)?.username
		];

		for (const candidate of candidates) {
			if (typeof candidate !== 'string') continue;
			const trimmed = candidate.trim();
			if (trimmed) {
				return trimmed;
			}
		}

		return m.user_default_name();
	});

	const avatarInitial = $derived.by(() => {
		const name = displayName ?? '';
		return name.trim().charAt(0).toUpperCase() || '?';
	});

        const avatarUrl = $derived.by(() => resolveAvatarUrl($user));

        const voiceActive = $derived.by(() => {
                const status = $voice.status;
                return status === 'connecting' || status === 'connected';
        });

        const voiceChannelLabel = $derived.by(() => {
                const state = $voice;
                if (!state.guildId || !state.channelId) return null;
                const list = $guildChannels[state.guildId] ?? [];
                const match = list.find((channel: any) => String((channel as any)?.id ?? '') === state.channelId);
                const name = (match as any)?.name;
                if (typeof name === 'string' && name.trim()) return name.trim();
                return state.channelId ?? null;
        });

        const voiceStatusText = $derived.by(() => {
                const state = $voice;
                if (state.status !== 'connecting' && state.status !== 'connected') return null;
                const label = voiceChannelLabel ?? m.voice_channel_unknown();
                if (state.status === 'connecting') {
                        return m.voice_status_connecting({ channel: label });
                }
                return m.voice_status_connected({ channel: label });
        });

        const voiceError = $derived.by(() => {
                if ($voice.status !== 'error') return null;
                return $voice.error ?? m.voice_status_error();
        });

	type StatusOption = {
		mode: PresenceMode;
		indicator: PresenceStatus;
		label: string;
		description: string;
	};

	const statusOptions: StatusOption[] = [
		{
			mode: 'auto',
			indicator: 'online',
			label: m.status_online(),
			description: m.status_online_description()
		},
		{
			mode: 'idle',
			indicator: 'idle',
			label: m.status_idle(),
			description: m.status_idle_description()
		},
		{
			mode: 'dnd',
			indicator: 'dnd',
			label: m.status_dnd(),
			description: m.status_dnd_description()
		},
		{
			mode: 'offline',
			indicator: 'offline',
			label: m.status_offline(),
			description: m.status_offline_description()
		}
	];

        function toggleMute() {
                toggleVoiceMutedStore();
        }

        function toggleDeafen() {
                toggleVoiceDeafenedStore();
        }

	function toggleStatusMenu() {
		statusMenuOpen = !statusMenuOpen;
		if (statusMenuOpen) {
			customStatusDraft = $customStatusText ?? '';
			customStatusDirty = false;
		} else {
			customStatusDraft = $customStatusText ?? '';
			customStatusDirty = false;
		}
	}

	function selectStatus(option: StatusOption) {
		setSelfPresenceMode(option.mode);
		statusMenuOpen = false;
	}

	function handleStatusPointer(event: PointerEvent, option: StatusOption) {
		if (event.button !== 0) return;
		event.stopPropagation();
		selectStatus(option);
	}

	function handleStatusKey(event: KeyboardEvent, option: StatusOption) {
		if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Space') return;
		event.preventDefault();
		event.stopPropagation();
		selectStatus(option);
	}

	function isOptionActive(option: StatusOption, mode: PresenceMode): boolean {
		if (option.mode === 'auto') return mode === 'auto';
		return mode === option.mode;
	}

	function applyCustomStatus() {
		const trimmed = customStatusDraft.trim().slice(0, 256);
		const nextValue = trimmed.length ? trimmed : '';
		customStatusDraft = nextValue;
		customStatusDirty = false;
		setSelfCustomStatusText(nextValue.length ? nextValue : null);
	}

	function clearCustomStatus() {
		customStatusDraft = '';
		customStatusDirty = false;
		setSelfCustomStatusText(null);
	}

	function handleCustomStatusInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement | null;
		if (!target) return;
		customStatusDraft = target.value;
		customStatusDirty = true;
	}

	function handleCustomStatusKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			applyCustomStatus();
		}
	}

	function handleCustomStatusBlur() {
		if (customStatusDirty) {
			applyCustomStatus();
		}
	}

	$effect(() => {
		if (!statusMenuOpen) {
			customStatusDraft = $customStatusText ?? '';
			customStatusDirty = false;
		}
	});

	onMount(() => {
		const handlePointer = (event: MouseEvent | TouchEvent) => {
			if (!statusMenuOpen) return;
			const target = event.target as Node | null;
			if (!target) return;
			if (statusMenuEl && statusMenuEl.contains(target)) return;
			if (statusTriggerEl && statusTriggerEl.contains(target)) return;
			statusMenuOpen = false;
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				statusMenuOpen = false;
			}
		};
		document.addEventListener('mousedown', handlePointer, { passive: true });
		document.addEventListener('touchstart', handlePointer, { passive: true });
		window.addEventListener('keydown', handleKey, { passive: true });
		return () => {
			document.removeEventListener('mousedown', handlePointer);
			document.removeEventListener('touchstart', handlePointer);
			window.removeEventListener('keydown', handleKey);
		};
	});
</script>

<div class="relative border-t border-[var(--stroke)] p-3">
	<div class="flex h-11 items-center justify-between gap-2">
		<button
			type="button"
			class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-1 py-1 text-left hover:bg-[var(--panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
			onclick={toggleStatusMenu}
			aria-haspopup="menu"
			aria-expanded={statusMenuOpen}
			bind:this={statusTriggerEl}
			data-tooltip-disabled
		>
			<div class="relative h-8 w-8 flex-shrink-0">
				{#if avatarUrl}
					<img alt={displayName} class="h-full w-full rounded-full object-cover" src={avatarUrl} />
				{:else}
					<div
						class="flex h-full w-full items-center justify-center rounded-full bg-[var(--panel-strong)] text-sm font-medium"
					>
						{avatarInitial}
					</div>
				{/if}
				<span
					class={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--panel)] ${presenceIndicatorClass($presenceStatus)}`}
				></span>
			</div>
			<div class="min-w-0">
				<div class="truncate text-sm font-medium">{displayName}</div>
				<div class="truncate text-xs text-[var(--muted)]">
					{presenceStatusLabel($presenceStatus, $customStatusText)}
				</div>
			</div>
		</button>
                <div class="flex items-center gap-1">
                        <button
                                type="button"
                                class={`grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)] ${
                                        $voice.muted ? 'text-red-400' : ''
                                } ${voiceActive ? '' : 'opacity-50'}`.trim()}
                                onclick={toggleMute}
                                aria-label={$voice.muted ? m.unmute() : m.mute()}
                        >
                                {#if $voice.muted}
                                        <MicOff class="h-4 w-4" stroke-width={2} />
                                {:else}
                                        <Mic class="h-4 w-4" stroke-width={2} />
                                {/if}
                        </button>
                        <button
                                type="button"
                                class={`grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)] ${
                                        $voice.deafened ? 'text-red-400' : ''
                                } ${voiceActive ? '' : 'opacity-50'}`.trim()}
                                onclick={toggleDeafen}
                                aria-label={$voice.deafened ? m.undeafen() : m.deafen()}
                        >
                                {#if $voice.deafened}
                                        <HeadphoneOff class="h-4 w-4" stroke-width={2} />
                                {:else}
                                        <Headphones class="h-4 w-4" stroke-width={2} />
                                {/if}
                        </button>
                        {#if voiceActive}
                                <button
                                        type="button"
                                        class="grid h-8 w-8 place-items-center rounded-md text-[var(--brand)] hover:bg-[var(--panel)]"
                                        onclick={leaveVoiceChannel}
                                        aria-label={m.voice_leave_channel()}
                                >
                                        <PhoneOff class="h-4 w-4" stroke-width={2} />
                                </button>
                        {/if}
                        <button
                                type="button"
                                class="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)]"
                                onclick={() => settingsOpen.set(true)}
                                aria-label={m.settings()}
			>
				<Settings class="h-4 w-4" stroke-width={2} />
			</button>
                </div>
        </div>
        {#if voiceStatusText}
                <div class="mt-2 rounded border border-[var(--stroke)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]">
                        {voiceStatusText}
                </div>
        {:else if voiceError}
                <div class="mt-2 rounded border border-red-500 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                        {voiceError}
                </div>
        {/if}
        {#if statusMenuOpen}
                <div
                        class="absolute bottom-[calc(100%+0.5rem)] left-3 z-40"
			bind:this={statusMenuEl}
			role="menu"
			aria-label={m.status_menu_title()}
		>
			<div class="w-64 rounded-lg backdrop-blur-md">
				<div
					class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel)] p-2 shadow-lg"
				>
					<div class="px-2 pb-2 text-xs font-semibold text-[var(--muted)] uppercase">
						{m.status_menu_title()}
					</div>
					<div class="space-y-1">
						{#each statusOptions as option (option.mode)}
							<button
								type="button"
								class="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--panel-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
								onpointerdown={(event) => handleStatusPointer(event, option)}
								onkeydown={(event) => handleStatusKey(event, option)}
								role="menuitemradio"
								aria-checked={isOptionActive(option, $presenceMode)}
							>
								<span
									class={`mt-1 h-3 w-3 flex-shrink-0 rounded-full border border-[var(--panel)] ${presenceIndicatorClass(option.indicator)}`}
								></span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="truncate text-sm font-medium">{option.label}</span>
										{#if isOptionActive(option, $presenceMode)}
											<Check class="h-4 w-4 text-[var(--accent)]" stroke-width={2} />
										{/if}
									</div>
									<div class="truncate text-xs text-[var(--muted)]">{option.description}</div>
								</div>
							</button>
						{/each}
					</div>
					<div class="mt-3 border-t border-[var(--stroke)] pt-3">
						<label
							class="text-xs font-semibold text-[var(--muted)] uppercase"
							for="custom-status-input"
						>
							{m.status_custom_label()}
						</label>
						<div class="mt-1 flex items-center gap-2">
							<input
								id="custom-status-input"
								class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
								type="text"
								value={customStatusDraft}
								oninput={handleCustomStatusInput}
								onkeydown={handleCustomStatusKey}
								onblur={handleCustomStatusBlur}
								placeholder={m.status_custom_placeholder()}
							/>
							{#if $customStatusText}
								<button
									type="button"
									class="rounded-md px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--panel-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
									onclick={clearCustomStatus}
								>
									{m.status_custom_clear()}
								</button>
							{/if}
						</div>
						<p class="mt-1 text-xs text-[var(--muted)]">{m.status_custom_help()}</p>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
