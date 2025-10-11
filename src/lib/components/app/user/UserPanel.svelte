<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { settingsOpen } from '$lib/stores/settings';
	import { m } from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import { HeadphoneOff, Headphones, Mic, MicOff, Settings, Check } from 'lucide-svelte';
	import {
		presenceIndicatorClass,
		selfPresenceMode,
		selfPresenceStatus,
		setSelfPresenceMode,
		type PresenceMode,
		type PresenceStatus
	} from '$lib/stores/presence';

	const user = auth.user;
	const presenceMode = selfPresenceMode;
	const presenceStatus = selfPresenceStatus;
	let muted = $state(false);
	let deafened = $state(false);
	let statusMenuOpen = $state(false);
	let statusMenuEl: HTMLDivElement | null = null;
	let statusTriggerEl: HTMLButtonElement | null = null;

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
		muted = !muted;
	}

	function toggleDeafen() {
		deafened = !deafened;
	}

	function toggleStatusMenu() {
		statusMenuOpen = !statusMenuOpen;
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

	function statusLabel(status: PresenceStatus): string {
		switch (status) {
			case 'online':
				return m.status_online();
			case 'idle':
				return m.status_idle();
			case 'dnd':
				return m.status_dnd();
			case 'offline':
			default:
				return m.status_offline();
		}
	}

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
                        class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-1 py-1 text-left hover:bg-[var(--panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] cursor-pointer"
                        onclick={toggleStatusMenu}
                        aria-haspopup="menu"
                        aria-expanded={statusMenuOpen}
                        bind:this={statusTriggerEl}
                >
			<div class="relative h-8 w-8 flex-shrink-0">
				<div
					class="flex h-full w-full items-center justify-center rounded-full bg-[var(--panel-strong)] text-sm font-medium"
				>
					{$user?.name?.[0] ?? m.user_default_name()[0]}
				</div>
				<span
					class={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-[var(--panel)] ${presenceIndicatorClass($presenceStatus)}`}
				/>
			</div>
			<div class="min-w-0">
				<div class="truncate text-sm font-medium">{$user?.name ?? m.user_default_name()}</div>
				<div class="truncate text-xs text-[var(--muted)]">{statusLabel($presenceStatus)}</div>
			</div>
		</button>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)] {muted
					? 'text-red-400'
					: ''}"
				onclick={toggleMute}
				title={muted ? m.unmute() : m.mute()}
				aria-label={muted ? m.unmute() : m.mute()}
			>
				{#if muted}
					<MicOff class="h-4 w-4" stroke-width={2} />
				{:else}
					<Mic class="h-4 w-4" stroke-width={2} />
				{/if}
			</button>
			<button
				type="button"
				class="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)] {deafened
					? 'text-red-400'
					: ''}"
				onclick={toggleDeafen}
				title={deafened ? m.undeafen() : m.deafen()}
				aria-label={deafened ? m.undeafen() : m.deafen()}
			>
				{#if deafened}
					<HeadphoneOff class="h-4 w-4" stroke-width={2} />
				{:else}
					<Headphones class="h-4 w-4" stroke-width={2} />
				{/if}
			</button>
			<button
				type="button"
				class="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)]"
				onclick={() => settingsOpen.set(true)}
				title={m.settings()}
				aria-label={m.settings()}
			>
				<Settings class="h-4 w-4" stroke-width={2} />
			</button>
		</div>
	</div>
	{#if statusMenuOpen}
		<div
			class="absolute bottom-[calc(100%+0.5rem)] left-3 z-40 w-64 rounded-md border border-[var(--stroke)] bg-[var(--panel)] p-2 shadow-lg"
			bind:this={statusMenuEl}
			role="menu"
			aria-label={m.status_menu_title()}
		>
			<div class="px-2 pb-2 text-xs font-semibold text-[var(--muted)] uppercase">
				{m.status_menu_title()}
			</div>
			<div class="space-y-1">
				{#each statusOptions as option (option.mode)}
                                        <button
                                                type="button"
                                                class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--panel-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] cursor-pointer"
                                                onpointerdown={(event) => handleStatusPointer(event, option)}
                                                onkeydown={(event) => handleStatusKey(event, option)}
                                                role="menuitemradio"
                                                aria-checked={isOptionActive(option, $presenceMode)}
                                        >
						<span
							class={`mt-1 h-3 w-3 flex-shrink-0 rounded-full border border-[var(--panel)] ${presenceIndicatorClass(option.indicator)}`}
						/>
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
		</div>
	{/if}
</div>
