<script lang="ts">
	import { wsConnectionLost } from '$lib/client/ws';
	import { fade } from 'svelte/transition';
</script>

{#if $wsConnectionLost}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-[1000] flex justify-center"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="pointer-events-auto h-1 w-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]"
			role="status"
			aria-live="polite"
		>
			<span class="sr-only">Connection lost. Attempting to reconnect…</span>
		</div>
	</div>
{/if}
