<script lang="ts">
	import { onDestroy } from 'svelte';

	const props = $props<{
		stream: MediaStream;
		label: string;
		badge?: string | null;
		speaking?: boolean;
	}>();

	let videoEl: HTMLVideoElement | null = $state(null);

	$effect(() => {
		if (!videoEl) return;
		const stream = props.stream;
		if (!stream) {
			videoEl.srcObject = null;
			return;
		}
		if (videoEl.srcObject !== stream) {
			videoEl.srcObject = stream;
			const playPromise = videoEl.play();
			if (playPromise && typeof playPromise.catch === 'function') {
				playPromise.catch(() => {});
			}
		}
	});

	onDestroy(() => {
		if (!videoEl) return;
		try {
			videoEl.pause();
		} catch {}
		videoEl.srcObject = null;
	});
</script>

<div
	class={`relative aspect-video overflow-hidden rounded-lg border border-[var(--stroke)] bg-black ${
		props.speaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[var(--bg)]' : ''
	}`.trim()}
>
	<video bind:this={videoEl} class="h-full w-full object-cover" autoplay muted playsinline></video>
	<div
		class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-3 py-2 text-xs text-white"
	>
		<span class="min-w-0 truncate">{props.label}</span>
		{#if props.badge}
			<span class="text-[10px] tracking-wide uppercase opacity-70">{props.badge}</span>
		{/if}
	</div>
</div>
