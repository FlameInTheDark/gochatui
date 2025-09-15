<script lang="ts">
	import { wsConnectionLost } from '$lib/client/ws';
	import { m } from '$lib/paraglide/messages.js';
	import { fade } from 'svelte/transition';
</script>

{#if $wsConnectionLost}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-[1000] flex justify-center px-4"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="pointer-events-auto flex w-full max-w-3xl items-center justify-center gap-2 rounded-b-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-[0_4px_12px_rgba(220,38,38,0.45)]"
			role="status"
			aria-live="polite"
		>
			<span aria-hidden="true">⚠️</span>
			<span class="text-center">{m.connection_status_reconnecting()}</span>
		</div>
	</div>
{/if}
