<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { settingsOpen } from '$lib/stores/settings';
        import { m } from '$lib/paraglide/messages.js';
        import { HeadphoneOff, Headphones, Mic, MicOff, Settings } from 'lucide-svelte';

	const user = auth.user;
	let muted = $state(false);
	let deafened = $state(false);

	function toggleMute() {
		muted = !muted;
	}

	function toggleDeafen() {
		deafened = !deafened;
	}
</script>

<div class="border-t border-[var(--stroke)] p-3">
	<div class="flex h-11 items-center justify-between">
		<div class="flex items-center gap-2 overflow-hidden">
			<div
				class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--panel-strong)] text-sm font-medium"
			>
				{$user?.name?.[0] ?? m.user_default_name()[0]}
			</div>
			<div class="truncate text-sm">{$user?.name ?? m.user_default_name()}</div>
		</div>
		<div class="flex items-center gap-1">
                        <button
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
                                class="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)]"
                                onclick={() => settingsOpen.set(true)}
                                title={m.settings()}
                                aria-label={m.settings()}
                        >
                                <Settings class="h-4 w-4" stroke-width={2} />
                        </button>
                </div>
        </div>
</div>
