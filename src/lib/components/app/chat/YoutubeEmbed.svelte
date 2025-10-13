<script lang="ts">
	export let videoId: string;
	export let url: string;

	let isPlaying = false;

	const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

	function loadPlayer() {
		isPlaying = true;
	}
</script>

<div
	class="relative w-full max-w-xl overflow-hidden rounded-lg border border-[var(--stroke)] bg-black"
	style="aspect-ratio: 16 / 9;"
>
	{#if isPlaying}
		<iframe
			class="h-full w-full"
			src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
			title="YouTube video player"
			allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
			allowfullscreen
		></iframe>
	{:else}
                <button
                        type="button"
                        class="group relative flex h-full w-full items-center justify-center focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
                        onclick={loadPlayer}
                        aria-label="Play YouTube video"
                        data-tooltip-disabled
                >
			<img
				alt="YouTube video preview"
				class="absolute inset-0 h-full w-full object-cover"
				loading="lazy"
				src={thumbnailUrl}
			/>
			<span class="absolute inset-0 bg-black/40 transition group-hover:bg-black/50"></span>
			<span
				class="relative flex items-center justify-center rounded-full bg-white/80 p-4 transition group-hover:bg-white"
			>
				<svg aria-hidden="true" class="h-6 w-6 text-black" fill="currentColor" viewBox="0 0 24 24">
					<path d="M8 5v14l11-7z"></path>
				</svg>
			</span>
		</button>
	{/if}
</div>

<!--
        Provide an accessible link fallback if JavaScript is disabled.
        Using <noscript> ensures the original URL remains reachable.
-->
<noscript>
	<a
		class="block w-full max-w-xl overflow-hidden rounded-lg border border-[var(--stroke)]"
		href={url}
		rel="noopener noreferrer"
		target="_blank"
	>
		<img alt="YouTube video preview" class="h-full w-full object-cover" src={thumbnailUrl} />
	</a>
</noscript>
