<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
        import { m } from '$lib/paraglide/messages.js';
        import {
                appSettings,
                cloneDeviceSettings,
                convertAppSettingsToApi,
                mutateAppSettingsWithoutSaving,
                type DeviceSettings
        } from '$lib/stores/settings';
        import { auth } from '$lib/stores/auth';
        import {
                AUDIO_LEVEL_DB_MAX,
                analyzeTimeDomainLevel,
                decibelsToNormalized,
                normalizedToDecibels
        } from '$lib/utils/audio';

	const SYSTEM_DEVICE_ID = '__system__';
	const INPUT_VOLUME_MAX = 1;
        const OUTPUT_VOLUME_MAX = 1.5;
        const THRESHOLD_MAX = 1;
        const THRESHOLD_UI_DB_MIN = -60;
        const THRESHOLD_UI_DB_MAX = AUDIO_LEVEL_DB_MAX;
        const THRESHOLD_UI_DB_RANGE = THRESHOLD_UI_DB_MAX - THRESHOLD_UI_DB_MIN;
        const THRESHOLD_NORMALIZED_MIN = decibelsToNormalized(THRESHOLD_UI_DB_MIN);
        const MIC_PREVIEW_GATE_HOLD_MS = 300;
        const MIC_PREVIEW_GATE_CLOSE_RATIO = 0.7;
	const INPUT_VOLUME_PERCENT_MAX = 100;
	const OUTPUT_VOLUME_PERCENT_MAX = 150;

	type MessageVariant = 'success' | 'error' | 'info';

	interface FeedbackMessage {
		text: string;
		variant: MessageVariant;
	}

        let form: DeviceSettings = normalizeDeviceSettings(cloneDeviceSettings(get(appSettings).devices));
        let currentSettings: DeviceSettings = normalizeDeviceSettings(cloneDeviceSettings(get(appSettings).devices));
	let dirty = false;
	let saving = false;
	let message: FeedbackMessage | null = null;

	let audioInputDevices: MediaDeviceInfo[] = [];
	let audioOutputDevices: MediaDeviceInfo[] = [];
	let videoDevices: MediaDeviceInfo[] = [];
	let devicesLoading = false;
	let devicesError: string | null = null;
	let showPermissionReminder = false;

	let micPreviewSupported = browser && typeof navigator.mediaDevices?.getUserMedia === 'function';
	let micPreviewLoading = false;
        let micPreviewError: string | null = null;
        let micPreviewActive = false;
        let micPreviewLevel = 0;
        let micPreviewSpeaking = false;
        let micPreviewGateOpen = false;
        let micPreviewLastGateOpenAt = 0;
        let micPreviewThresholdPercent = 0;
        let micPreviewLevelPercent = 0;
        let micPreviewDisplayPercent = 0;
        let micPreviewSignature = '';
        let micPreviewRaf: number | null = null;
        let micPreviewStream: MediaStream | null = null;
        let micPreviewContext: AudioContext | null = null;
        let micPreviewSource: MediaStreamAudioSourceNode | null = null;
	let micPreviewInputGain: GainNode | null = null;
	let micPreviewAnalyser: AnalyserNode | null = null;
        let micPreviewOutputGain: GainNode | null = null;
        let micPreviewGateGain: GainNode | null = null;
        let micPreviewDestination: MediaStreamAudioDestinationNode | null = null;
        let micPreviewBuffer: Uint8Array<ArrayBuffer> | null = null;
        let micPreviewAudioElement: HTMLAudioElement | null = null;
        let thresholdSliderElement: HTMLDivElement | null = null;
        let thresholdDragging = false;
	const sinkIdSupported =
		typeof HTMLMediaElement !== 'undefined' &&
		typeof HTMLMediaElement.prototype.setSinkId === 'function';
	let micPreviewAppliedSink: string | null = null;
	let micPreviewSinkErrorLogged = false;
	let cameraPreviewSupported =
		browser && typeof navigator.mediaDevices?.getUserMedia === 'function';
	let cameraPreviewLoading = false;
	let cameraPreviewError: string | null = null;
	let cameraPreviewActive = false;
	let cameraPreviewSignature = '';
	let cameraPreviewStream: MediaStream | null = null;
	let cameraPreviewElement: HTMLVideoElement | null = null;
	const inputVolumeId = 'voice-input-volume';
	const outputVolumeId = 'voice-output-volume';
	const thresholdId = 'voice-input-threshold';

        const unsubscribe = appSettings.subscribe(($settings) => {
                const next = normalizeDeviceSettings(cloneDeviceSettings($settings.devices));
                currentSettings = next;
                if (!dirty) {
                        form = { ...next };
                }
        });

	$: dirty = !deviceSettingsEqual(form, currentSettings);

	function computeMicPreviewSignature(settings: DeviceSettings): string {
		return `${settings.audioInputDevice ?? SYSTEM_DEVICE_ID}|${settings.autoGainControl ? 1 : 0}|${
			settings.echoCancellation ? 1 : 0
		}|${settings.noiseSuppression ? 1 : 0}`;
	}

	$: if (micPreviewActive) {
		const signature = computeMicPreviewSignature(form);
		if (signature !== micPreviewSignature && !micPreviewLoading) {
			micPreviewSignature = signature;
			void restartMicPreview();
		}
	}

	function computeCameraPreviewSignature(settings: DeviceSettings): string {
		return settings.videoDevice ?? SYSTEM_DEVICE_ID;
	}

	$: if (cameraPreviewActive) {
		const signature = computeCameraPreviewSignature(form);
		if (signature !== cameraPreviewSignature && !cameraPreviewLoading) {
			cameraPreviewSignature = signature;
			void restartCameraPreview();
		}
	}

	let previousDeviceChangeHandler: ((this: MediaDevices, ev: Event) => unknown) | null = null;

	const handleDeviceChange = () => {
		void refreshDeviceList();
	};

	onMount(() => {
		if (browser) {
			void refreshDeviceList();
			navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
			if ('ondevicechange' in (navigator.mediaDevices ?? {})) {
				previousDeviceChangeHandler = navigator.mediaDevices.ondevicechange ?? null;
				navigator.mediaDevices.ondevicechange = handleDeviceChange;
			}
		}

		return () => {
			if (browser) {
				navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
				if ('ondevicechange' in (navigator.mediaDevices ?? {})) {
					navigator.mediaDevices.ondevicechange = previousDeviceChangeHandler;
				}
			}
		};
	});

	onDestroy(() => {
		unsubscribe();
		stopMicPreview();
		void stopCameraPreview();
	});

        function clamp(value: number, min: number, max: number): number {
                return Math.max(min, Math.min(max, value));
        }

        function clampThreshold(value: number): number {
                if (!Number.isFinite(value)) return THRESHOLD_NORMALIZED_MIN;
                return clamp(value, THRESHOLD_NORMALIZED_MIN, THRESHOLD_MAX);
        }

        function clampDecibelsToUiRange(value: number): number {
                if (!Number.isFinite(value)) return THRESHOLD_UI_DB_MIN;
                return clamp(value, THRESHOLD_UI_DB_MIN, THRESHOLD_UI_DB_MAX);
        }

        function normalizedToSliderPercent(value: number): number {
                if (!Number.isFinite(value) || value <= 0) return 0;
                if (THRESHOLD_UI_DB_RANGE <= 0) return 0;
                const db = clampDecibelsToUiRange(normalizedToDecibels(value));
                return clamp(((db - THRESHOLD_UI_DB_MIN) / THRESHOLD_UI_DB_RANGE) * 100, 0, 100);
        }

        function sliderPercentToNormalized(percent: number): number {
                if (THRESHOLD_UI_DB_RANGE <= 0) return THRESHOLD_NORMALIZED_MIN;
                const clampedPercent = clamp(percent, 0, 100);
                const db = THRESHOLD_UI_DB_MIN + (clampedPercent / 100) * THRESHOLD_UI_DB_RANGE;
                return clampThreshold(decibelsToNormalized(db));
        }

        function getNow(): number {
                if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
                        return performance.now();
                }
                return Date.now();
        }

        function formatDecibels(value: number): string {
                return `${Math.round(clampDecibelsToUiRange(value))} dB`;
        }

        function deviceSettingsEqual(a: DeviceSettings, b: DeviceSettings): boolean {
                return (
                        (a.audioInputDevice ?? null) === (b.audioInputDevice ?? null) &&
                        Math.abs(a.audioInputLevel - b.audioInputLevel) < 1e-3 &&
                        Math.abs(a.audioInputThreshold - b.audioInputThreshold) < 1e-3 &&
			(a.audioOutputDevice ?? null) === (b.audioOutputDevice ?? null) &&
			Math.abs(a.audioOutputLevel - b.audioOutputLevel) < 1e-3 &&
			a.autoGainControl === b.autoGainControl &&
			a.echoCancellation === b.echoCancellation &&
			a.noiseSuppression === b.noiseSuppression &&
			(a.videoDevice ?? null) === (b.videoDevice ?? null)
		);
        }

        function normalizeDeviceSettings(settings: DeviceSettings): DeviceSettings {
                return {
                        ...settings,
                        audioInputThreshold: clampThreshold(settings.audioInputThreshold)
                };
        }

        function sanitizeForm(): DeviceSettings {
                return normalizeDeviceSettings(
                        cloneDeviceSettings({
                                audioInputDevice: form.audioInputDevice,
                                audioInputLevel: clamp(form.audioInputLevel, 0, INPUT_VOLUME_MAX),
                                audioInputThreshold: clampThreshold(form.audioInputThreshold),
                                audioOutputDevice: form.audioOutputDevice,
                                audioOutputLevel: clamp(form.audioOutputLevel, 0, OUTPUT_VOLUME_MAX),
                                autoGainControl: form.autoGainControl,
                                echoCancellation: form.echoCancellation,
                                noiseSuppression: form.noiseSuppression,
                                videoDevice: form.videoDevice
                        })
                );
        }

        function updateForm(patch: Partial<DeviceSettings>) {
                const nextPatch: Partial<DeviceSettings> = { ...patch };
                if (nextPatch.audioInputThreshold != null) {
                        nextPatch.audioInputThreshold = clampThreshold(nextPatch.audioInputThreshold);
                }
                form = { ...form, ...nextPatch };
                message = null;
        }

	function resolveSelectValue(value: string): string | null {
		return value === SYSTEM_DEVICE_ID ? null : value;
	}

	async function refreshDeviceList() {
		if (!browser || !navigator.mediaDevices?.enumerateDevices) {
			micPreviewSupported = false;
			cameraPreviewSupported = false;
			devicesError = m.settings_voice_preview_not_supported();
			return;
		}
		devicesLoading = true;
		devicesError = null;
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			const supportsPreview = typeof navigator.mediaDevices?.getUserMedia === 'function';
			micPreviewSupported = supportsPreview;
			cameraPreviewSupported = supportsPreview;
			audioInputDevices = devices.filter((device) => device.kind === 'audioinput');
			audioOutputDevices = devices.filter((device) => device.kind === 'audiooutput');
			videoDevices = devices.filter((device) => device.kind === 'videoinput');
			showPermissionReminder = devices.some((device) => !device.label);
		} catch (error) {
			console.error('Failed to enumerate devices', error);
			devicesError = m.settings_device_refresh_error();
		} finally {
			devicesLoading = false;
		}
	}

	async function handleSave() {
		const next = sanitizeForm();
		if (deviceSettingsEqual(next, currentSettings)) {
			message = { text: m.settings_device_no_changes(), variant: 'info' };
			return;
		}

		saving = true;
		message = null;
		try {
			const snapshot = get(appSettings);
			const payload = convertAppSettingsToApi({ ...snapshot, devices: next });
			await auth.api.user.userMeSettingsPost({
				modelUserSettingsData: payload
			});
			mutateAppSettingsWithoutSaving((settings) => {
				if (deviceSettingsEqual(settings.devices, next)) return false;
				settings.devices = cloneDeviceSettings(next);
				return true;
			});
			message = { text: m.settings_device_saved(), variant: 'success' };
		} catch (error) {
			console.error('Failed to save voice & video settings', error);
			message = { text: m.settings_device_save_error(), variant: 'error' };
		} finally {
			saving = false;
		}
	}

        function handleReset() {
                form = { ...normalizeDeviceSettings(currentSettings) };
                message = null;
        }

	async function startMicPreview() {
		if (!micPreviewSupported || !browser) {
			micPreviewError = m.settings_voice_preview_not_supported();
			return;
		}
		if (micPreviewLoading) return;

		micPreviewLoading = true;
		micPreviewError = null;
		try {
			await stopMicPreview();
			const constraints: MediaStreamConstraints = {
				audio: {
					deviceId: form.audioInputDevice ? { exact: form.audioInputDevice } : undefined,
					autoGainControl: form.autoGainControl,
					echoCancellation: form.echoCancellation,
					noiseSuppression: form.noiseSuppression
				}
			};
			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			micPreviewStream = stream;
			const AudioContextCtor =
				window.AudioContext ?? (window as any).webkitAudioContext ?? AudioContext;
			micPreviewContext = new AudioContextCtor();
			const source = micPreviewContext.createMediaStreamSource(stream);
			const inputGain = micPreviewContext.createGain();
                        const analyser = micPreviewContext.createAnalyser();
                        const outputGain = micPreviewContext.createGain();
                        const gateGain = micPreviewContext.createGain();
                        const destination = micPreviewContext.createMediaStreamDestination();
			source.connect(inputGain);
			inputGain.connect(analyser);
                        analyser.connect(outputGain);
                        outputGain.connect(gateGain);
                        gateGain.connect(destination);
			micPreviewSource = source;
			micPreviewInputGain = inputGain;
                        micPreviewAnalyser = analyser;
                        micPreviewOutputGain = outputGain;
                        micPreviewGateGain = gateGain;
                        micPreviewDestination = destination;
                        micPreviewAnalyser.fftSize = 2048;
                        micPreviewAnalyser.smoothingTimeConstant = 0.6;
                        micPreviewBuffer = new Uint8Array(new ArrayBuffer(micPreviewAnalyser.fftSize));
                        micPreviewGateOpen = false;
                        micPreviewLastGateOpenAt = 0;
                        micPreviewSpeaking = false;
                        updateMicPreviewInputGain();
                        updateMicPreviewOutputGain();
                        applyMicPreviewGateGain(false);
			if (micPreviewAudioElement) {
				micPreviewAudioElement.srcObject = destination.stream;
				ensureMicPreviewPlayback();
				await applyMicPreviewSink(form.audioOutputDevice ?? null);
			}
			micPreviewContext.resume().catch(() => {});
			micPreviewActive = true;
			micPreviewSignature = computeMicPreviewSignature(form);
			animateMicPreview();
			showPermissionReminder = false;
			void refreshDeviceList();
		} catch (error) {
			console.error('Failed to start microphone preview', error);
			micPreviewError = m.settings_voice_preview_error();
			await stopMicPreview();
		} finally {
			micPreviewLoading = false;
		}
	}

	async function restartMicPreview() {
		if (!micPreviewActive || micPreviewLoading) return;
		await startMicPreview();
	}

	async function stopMicPreview() {
		if (micPreviewRaf != null) {
			cancelAnimationFrame(micPreviewRaf);
			micPreviewRaf = null;
		}
		if (micPreviewSource) {
			try {
				micPreviewSource.disconnect();
			} catch {}
			micPreviewSource = null;
		}
		if (micPreviewInputGain) {
			try {
				micPreviewInputGain.disconnect();
			} catch {}
			micPreviewInputGain = null;
		}
		if (micPreviewAnalyser) {
			try {
				micPreviewAnalyser.disconnect();
			} catch {}
			micPreviewAnalyser = null;
		}
                if (micPreviewOutputGain) {
                        try {
                                micPreviewOutputGain.disconnect();
                        } catch {}
                        micPreviewOutputGain = null;
                }
                if (micPreviewGateGain) {
                        try {
                                micPreviewGateGain.disconnect();
                        } catch {}
                        micPreviewGateGain = null;
                }
		if (micPreviewDestination) {
			try {
				micPreviewDestination.disconnect?.();
			} catch {}
			micPreviewDestination = null;
		}
		if (micPreviewContext) {
			try {
				await micPreviewContext.close();
			} catch {}
		}
		if (micPreviewStream) {
			for (const track of micPreviewStream.getTracks()) {
				track.stop();
			}
		}
		if (micPreviewAudioElement) {
			try {
				micPreviewAudioElement.pause();
			} catch {}
			micPreviewAudioElement.srcObject = null;
			micPreviewAudioElement.muted = true;
		}
                micPreviewStream = null;
                micPreviewContext = null;
                micPreviewBuffer = null;
                micPreviewActive = false;
                micPreviewSignature = '';
                micPreviewLevel = 0;
                micPreviewSpeaking = false;
                micPreviewGateOpen = false;
                micPreviewLastGateOpenAt = 0;
                applyMicPreviewGateGain(false);
                micPreviewAppliedSink = null;
                micPreviewSinkErrorLogged = false;
        }

        function animateMicPreview() {
                if (!micPreviewAnalyser || !micPreviewBuffer) return;
                micPreviewAnalyser.getByteTimeDomainData(micPreviewBuffer);
                const measurement = analyzeTimeDomainLevel(micPreviewBuffer, {
                        gain: clamp(form.audioInputLevel, 0, INPUT_VOLUME_MAX),
                        previous: micPreviewLevel,
                        smoothing: 0.35
                });
                micPreviewLevel = clamp(measurement.normalized, 0, THRESHOLD_MAX);
                evaluateMicPreviewGate(micPreviewLevel);
                micPreviewRaf = requestAnimationFrame(animateMicPreview);
        }

        function updateMicPreviewInputGain(level: number = form.audioInputLevel) {
                if (!micPreviewInputGain) return;
                micPreviewInputGain.gain.value = clamp(level, 0, INPUT_VOLUME_MAX);
        }

	function ensureMicPreviewPlayback() {
		if (!micPreviewAudioElement) return;
		try {
			micPreviewAudioElement.muted = false;
			micPreviewAudioElement.volume = 1;
		} catch {}
		const playPromise = micPreviewAudioElement.play();
		if (playPromise && typeof playPromise.catch === 'function') {
			playPromise.catch(() => {});
		}
	}

        function updateMicPreviewOutputGain(level: number = form.audioOutputLevel) {
                if (!micPreviewOutputGain) return;
                const clampedLevel = clamp(level, 0, OUTPUT_VOLUME_MAX);
                micPreviewOutputGain.gain.value = clampedLevel;
                if (micPreviewAudioElement) {
                        micPreviewAudioElement.muted = clampedLevel <= 0;
                        if (clampedLevel > 0) {
                                ensureMicPreviewPlayback();
                        }
                }
        }

        function applyMicPreviewGateGain(active: boolean) {
                if (!micPreviewGateGain || !micPreviewContext) return;
                const target = active ? 1 : 0;
                try {
                        micPreviewGateGain.gain.setTargetAtTime(target, micPreviewContext.currentTime, 0.05);
                } catch {
                        micPreviewGateGain.gain.value = target;
                }
        }

        function setMicPreviewGateState(open: boolean) {
                if (micPreviewGateOpen === open) return;
                micPreviewGateOpen = open;
                micPreviewSpeaking = open;
                applyMicPreviewGateGain(open);
        }

        function evaluateMicPreviewGate(level: number) {
                const threshold = clampThreshold(form.audioInputThreshold);
                const now = getNow();
                const openThreshold = threshold;
                const closeThreshold = clampThreshold(openThreshold * MIC_PREVIEW_GATE_CLOSE_RATIO);

                if (level >= openThreshold) {
                        micPreviewLastGateOpenAt = now;
                        setMicPreviewGateState(true);
                        return;
                }

                if (!micPreviewGateOpen) {
                        setMicPreviewGateState(false);
                        return;
                }

                const holdExpired = now - micPreviewLastGateOpenAt > MIC_PREVIEW_GATE_HOLD_MS;
                if (holdExpired && level <= closeThreshold) {
                        setMicPreviewGateState(false);
                }
        }

        function setThresholdFromPercent(percent: number) {
                updateForm({ audioInputThreshold: sliderPercentToNormalized(percent) });
        }

        function updateThresholdFromPointer(clientX: number) {
                if (!thresholdSliderElement) return;
                const rect = thresholdSliderElement.getBoundingClientRect();
                if (!rect || rect.width <= 0) return;
                const percent = ((clientX - rect.left) / rect.width) * 100;
                setThresholdFromPercent(percent);
        }

        function handleThresholdPointerDown(event: PointerEvent) {
                thresholdDragging = true;
                event.preventDefault();
                (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
                updateThresholdFromPointer(event.clientX);
        }

        function handleThresholdPointerMove(event: PointerEvent) {
                if (!thresholdDragging) return;
                event.preventDefault();
                updateThresholdFromPointer(event.clientX);
        }

        function handleThresholdPointerUp(event: PointerEvent) {
                if (thresholdDragging) {
                        thresholdDragging = false;
                }
                try {
                        (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
                } catch {}
        }

	async function applyMicPreviewSink(deviceId: string | null) {
		if (!micPreviewAudioElement || !sinkIdSupported) return;
		const target = deviceId && deviceId.length ? deviceId : 'default';
		if (micPreviewAppliedSink === target) return;
		try {
			await micPreviewAudioElement.setSinkId(target);
			micPreviewAppliedSink = target;
			micPreviewSinkErrorLogged = false;
		} catch (error) {
			if (!micPreviewSinkErrorLogged) {
				console.error('Failed to set microphone preview output device.', error);
				micPreviewSinkErrorLogged = true;
			}
		}
	}

        $: micPreviewThresholdPercent = normalizedToSliderPercent(form.audioInputThreshold);
        $: micPreviewLevelPercent = normalizedToSliderPercent(micPreviewLevel);
        $: micPreviewDisplayPercent =
                micPreviewGateOpen && micPreviewLevelPercent < micPreviewThresholdPercent
                        ? micPreviewThresholdPercent
                        : micPreviewLevelPercent;

        $: if (micPreviewActive && browser) {
                evaluateMicPreviewGate(micPreviewLevel);
        }

        $: if (micPreviewActive) {
                updateMicPreviewInputGain(form.audioInputLevel);
        }

        $: if (micPreviewActive) {
                updateMicPreviewOutputGain(form.audioOutputLevel);
        }

        $: if (micPreviewActive) {
                const sink = form.audioOutputDevice ?? null;
                void applyMicPreviewSink(sink);
        }

	async function startCameraPreview() {
		if (!cameraPreviewSupported || !browser) {
			cameraPreviewError = m.settings_video_preview_not_supported();
			return;
		}
		if (cameraPreviewLoading) return;

		cameraPreviewLoading = true;
		cameraPreviewError = null;
		try {
			await stopCameraPreview();
			const constraints: MediaStreamConstraints = {
				video: form.videoDevice ? { deviceId: { exact: form.videoDevice } } : true,
				audio: false
			};
			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			cameraPreviewStream = stream;
			cameraPreviewActive = true;
			cameraPreviewSignature = computeCameraPreviewSignature(form);
			showPermissionReminder = false;
			void refreshDeviceList();
		} catch (error) {
			console.error('Failed to start camera preview', error);
			cameraPreviewError = m.settings_video_preview_error();
			await stopCameraPreview();
		} finally {
			cameraPreviewLoading = false;
		}
	}

	async function restartCameraPreview() {
		if (!cameraPreviewActive || cameraPreviewLoading) return;
		await startCameraPreview();
	}

	async function stopCameraPreview() {
		if (cameraPreviewStream) {
			for (const track of cameraPreviewStream.getTracks()) {
				track.stop();
			}
		}
		if (cameraPreviewElement) {
			try {
				cameraPreviewElement.pause();
			} catch {}
			cameraPreviewElement.srcObject = null;
		}
		cameraPreviewStream = null;
		cameraPreviewActive = false;
		cameraPreviewSignature = '';
	}

	$: if (cameraPreviewActive && cameraPreviewElement && cameraPreviewStream) {
		if (cameraPreviewElement.srcObject !== cameraPreviewStream) {
			cameraPreviewElement.srcObject = cameraPreviewStream;
			const playPromise = cameraPreviewElement.play();
			if (playPromise && typeof playPromise.catch === 'function') {
				playPromise.catch(() => {});
			}
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-lg font-semibold">{m.voice_video()}</h2>
		<p class="mt-1 text-sm text-[var(--muted)]">{m.settings_voice_video_description()}</p>
	</div>

	{#if message}
		<div
			class={`rounded border px-4 py-2 text-sm ${
				message.variant === 'success'
					? 'border-[var(--success)] text-[var(--success)]'
					: message.variant === 'error'
						? 'border-[var(--danger)] text-[var(--danger)]'
						: 'border-[var(--stroke)] text-[var(--muted)]'
			}`}
		>
			{message.text}
		</div>
	{/if}

	<div class="grid gap-4 md:grid-cols-2">
		<label class="flex flex-col gap-2">
			<span class="text-sm font-medium">{m.settings_input_device()}</span>
			<select
				class="rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 text-sm"
				value={form.audioInputDevice ?? SYSTEM_DEVICE_ID}
				onchange={(event) =>
					updateForm({
						audioInputDevice: resolveSelectValue((event.currentTarget as HTMLSelectElement).value)
					})}
			>
				<option value={SYSTEM_DEVICE_ID}>{m.settings_default_device()}</option>
				{#each audioInputDevices as device (device.deviceId)}
					<option value={device.deviceId}>
						{device.label || m.settings_unknown_device()}
					</option>
				{/each}
			</select>
			{#if !audioInputDevices.length}
				<p class="text-xs text-[var(--muted)]">{m.settings_no_devices_found()}</p>
			{/if}
		</label>

		<label class="flex flex-col gap-2">
			<span class="text-sm font-medium">{m.settings_output_device()}</span>
			<select
				class="rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 text-sm"
				value={form.audioOutputDevice ?? SYSTEM_DEVICE_ID}
				onchange={(event) =>
					updateForm({
						audioOutputDevice: resolveSelectValue((event.currentTarget as HTMLSelectElement).value)
					})}
			>
				<option value={SYSTEM_DEVICE_ID}>{m.settings_default_device()}</option>
				{#each audioOutputDevices as device (device.deviceId)}
					<option value={device.deviceId}>
						{device.label || m.settings_unknown_device()}
					</option>
				{/each}
			</select>
			{#if !audioOutputDevices.length}
				<p class="text-xs text-[var(--muted)]">{m.settings_no_devices_found()}</p>
			{/if}
		</label>

		<label class="flex flex-col gap-2 md:col-span-2">
			<span class="text-sm font-medium">{m.settings_video_device()}</span>
			<select
				class="rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 text-sm"
				value={form.videoDevice ?? SYSTEM_DEVICE_ID}
				onchange={(event) =>
					updateForm({
						videoDevice: resolveSelectValue((event.currentTarget as HTMLSelectElement).value)
					})}
			>
				<option value={SYSTEM_DEVICE_ID}>{m.settings_default_device()}</option>
				{#each videoDevices as device (device.deviceId)}
					<option value={device.deviceId}>
						{device.label || m.settings_unknown_device()}
					</option>
				{/each}
			</select>
			{#if !videoDevices.length}
				<p class="text-xs text-[var(--muted)]">{m.settings_no_devices_found()}</p>
			{/if}
		</label>
	</div>

	{#if devicesError}
		<p class="text-sm text-[var(--danger)]">{devicesError}</p>
	{/if}

	{#if showPermissionReminder}
		<p class="text-sm text-[var(--warning)]">{m.settings_voice_preview_permission()}</p>
	{/if}

	<div class="space-y-4">
		<div class="flex items-center gap-4">
			<div class="flex-1">
				<label class="flex justify-between text-sm font-medium" for={inputVolumeId}>
					<span>{m.settings_input_volume()}</span>
					<span>{Math.round(clamp(form.audioInputLevel, 0, INPUT_VOLUME_MAX) * 100)}%</span>
				</label>
				<input
					id={inputVolumeId}
					type="range"
					min="0"
					max={INPUT_VOLUME_PERCENT_MAX}
					step="1"
					value={Math.round(
						clamp(form.audioInputLevel, 0, INPUT_VOLUME_MAX) * INPUT_VOLUME_PERCENT_MAX
					)}
					oninput={(event) =>
						updateForm({
							audioInputLevel: clamp(
								(Number((event.currentTarget as HTMLInputElement).value) || 0) /
									INPUT_VOLUME_PERCENT_MAX,
								0,
								INPUT_VOLUME_MAX
							)
						})}
					class="mt-2 w-full"
				/>
			</div>
			<div class="flex-1">
				<label class="flex justify-between text-sm font-medium" for={outputVolumeId}>
					<span>{m.settings_output_volume()}</span>
					<span>{Math.round(clamp(form.audioOutputLevel, 0, OUTPUT_VOLUME_MAX) * 100)}%</span>
				</label>
				<input
					id={outputVolumeId}
					type="range"
					min="0"
					max={OUTPUT_VOLUME_PERCENT_MAX}
					step="1"
					value={Math.round(clamp(form.audioOutputLevel, 0, OUTPUT_VOLUME_MAX) * 100)}
					oninput={(event) =>
						updateForm({
							audioOutputLevel: clamp(
								(Number((event.currentTarget as HTMLInputElement).value) || 0) / 100,
								0,
								OUTPUT_VOLUME_MAX
							)
						})}
					class="mt-2 w-full"
				/>
			</div>
		</div>

                <label
                        class="block rounded border border-[var(--stroke)] bg-[var(--panel)] p-4"
                        for={thresholdId}
                >
                        <div class="flex flex-wrap items-end justify-between gap-2">
                                <span class="text-sm font-medium">{m.settings_input_threshold()}</span>
                                <span class="text-xs font-medium text-[var(--muted)]">
                                        {formatDecibels(normalizedToDecibels(form.audioInputThreshold))}
                                </span>
                        </div>
                        <div
                                bind:this={thresholdSliderElement}
                                class="relative mt-4 h-8 w-full cursor-crosshair select-none overflow-hidden rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)]"
                                role="presentation"
                                onpointerdown={handleThresholdPointerDown}
                                onpointermove={handleThresholdPointerMove}
                                onpointerup={handleThresholdPointerUp}
                                onpointercancel={handleThresholdPointerUp}
                        >
                                <div
                                        aria-hidden="true"
                                        class="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--success)] to-[var(--warning)] transition-[width] duration-75 ease-linear"
                                        style={`width: ${micPreviewDisplayPercent.toFixed(2)}%`}
                                ></div>
                                <div
                                        class={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-[left] duration-75 ease-linear ${
                                                thresholdDragging ? 'cursor-grabbing' : 'cursor-grab'
                                        }`}
                                        style={`left: ${micPreviewThresholdPercent.toFixed(2)}%`}
                                >
                                        <div class="relative h-8 w-px bg-white">
                                                <div class="absolute left-1/2 top-1/2 h-7 w-3 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white shadow-[0_8px_16px_rgba(0,0,0,0.45)]"></div>
                                        </div>
                                </div>
                        </div>
                        <input
                                id={thresholdId}
                                type="range"
                                min={THRESHOLD_UI_DB_MIN}
                                max={THRESHOLD_UI_DB_MAX}
                                step="1"
                                class="sr-only"
                                value={Math.round(clampDecibelsToUiRange(normalizedToDecibels(form.audioInputThreshold)))}
                                oninput={(event) => {
                                        const value = Number((event.currentTarget as HTMLInputElement).value);
                                        const clamped = Number.isFinite(value) ? clampDecibelsToUiRange(value) : THRESHOLD_UI_DB_MIN;
                                        const percent =
                                                THRESHOLD_UI_DB_RANGE > 0
                                                        ? ((clamped - THRESHOLD_UI_DB_MIN) / THRESHOLD_UI_DB_RANGE) * 100
                                                        : 0;
                                        setThresholdFromPercent(percent);
                                }}
                        />
                        <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                                <div
                                        class={`flex items-center gap-2 rounded-full border px-2 py-1 transition-colors ${
                                                micPreviewActive && micPreviewGateOpen
                                                        ? 'border-[var(--success)] text-[var(--success)] shadow-[0_0_8px_rgba(59,165,93,0.25)]'
                                                        : 'border-[var(--stroke)]'
                                        }`}
                                >
                                        <span
                                                class={`h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.6)] ${
                                                        micPreviewActive && micPreviewGateOpen
                                                                ? 'bg-[var(--success)] shadow-[0_0_8px_rgba(59,165,93,0.6)]'
                                                                : 'bg-[var(--stroke-strong)]'
                                                }`}
                                        ></span>
                                        <span>
                                                {micPreviewActive
                                                        ? micPreviewGateOpen
                                                                ? m.settings_voice_preview_detected()
                                                                : m.settings_voice_preview_listening()
                                                        : m.settings_voice_preview_help()}
                                        </span>
                                </div>
                                <p>{m.settings_voice_preview_description()}</p>
                        </div>
                </label>

		<div class="grid gap-4 md:grid-cols-3">
			<label class="flex items-center gap-3 text-sm">
				<input
					type="checkbox"
					checked={form.autoGainControl}
					onchange={(event) =>
						updateForm({ autoGainControl: (event.currentTarget as HTMLInputElement).checked })}
				/>
				<span>{m.settings_auto_gain_control()}</span>
			</label>
			<label class="flex items-center gap-3 text-sm">
				<input
					type="checkbox"
					checked={form.echoCancellation}
					onchange={(event) =>
						updateForm({ echoCancellation: (event.currentTarget as HTMLInputElement).checked })}
				/>
				<span>{m.settings_echo_cancellation()}</span>
			</label>
			<label class="flex items-center gap-3 text-sm">
				<input
					type="checkbox"
					checked={form.noiseSuppression}
					onchange={(event) =>
						updateForm({
							noiseSuppression: (event.currentTarget as HTMLInputElement).checked
						})}
				/>
				<span>{m.settings_noise_suppression()}</span>
			</label>
		</div>
	</div>

	<div class="rounded border border-[var(--stroke)] bg-[var(--panel)] p-4">
		<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div>
				<h3 class="text-sm font-semibold">{m.settings_voice_preview()}</h3>
				<p class="text-xs text-[var(--muted)]">
					{micPreviewActive
						? micPreviewSpeaking
							? m.settings_voice_preview_detected()
							: m.settings_voice_preview_listening()
						: m.settings_voice_preview_help()}
				</p>
			</div>
			<div class="flex gap-2">
				<button
					class="rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm"
					onclick={() => void refreshDeviceList()}
					disabled={devicesLoading}
				>
					{devicesLoading ? m.loading() : m.settings_device_refresh()}
				</button>
				<button
					class="rounded bg-[var(--brand)] px-3 py-2 text-sm font-medium text-[var(--brand-contrast)] disabled:opacity-50"
					onclick={() => (micPreviewActive ? stopMicPreview() : startMicPreview())}
					disabled={micPreviewLoading}
				>
					{micPreviewActive ? m.settings_voice_preview_stop() : m.settings_voice_preview_start()}
				</button>
			</div>
		</div>
		{#if micPreviewError}
			<p class="mt-3 text-sm text-[var(--danger)]">{micPreviewError}</p>
		{/if}
		<audio bind:this={micPreviewAudioElement} class="hidden" autoplay playsinline></audio>
	</div>

	<div class="rounded border border-[var(--stroke)] bg-[var(--panel)] p-4">
		<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div>
				<h3 class="text-sm font-semibold">{m.settings_video_preview()}</h3>
				<p class="text-xs text-[var(--muted)]">
					{cameraPreviewSupported
						? cameraPreviewActive
							? m.settings_video_preview_live()
							: m.settings_video_preview_help()
						: m.settings_video_preview_not_supported()}
				</p>
			</div>
			<div class="flex gap-2">
				<button
					class="rounded bg-[var(--brand)] px-3 py-2 text-sm font-medium text-[var(--brand-contrast)] disabled:opacity-50"
					onclick={() => (cameraPreviewActive ? stopCameraPreview() : startCameraPreview())}
					disabled={cameraPreviewLoading || !cameraPreviewSupported}
				>
					{cameraPreviewActive ? m.settings_video_preview_stop() : m.settings_video_preview_start()}
				</button>
			</div>
		</div>
		<div class="mt-3">
                        <video
                                bind:this={cameraPreviewElement}
                                class={`h-48 w-full rounded bg-black object-contain object-center ${cameraPreviewActive ? '' : 'hidden'}`}
				autoplay
				muted
				playsinline
			></video>
			{#if !cameraPreviewActive}
				<div
					class="flex h-48 items-center justify-center rounded border border-dashed border-[var(--stroke)] bg-[var(--panel-strong)] text-sm text-[var(--muted)]"
				>
					{m.settings_video_preview_placeholder()}
				</div>
			{/if}
		</div>
		{#if cameraPreviewError}
			<p class="mt-3 text-sm text-[var(--danger)]">{cameraPreviewError}</p>
		{/if}
	</div>

	<div class="flex flex-col gap-3 border-t border-[var(--stroke)] pt-4 md:flex-row md:justify-end">
		<button
			class="rounded border border-[var(--stroke)] bg-[var(--panel)] px-4 py-2 text-sm"
			onclick={handleReset}
			disabled={!dirty || saving}
		>
			{m.settings_reset()}
		</button>
		<button
			class="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] disabled:opacity-50"
			onclick={() => void handleSave()}
			disabled={saving}
		>
			{saving ? m.loading() : m.settings_device_save()}
		</button>
	</div>
</div>

<style>
	input[type='range'] {
		accent-color: var(--brand);
	}
</style>
