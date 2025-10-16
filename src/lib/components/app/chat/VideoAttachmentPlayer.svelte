<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-svelte';

	export let src: string;
	export let poster: string | null = null;
	export let mediaStyle = '';
	export let preload: 'auto' | 'metadata' | 'none' = 'metadata';
	export let playsinline = false;

	let container: HTMLDivElement;
	let videoElement: HTMLVideoElement;

	let isPlaying = false;
	let isFullscreen = false;
	let duration = 0;
	let currentTime = 0;
	let seekPosition = 0;
	let isScrubbing = false;
	let volume = 1;
	let isMuted = false;
	let previousVolume = 0.5;

	function formatTime(value: number): string {
		if (!Number.isFinite(value) || value < 0) {
			return '0:00';
		}

		const totalSeconds = Math.floor(value);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	async function togglePlayback() {
		if (!videoElement) return;
		if (videoElement.paused) {
			try {
				await videoElement.play();
			} catch (error) {
				console.error('Failed to start video playback', error);
			}
		} else {
			videoElement.pause();
		}
	}

	function handlePlay() {
		isPlaying = true;
	}

	function handlePause() {
		isPlaying = false;
	}

	function handleEnded() {
		isPlaying = false;
		currentTime = duration;
	}

	function handleLoadedMetadata() {
		if (!videoElement) return;
		const videoDuration = videoElement.duration;
		duration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0;
		seekPosition = currentTime = videoElement.currentTime;
		volume = videoElement.volume;
		isMuted = videoElement.muted || videoElement.volume === 0;
	}

	function handleTimeUpdate() {
		if (!videoElement) return;
		if (!isScrubbing) {
			currentTime = videoElement.currentTime;
			seekPosition = currentTime;
		}
	}

	function handleSeekInput(event: Event) {
		if (!videoElement) return;
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		seekPosition = value;
		currentTime = value;
		videoElement.currentTime = value;
	}

	function handleSeekPointerDown() {
		isScrubbing = true;
	}

	function handleSeekPointerUp(event: PointerEvent) {
		if (!videoElement) return;
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		isScrubbing = false;
		currentTime = value;
		videoElement.currentTime = value;
	}

	function handleVolumeInput(event: Event) {
		if (!videoElement) return;
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		volume = value;
		if (value > 0) {
			previousVolume = value;
			videoElement.muted = false;
		}
		videoElement.volume = value;
		if (value === 0) {
			videoElement.muted = true;
		}
	}

	function toggleMute() {
		if (!videoElement) return;
		if (videoElement.muted || videoElement.volume === 0) {
			videoElement.muted = false;
			const restored = previousVolume > 0 ? previousVolume : 0.5;
			videoElement.volume = restored;
			volume = restored;
		} else {
			previousVolume = videoElement.volume || previousVolume;
			videoElement.muted = true;
		}
	}

	function toggleFullscreen() {
		if (!container) return;
		if (document.fullscreenElement === container) {
			void document.exitFullscreen();
		} else {
			void container.requestFullscreen();
		}
	}

	onMount(() => {
		const handleFullscreenChange = () => {
			isFullscreen = document.fullscreenElement === container;
		};

		const handleVolumeChange = () => {
			if (!videoElement) return;
			volume = videoElement.volume;
			isMuted = videoElement.muted || videoElement.volume === 0;
			if (!isMuted && videoElement.volume > 0) {
				previousVolume = videoElement.volume;
			}
		};

		document.addEventListener('fullscreenchange', handleFullscreenChange);
		videoElement?.addEventListener('volumechange', handleVolumeChange);

		return () => {
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			videoElement?.removeEventListener('volumechange', handleVolumeChange);
			if (document.fullscreenElement === container) {
				void document.exitFullscreen();
			}
		};
	});

	onDestroy(() => {
		if (document.fullscreenElement === container) {
			void document.exitFullscreen();
		}
	});
</script>

<div
	class="relative h-full w-full select-none"
	bind:this={container}
	on:dblclick={toggleFullscreen}
>
	<!-- svelte-ignore a11y_media_has_caption -->
        <video
                bind:this={videoElement}
                class="block bg-black"
                {src}
                preload={preload}
                poster={poster ?? undefined}
                playsinline={playsinline}
                style={mediaStyle}
		on:click={togglePlayback}
		on:play={handlePlay}
		on:pause={handlePause}
		on:ended={handleEnded}
		on:loadedmetadata={handleLoadedMetadata}
		on:timeupdate={handleTimeUpdate}
	></video>
	<div class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3">
		<div
			class="pointer-events-auto flex items-center gap-3 rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-white shadow-lg backdrop-blur"
		>
			<button
				class="grid h-9 w-9 place-items-center rounded-md bg-white/10 transition hover:bg-white/20"
				type="button"
				on:click|stopPropagation={togglePlayback}
				aria-label={isPlaying ? 'Pause video' : 'Play video'}
			>
				{#if isPlaying}
					<Pause class="h-5 w-5" stroke-width={2} />
				{:else}
					<Play class="h-5 w-5" stroke-width={2} />
				{/if}
			</button>
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<input
					class="h-1 w-full cursor-pointer accent-[var(--brand)]"
					type="range"
					min={0}
					max={duration || 0}
					step="0.1"
					value={isScrubbing ? seekPosition : currentTime}
					on:input={handleSeekInput}
					on:pointerdown={handleSeekPointerDown}
					on:pointerup={handleSeekPointerUp}
					aria-label="Video position"
					disabled={duration === 0}
				/>
				<div class="flex items-center justify-between text-[0.65rem] text-white/80">
					<span class="tabular-nums">{formatTime(currentTime)}</span>
					<span class="tabular-nums">{formatTime(duration)}</span>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="grid h-9 w-9 place-items-center rounded-md bg-white/10 transition hover:bg-white/20"
					type="button"
					on:click|stopPropagation={toggleMute}
					aria-label={isMuted ? 'Unmute video' : 'Mute video'}
				>
					{#if isMuted}
						<VolumeX class="h-5 w-5" stroke-width={2} />
					{:else}
						<Volume2 class="h-5 w-5" stroke-width={2} />
					{/if}
				</button>
				<input
					class="h-1 w-20 cursor-pointer accent-[var(--brand)]"
					type="range"
					min={0}
					max={1}
					step="0.05"
					value={volume}
					on:input={handleVolumeInput}
					aria-label="Volume"
				/>
				<button
					class="grid h-9 w-9 place-items-center rounded-md bg-white/10 transition hover:bg-white/20"
					type="button"
					on:click|stopPropagation={toggleFullscreen}
					aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
				>
					{#if isFullscreen}
						<Minimize2 class="h-5 w-5" stroke-width={2} />
					{:else}
						<Maximize2 class="h-5 w-5" stroke-width={2} />
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	input[type='range']:disabled {
		opacity: 0.4;
	}
</style>
