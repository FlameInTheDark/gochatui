<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Pause, Play, Volume2, VolumeX } from 'lucide-svelte';

	export let src: string;
	export let preload: 'auto' | 'metadata' | 'none' = 'metadata';

	let audioElement: HTMLAudioElement;

	let isPlaying = false;
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
		if (!audioElement) return;
		if (audioElement.paused) {
			try {
				await audioElement.play();
			} catch (error) {
				console.error('Failed to start audio playback', error);
			}
		} else {
			audioElement.pause();
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
		if (!audioElement) return;
		const audioDuration = audioElement.duration;
		duration = Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : 0;
		seekPosition = currentTime = audioElement.currentTime;
		volume = audioElement.volume;
		isMuted = audioElement.muted || audioElement.volume === 0;
	}

	function handleTimeUpdate() {
		if (!audioElement || isScrubbing) return;
		currentTime = audioElement.currentTime;
	}

	function handleSeekInput(event: Event) {
		if (!audioElement) return;
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		seekPosition = value;
		currentTime = value;
		audioElement.currentTime = value;
	}

	function handleSeekPointerDown() {
		isScrubbing = true;
	}

	function handleSeekPointerUp(event: PointerEvent) {
		if (!audioElement) return;
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		isScrubbing = false;
		currentTime = value;
		audioElement.currentTime = value;
	}

	function handleVolumeInput(event: Event) {
		if (!audioElement) return;
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		volume = value;
		if (value > 0) {
			previousVolume = value;
			audioElement.muted = false;
			isMuted = false;
			audioElement.volume = value;
		} else {
			audioElement.volume = 0;
			audioElement.muted = true;
			isMuted = true;
		}
	}

	function toggleMute() {
		if (!audioElement) return;
		if (audioElement.muted || audioElement.volume === 0) {
			audioElement.muted = false;
			const restored = previousVolume > 0 ? previousVolume : 0.5;
			audioElement.volume = restored;
			volume = restored;
			isMuted = false;
		} else {
			previousVolume = audioElement.volume || previousVolume;
			audioElement.muted = true;
			audioElement.volume = 0;
			volume = 0;
			isMuted = true;
		}
	}

	onMount(() => {
		const handleVolumeChange = () => {
			if (!audioElement) return;
			volume = audioElement.volume;
			isMuted = audioElement.muted || audioElement.volume === 0;
			if (!isMuted && audioElement.volume > 0) {
				previousVolume = audioElement.volume;
			}
		};

		audioElement?.addEventListener('volumechange', handleVolumeChange);

		return () => {
			audioElement?.removeEventListener('volumechange', handleVolumeChange);
		};
	});

	onDestroy(() => {
		if (audioElement) {
			audioElement.pause();
		}
	});
</script>

<!-- svelte-ignore a11y_media_has_caption -->
<audio
        bind:this={audioElement}
        hidden
        aria-hidden="true"
        tabindex="-1"
        {src}
        {preload}
        on:play={handlePlay}
        on:pause={handlePause}
        on:ended={handleEnded}
        on:loadedmetadata={handleLoadedMetadata}
        on:timeupdate={handleTimeUpdate}
></audio>

<div
	class="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-white shadow-inner"
>
	<div class="flex items-center gap-2">
		<button
			class="grid h-8 w-8 flex-none place-items-center rounded-lg bg-white/15 transition hover:bg-white/25"
			type="button"
			on:click={togglePlayback}
			data-tooltip-disabled
		>
			<span class="sr-only">{isPlaying ? 'Pause audio' : 'Play audio'}</span>
			{#if isPlaying}
				<Pause class="h-4 w-4" stroke-width={2} />
			{:else}
				<Play class="h-4 w-4" stroke-width={2} />
			{/if}
		</button>
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<div class="flex items-center gap-2 text-[0.65rem] font-medium text-white/80 tabular-nums">
				<span class="flex-none">{formatTime(currentTime)}</span>
				<input
					class="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--brand)]"
					type="range"
					min={0}
					max={duration || 0}
					step="0.1"
					value={isScrubbing ? seekPosition : currentTime}
					on:input={handleSeekInput}
					on:pointerdown={handleSeekPointerDown}
					on:pointerup={handleSeekPointerUp}
					aria-label="Audio position"
					disabled={duration === 0}
				/>
				<span class="flex-none">{formatTime(duration)}</span>
			</div>
			<div class="flex items-center gap-2 text-[0.65rem] font-medium text-white/80">
				<button
					class="grid h-7 w-7 flex-none place-items-center rounded-lg bg-white/15 transition hover:bg-white/25"
					type="button"
					on:click={toggleMute}
					data-tooltip-disabled
				>
					<span class="sr-only">{isMuted ? 'Unmute audio' : 'Mute audio'}</span>
					{#if isMuted}
						<VolumeX class="h-4 w-4" stroke-width={2} />
					{:else}
						<Volume2 class="h-4 w-4" stroke-width={2} />
					{/if}
				</button>
				<input
					class="h-1.5 w-full cursor-pointer accent-[var(--brand)]"
					type="range"
					min={0}
					max={1}
					step="0.05"
					value={volume}
					on:input={handleVolumeInput}
					aria-label="Volume"
				/>
			</div>
		</div>
	</div>
</div>

<style>
	input[type='range']:disabled {
		opacity: 0.4;
	}
</style>
