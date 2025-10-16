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

        const FULLSCREEN_STYLE_OVERRIDE =
                'max-width: none; max-height: none; width: 100%; height: 100%; object-fit: contain;';

        $: effectiveMediaStyle =
                isFullscreen
                        ? `${mediaStyle}${mediaStyle && !mediaStyle.trim().endsWith(';') ? ';' : ''} ${FULLSCREEN_STYLE_OVERRIDE}`
                        : mediaStyle;

        const AUTO_HIDE_DELAY = 2500;
        const VOLUME_HIDE_DELAY = 700;

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

        function hideVolumeControls({ immediate = false, delay = VOLUME_HIDE_DELAY } = {}) {
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
                }, delay);
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
                hideVolumeControls({ delay: VOLUME_HIDE_DELAY });
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
                style={effectiveMediaStyle}
                on:click={togglePlayback}
		on:play={handlePlay}
		on:pause={handlePause}
		on:ended={handleEnded}
		on:loadedmetadata={handleLoadedMetadata}
		on:timeupdate={handleTimeUpdate}
	></video>
        <div
                class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-2 transition-opacity duration-300"
                class:opacity-0={!areControlsVisible}
        >
                <div
                        class="pointer-events-auto flex flex-col gap-1.5 rounded-xl border border-white/15 bg-black/65 px-2.5 py-2 text-white shadow-lg backdrop-blur"
                        on:pointerenter={lockControlsVisibility}
                        on:pointerleave={unlockControlsVisibility}
                >
                        <div class="flex w-full flex-col gap-1.5">
                                <div class="flex w-full items-center gap-1.5">
                                        <span class="flex-none text-[0.65rem] font-medium text-white/80 tabular-nums">
                                                {formatTime(currentTime)}
                                        </span>
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
                                                aria-label="Video position"
                                                disabled={duration === 0}
                                        />
                                        <span class="flex-none text-[0.65rem] font-medium text-white/80 tabular-nums">
                                                {formatTime(duration)}
                                        </span>
                                </div>
                                <div class="flex w-full items-center justify-between gap-1.5">
                                        <div class="flex items-center gap-1.5">
                                                <button
                                                        class="grid h-7 w-7 flex-none place-items-center rounded-lg bg-white/15 transition hover:bg-white/25"
                                                        type="button"
                                                        on:click|stopPropagation={togglePlayback}
                                                        data-tooltip-disabled
                                                        aria-label={isPlaying ? 'Pause video' : 'Play video'}
                                                >
                                                        {#if isPlaying}
                                                                <Pause class="h-4 w-4" stroke-width={2} />
                                                        {:else}
                                                                <Play class="h-4 w-4" stroke-width={2} />
                                                        {/if}
                                                </button>
                                        </div>
                                        <div class="flex flex-none items-center gap-1.5">
                                                <div
                                                        class="group relative"
                                                        bind:this={volumeControlsGroup}
                                                        on:focusin={() => showVolumeControls({ lock: true })}
                                                        on:focusout={handleVolumeGroupFocusOut}
                                                        on:pointerenter={() => showVolumeControls({ lock: true })}
                                                        on:pointerleave={handleVolumeGroupPointerLeave}
                                                >
                                                        <button
                                                                class="grid h-7 w-7 place-items-center rounded-lg bg-white/15 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                                                                type="button"
                                                                on:click|stopPropagation={toggleMute}
                                                                data-tooltip-disabled
                                                                aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                                                        >
                                                                {#if isMuted}
                                                                        <VolumeX class="h-4 w-4" stroke-width={2} />
                                                                {:else}
                                                                        <Volume2 class="h-4 w-4" stroke-width={2} />
                                                                {/if}
                                                        </button>
                                                        <div
                                                                class="absolute bottom-[calc(100%+0.15rem)] left-1/2 flex -translate-x-1/2 items-center rounded-md border border-white/20 bg-black/80 p-2 opacity-0 shadow-lg transition"
                                                                class:pointer-events-auto={isVolumeSliderVisible}
                                                                class:pointer-events-none={!isVolumeSliderVisible}
                                                                class:opacity-100={isVolumeSliderVisible}
                                                                on:pointerenter={() => showVolumeControls({ lock: true })}
                                                                on:pointerleave={handleVolumeGroupPointerLeave}
                                                        >
                                                                <input
                                                                        class="volume-slider h-24 w-2 cursor-pointer accent-[var(--brand)]"
                                                                        type="range"
                                                                        min={0}
                                                                        max={1}
                                                                        step="0.05"
                                                                        value={volume}
                                                                        on:input={handleVolumeInput}
                                                                        on:pointerdown={() => showVolumeControls({ lock: true })}
                                                                        aria-label="Volume"
                                                                />
                                                        </div>
                                                </div>
                                                <button
                                                        class="grid h-7 w-7 place-items-center rounded-lg bg-white/15 transition hover:bg-white/25"
                                                        type="button"
                                                        on:click|stopPropagation={toggleFullscreen}
                                                        data-tooltip-disabled
                                                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                                                >
                                                        {#if isFullscreen}
                                                                <Minimize2 class="h-4 w-4" stroke-width={2} />
                                                        {:else}
                                                                <Maximize2 class="h-4 w-4" stroke-width={2} />
                                                        {/if}
                                                </button>
                                        </div>
                                </div>
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
                width: 100% !important;
                height: 100% !important;
                max-width: 100vw;
                max-height: 100vh;
                object-fit: contain;
                object-position: center;
                border-radius: 0 !important;
                box-shadow: none !important;
        }
</style>
