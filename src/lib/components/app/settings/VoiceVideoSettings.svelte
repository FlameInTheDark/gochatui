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

	const SYSTEM_DEVICE_ID = '__system__';
	const INPUT_VOLUME_MAX = 1;
	const OUTPUT_VOLUME_MAX = 1.5;
	const THRESHOLD_MAX = 1;
	const INPUT_VOLUME_PERCENT_MAX = 100;
	const OUTPUT_VOLUME_PERCENT_MAX = 150;

	type MessageVariant = 'success' | 'error' | 'info';

	interface FeedbackMessage {
		text: string;
		variant: MessageVariant;
	}

	let form: DeviceSettings = cloneDeviceSettings(null);
	let currentSettings: DeviceSettings = cloneDeviceSettings(null);
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
	let micPreviewSignature = '';
	let micPreviewRaf: number | null = null;
	let micPreviewStream: MediaStream | null = null;
	let micPreviewContext: AudioContext | null = null;
	let micPreviewAnalyser: AnalyserNode | null = null;
	let micPreviewBuffer: Uint8Array | null = null;
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
		const next = cloneDeviceSettings($settings.devices);
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

	function sanitizeForm(): DeviceSettings {
		return cloneDeviceSettings({
			audioInputDevice: form.audioInputDevice,
			audioInputLevel: clamp(form.audioInputLevel, 0, INPUT_VOLUME_MAX),
			audioInputThreshold: clamp(form.audioInputThreshold, 0, THRESHOLD_MAX),
			audioOutputDevice: form.audioOutputDevice,
			audioOutputLevel: clamp(form.audioOutputLevel, 0, OUTPUT_VOLUME_MAX),
			autoGainControl: form.autoGainControl,
			echoCancellation: form.echoCancellation,
			noiseSuppression: form.noiseSuppression,
			videoDevice: form.videoDevice
		});
	}

	function updateForm(patch: Partial<DeviceSettings>) {
		form = { ...form, ...patch };
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
		form = { ...cloneDeviceSettings(currentSettings) };
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
			micPreviewContext = new AudioContext();
			const source = micPreviewContext.createMediaStreamSource(stream);
			micPreviewAnalyser = micPreviewContext.createAnalyser();
			micPreviewAnalyser.fftSize = 2048;
			micPreviewBuffer = new Uint8Array(new ArrayBuffer(micPreviewAnalyser.fftSize));
			source.connect(micPreviewAnalyser);
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
		if (micPreviewAnalyser) {
			try {
				micPreviewAnalyser.disconnect();
			} catch {}
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
		micPreviewStream = null;
		micPreviewContext = null;
		micPreviewAnalyser = null;
		micPreviewBuffer = null;
		micPreviewActive = false;
		micPreviewSignature = '';
		micPreviewLevel = 0;
		micPreviewSpeaking = false;
	}

	function animateMicPreview() {
		if (!micPreviewAnalyser || !micPreviewBuffer) return;
		micPreviewAnalyser.getByteTimeDomainData(
			micPreviewBuffer as unknown as Uint8Array<ArrayBuffer>
		);
		let sumSquares = 0;
		for (let i = 0; i < micPreviewBuffer.length; i += 1) {
			const value = micPreviewBuffer[i] / 128 - 1;
			sumSquares += value * value;
		}
		const rms = Math.sqrt(sumSquares / micPreviewBuffer.length);
		const level = clamp(rms * 2 * form.audioInputLevel, 0, 1);
		micPreviewLevel = level;
		micPreviewSpeaking = level >= form.audioInputThreshold;
		micPreviewRaf = requestAnimationFrame(animateMicPreview);
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

		<div>
			<label class="flex justify-between text-sm font-medium" for={thresholdId}>
				<span>{m.settings_input_threshold()}</span>
				<span>{form.audioInputThreshold.toFixed(2)}</span>
			</label>
			<input
				id={thresholdId}
				type="range"
				min="0"
				max={THRESHOLD_MAX}
				step="0.01"
				value={form.audioInputThreshold}
				oninput={(event) =>
					updateForm({
						audioInputThreshold: clamp(
							Number((event.currentTarget as HTMLInputElement).value) || 0,
							0,
							THRESHOLD_MAX
						)
					})}
				class="mt-2 w-full"
			/>
			<div class="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-[var(--panel-strong)]">
				<div
					class={`absolute inset-y-0 left-0 rounded-full transition-[width] ${
						micPreviewSpeaking ? 'bg-[var(--success)]' : 'bg-[var(--brand)]/60'
					}`}
					style={`width: ${(micPreviewLevel * 100).toFixed(2)}%`}
				></div>
				<div
					class="absolute inset-y-0 w-0.5 bg-[var(--stroke-strong)]"
					style={`left: ${(form.audioInputThreshold * 100).toFixed(2)}%`}
				></div>
			</div>
			<p class="mt-2 text-xs text-[var(--muted)]">{m.settings_voice_preview_description()}</p>
		</div>

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
				class={`h-48 w-full rounded bg-black object-cover ${cameraPreviewActive ? '' : 'hidden'}`}
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
