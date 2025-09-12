<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { settingsOpen } from '$lib/stores/settings';
	import { m } from '$lib/paraglide/messages.js';

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

<div class="flex h-14 items-center justify-between border-t border-[var(--stroke)] px-3">
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
			on:click={toggleMute}
			title={muted ? m.unmute() : m.mute()}
			aria-label={muted ? m.unmute() : m.mute()}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				width="16"
				height="16"
				fill="currentColor"
			>
				<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
				<path d="M19 11a7 7 0 0 1-14 0" />
				<path d="M12 17v5" />
				<path d="M8 22h8" />
			</svg>
		</button>
		<button
			class="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)] {deafened
				? 'text-red-400'
				: ''}"
			on:click={toggleDeafen}
			title={deafened ? m.undeafen() : m.deafen()}
			aria-label={deafened ? m.undeafen() : m.deafen()}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				width="16"
				height="16"
				fill="currentColor"
			>
				<path
					d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h2v-8H5v0a7 7 0 0 1 14 0v0h-3v8h2a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9z"
				/>
			</svg>
		</button>
		<button
			class="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--panel)]"
			on:click={() => settingsOpen.set(true)}
			title={m.settings()}
			aria-label={m.settings()}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				width="16"
				height="16"
				fill="currentColor"
			>
				<path
					d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.007 7.007 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.5 2h-3a.5.5 0 0 0-.49.42l-.36 2.54a6.978 6.978 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L3.1 8.14a.5.5 0 0 0 .12.64l2.03 1.58c-.05.31-.07.63-.07.94 0 .31.02.63.07.94L3.22 13.82a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.44.34.7.22l2.39-.96c.5.39 1.05.72 1.63.94l.36 2.54c.04.26.25.42.49.42h3a.5.5 0 0 0 .49-.42l.36-2.54a7.007 7.007 0 0 0 1.63-.94l2.39.96c.26.11.56.02.7-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5S10.07 8.5 12 8.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
				/>
			</svg>
		</button>
	</div>
</div>
