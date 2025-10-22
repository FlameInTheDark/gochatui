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
	const INPUT_VOLUME_MAX = 1.5;
	const THRESHOLD_MAX = 1;

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

	let previewSupported = browser && typeof navigator.mediaDevices?.getUserMedia === 'function';
	let previewLoading = false;
	let previewError: string | null = null;
	let previewActive = false;
	let previewLevel = 0;
	let previewSpeaking = false;
        let previewSignature = '';
	let previewRaf: number | null = null;
	let previewStream: MediaStream | null = null;
	let previewContext: AudioContext | null = null;
	let previewAnalyser: AnalyserNode | null = null;
	let previewBuffer: Uint8Array | null = null;
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

        function computePreviewSignature(settings: DeviceSettings): string {
                return `${settings.audioInputDevice ?? SYSTEM_DEVICE_ID}|${settings.autoGainControl ? 1 : 0}|${
                        settings.echoCancellation ? 1 : 0
                }|${settings.noiseSuppression ? 1 : 0}`;
        }

        $: if (previewActive) {
                const signature = computePreviewSignature(form);
                if (signature !== previewSignature && !previewLoading) {
                        previewSignature = signature;
                        void restartPreview();
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
		stopPreview();
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
			audioOutputLevel: clamp(form.audioOutputLevel, 0, INPUT_VOLUME_MAX),
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
			previewSupported = false;
			devicesError = m.settings_voice_preview_not_supported();
			return;
		}
		devicesLoading = true;
		devicesError = null;
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
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

	async function startPreview() {
		if (!previewSupported || !browser) {
			previewError = m.settings_voice_preview_not_supported();
			return;
		}
		if (previewLoading) return;

		previewLoading = true;
		previewError = null;
		try {
			await stopPreview();
			const constraints: MediaStreamConstraints = {
				audio: {
					deviceId: form.audioInputDevice ? { exact: form.audioInputDevice } : undefined,
					autoGainControl: form.autoGainControl,
					echoCancellation: form.echoCancellation,
					noiseSuppression: form.noiseSuppression
				}
			};
			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			previewStream = stream;
			previewContext = new AudioContext();
			const source = previewContext.createMediaStreamSource(stream);
			previewAnalyser = previewContext.createAnalyser();
			previewAnalyser.fftSize = 2048;
			previewBuffer = new Uint8Array(new ArrayBuffer(previewAnalyser.fftSize));
			source.connect(previewAnalyser);
                        previewActive = true;
                        previewSignature = computePreviewSignature(form);
                        animatePreview();
                        showPermissionReminder = false;
                        void refreshDeviceList();
		} catch (error) {
			console.error('Failed to start microphone preview', error);
			previewError = m.settings_voice_preview_error();
			await stopPreview();
		} finally {
			previewLoading = false;
		}
	}

	async function restartPreview() {
		if (!previewActive || previewLoading) return;
		await startPreview();
	}

	async function stopPreview() {
		if (previewRaf != null) {
			cancelAnimationFrame(previewRaf);
			previewRaf = null;
		}
		if (previewAnalyser) {
			try {
				previewAnalyser.disconnect();
			} catch {}
		}
		if (previewContext) {
			try {
				await previewContext.close();
			} catch {}
		}
		if (previewStream) {
			for (const track of previewStream.getTracks()) {
				track.stop();
			}
		}
                previewStream = null;
                previewContext = null;
                previewAnalyser = null;
                previewBuffer = null;
                previewActive = false;
                previewSignature = '';
                previewLevel = 0;
                previewSpeaking = false;
        }

	function animatePreview() {
		if (!previewAnalyser || !previewBuffer) return;
		previewAnalyser.getByteTimeDomainData(previewBuffer as unknown as Uint8Array<ArrayBuffer>);
		let sumSquares = 0;
		for (let i = 0; i < previewBuffer.length; i += 1) {
			const value = previewBuffer[i] / 128 - 1;
			sumSquares += value * value;
		}
		const rms = Math.sqrt(sumSquares / previewBuffer.length);
		const level = clamp(rms * 2 * form.audioInputLevel, 0, 1);
		previewLevel = level;
		previewSpeaking = level >= form.audioInputThreshold;
		previewRaf = requestAnimationFrame(animatePreview);
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
					<span>{form.audioInputLevel.toFixed(2)}×</span>
				</label>
				<input
					id={inputVolumeId}
					type="range"
					min="0"
					max={INPUT_VOLUME_MAX}
					step="0.01"
					value={form.audioInputLevel}
					oninput={(event) =>
						updateForm({
							audioInputLevel: clamp(
								Number((event.currentTarget as HTMLInputElement).value) || 0,
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
					<span>{form.audioOutputLevel.toFixed(2)}×</span>
				</label>
				<input
					id={outputVolumeId}
					type="range"
					min="0"
					max={INPUT_VOLUME_MAX}
					step="0.01"
					value={form.audioOutputLevel}
					oninput={(event) =>
						updateForm({
							audioOutputLevel: clamp(
								Number((event.currentTarget as HTMLInputElement).value) || 0,
								0,
								INPUT_VOLUME_MAX
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
						previewSpeaking ? 'bg-[var(--success)]' : 'bg-[var(--brand)]/60'
					}`}
					style={`width: ${(previewLevel * 100).toFixed(2)}%`}
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
					{previewActive
						? previewSpeaking
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
					onclick={() => (previewActive ? stopPreview() : startPreview())}
					disabled={previewLoading}
				>
					{previewActive ? m.settings_voice_preview_stop() : m.settings_voice_preview_start()}
				</button>
			</div>
		</div>
		{#if previewError}
			<p class="mt-3 text-sm text-[var(--danger)]">{previewError}</p>
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
