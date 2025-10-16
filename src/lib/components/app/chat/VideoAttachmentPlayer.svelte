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
	let areControlsVisible = true;
	let isAutoHideLocked = false;
	let hideControlsTimeout: ReturnType<typeof setTimeout> | null = null;
	let isVolumeSliderVisible = false;
	let isVolumeSliderLockActive = false;
	let volumeControlsGroup: HTMLDivElement;
	let hideVolumeControlsTimeout: ReturnType<typeof setTimeout> | null = null;

	const AUTO_HIDE_DELAY = 2500;

	function clearHideControlsTimeout() {
		if (hideControlsTimeout) {
			clearTimeout(hideControlsTimeout);
			hideControlsTimeout = null;
		}
	}

	function hideControls() {
		clearHideControlsTimeout();
		areControlsVisible = false;
	}

	function scheduleHideControls() {
		clearHideControlsTimeout();
		hideControlsTimeout = setTimeout(() => {
			if (!isAutoHideLocked) {
				areControlsVisible = false;
			}
		}, AUTO_HIDE_DELAY);
	}

	function showControls({ autoHide = true } = {}) {
		areControlsVisible = true;
		const shouldAutoHide = autoHide && !isAutoHideLocked;
		clearHideControlsTimeout();
		if (shouldAutoHide) {
			scheduleHideControls();
		}
	}

	function lockControlsVisibility() {
		isAutoHideLocked = true;
		showControls({ autoHide: false });
	}

	function unlockControlsVisibility() {
		isAutoHideLocked = false;
		showControls();
	}

	function clearHideVolumeControlsTimeout() {
		if (!hideVolumeControlsTimeout) return;
		clearTimeout(hideVolumeControlsTimeout);
		hideVolumeControlsTimeout = null;
	}

	function showVolumeControls({ lock = false } = {}) {
		clearHideVolumeControlsTimeout();
		if (!isVolumeSliderVisible) {
			isVolumeSliderVisible = true;
		}
		if (lock) {
			isVolumeSliderLockActive = true;
			lockControlsVisibility();
		}
	}

	function hideVolumeControls({ immediate = false } = {}) {
		if (!isVolumeSliderVisible) return;
		const performHide = () => {
			isVolumeSliderVisible = false;
			if (isVolumeSliderLockActive) {
				isVolumeSliderLockActive = false;
				unlockControlsVisibility();
			}
		};

		if (immediate) {
			clearHideVolumeControlsTimeout();
			performHide();
			return;
		}

		clearHideVolumeControlsTimeout();
		hideVolumeControlsTimeout = setTimeout(() => {
			performHide();
			hideVolumeControlsTimeout = null;
		}, 150);
	}

	function handleFocusIn() {
		lockControlsVisibility();
	}

	function handleFocusOut(event: FocusEvent) {
		if (!container) return;
		const nextTarget = event.relatedTarget as Node | null;
		if (nextTarget && container.contains(nextTarget)) {
			return;
		}
		unlockControlsVisibility();
	}

	function handleVolumeGroupFocusOut(event: FocusEvent) {
		if (!volumeControlsGroup) return;
		const nextTarget = event.relatedTarget as Node | null;
		if (nextTarget && volumeControlsGroup.contains(nextTarget)) {
			return;
		}
		hideVolumeControls({ immediate: true });
	}

	function handleVolumeGroupPointerLeave() {
		hideVolumeControls();
	}

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
		showControls();
	}

	function handlePause() {
		isPlaying = false;
		showControls({ autoHide: false });
	}

	function handleEnded() {
		isPlaying = false;
		currentTime = duration;
		showControls({ autoHide: false });
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
		if (isPlaying) {
			showControls();
		}
	}

	function handleVolumeInput(event: Event) {
		if (!videoElement) return;
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		volume = value;
		if (value > 0) {
			previousVolume = value;
			videoElement.muted = false;
			isMuted = false;
			videoElement.volume = value;
		} else {
			videoElement.volume = 0;
			videoElement.muted = true;
			isMuted = true;
		}
		showControls({ autoHide: false });
	}

	function toggleMute() {
		if (!videoElement) return;
		if (videoElement.muted || videoElement.volume === 0) {
			videoElement.muted = false;
			const restored = previousVolume > 0 ? previousVolume : 0.5;
			videoElement.volume = restored;
			volume = restored;
			isMuted = false;
		} else {
			previousVolume = videoElement.volume || previousVolume;
			videoElement.muted = true;
			videoElement.volume = 0;
			volume = 0;
			isMuted = true;
		}
		showControls({ autoHide: false });
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

		const handlePointerMove = () => {
			showControls();
		};

		document.addEventListener('fullscreenchange', handleFullscreenChange);
		videoElement?.addEventListener('volumechange', handleVolumeChange);
		container?.addEventListener('pointermove', handlePointerMove);

		return () => {
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			videoElement?.removeEventListener('volumechange', handleVolumeChange);
			container?.removeEventListener('pointermove', handlePointerMove);
			if (document.fullscreenElement === container) {
				void document.exitFullscreen();
			}
		};
	});

	onDestroy(() => {
		clearHideControlsTimeout();
		clearHideVolumeControlsTimeout();
		if (document.fullscreenElement === container) {
			void document.exitFullscreen();
		}
	});
</script>

<div
	class="video-player-container relative h-full w-full select-none"
	bind:this={container}
	role="presentation"
	on:dblclick={toggleFullscreen}
	on:mouseenter={() => {
		showControls();
	}}
	on:mouseleave={() => {
		isAutoHideLocked = false;
		hideControls();
	}}
	on:focusin={handleFocusIn}
	on:focusout={handleFocusOut}
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={videoElement}
		class="block bg-black"
		{src}
		{preload}
		poster={poster ?? undefined}
		{playsinline}
		style={mediaStyle}
		on:click={togglePlayback}
		on:play={handlePlay}
		on:pause={handlePause}
		on:ended={handleEnded}
		on:loadedmetadata={handleLoadedMetadata}
		on:timeupdate={handleTimeUpdate}
	></video>
	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 transition-opacity duration-300"
		class:opacity-0={!areControlsVisible}
	>
		<div
			class="pointer-events-auto flex flex-col gap-2 rounded-lg border border-white/20 bg-black/60 px-2.5 py-1.5 text-white shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-3"
			on:pointerenter={lockControlsVisibility}
			on:pointerleave={unlockControlsVisibility}
		>
			<div class="flex w-full items-center gap-2 sm:flex-1 sm:gap-3">
				<button
					class="grid h-8 w-8 flex-none place-items-center rounded-md bg-white/10 transition hover:bg-white/20"
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
			</div>
			<div class="flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-none">
				<div
					class="group relative"
					bind:this={volumeControlsGroup}
					on:focusin={() => showVolumeControls({ lock: true })}
					on:focusout={handleVolumeGroupFocusOut}
					on:pointerenter={() => showVolumeControls()}
					on:pointerleave={handleVolumeGroupPointerLeave}
				>
					<button
						class="grid h-8 w-8 place-items-center rounded-md bg-white/10 transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
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
					<div
						class="pointer-events-none absolute bottom-11 left-1/2 flex -translate-x-1/2 items-center rounded-md border border-white/20 bg-black/80 p-3 opacity-0 shadow-lg transition"
						class:pointer-events-auto={isVolumeSliderVisible}
						class:opacity-100={isVolumeSliderVisible}
						on:pointerenter={() => showVolumeControls()}
					>
						<input
							class="volume-slider h-24 w-2 cursor-pointer accent-[var(--brand)]"
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
				<button
					class="grid h-8 w-8 place-items-center rounded-md bg-white/10 transition hover:bg-white/20"
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

	.volume-slider {
		writing-mode: vertical-lr;
		direction: rtl;
	}

	:global(.video-player-container:fullscreen),
	:global(.video-player-container:-webkit-full-screen) {
		width: 100vw;
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: black;
	}

	:global(.video-player-container:fullscreen video),
	:global(.video-player-container:-webkit-full-screen video) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
