import { browser } from '$app/environment';
import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { setSelfVoiceChannelId } from '$lib/stores/presence';
import { appSettings, cloneDeviceSettings, type DeviceSettings } from '$lib/stores/settings';
import {
        analyzeTimeDomainLevel,
        clampNormalized,
        decibelsToNormalized
} from '$lib/utils/audio';
import { playVoiceJoinSound, playVoiceOffSound, playVoiceOnSound } from '$lib/utils/sounds';

const noop = () => {};

const VOICE_LOG_PREFIX = '[voice]';

function logVoice(...args: unknown[]) {
        if (!browser) return;
        try {
                console.info(VOICE_LOG_PREFIX, ...args);
        } catch {}
}

export type VoiceConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type VoiceRemoteStream = {
        id: string;
        stream: MediaStream;
        userId: string | null;
};

type VoiceRemoteSettings = {
        volume: number;
        muted: boolean;
};

type StreamMonitor = {
        stop: () => void;
        userId: string;
};

type LocalAudioSendController = {
        stream: MediaStream;
        track: MediaStreamTrack;
        setInputLevel: (level: number) => void;
        setMuted: (muted: boolean) => void;
        configure: (options: {
                threshold: number;
                closeThreshold: number;
                holdMs: number;
                levelMultiplier: number;
                onGateChange?: (open: boolean) => void;
                onSpeaking?: (speaking: boolean) => void;
        }) => void;
        dispose: () => void;
};

type VoiceCameraError = 'permission' | 'acquisition' | 'peer' | 'not-connected';

type VoiceState = {
        status: VoiceConnectionStatus;
        guildId: string | null;
        channelId: string | null;
        error: string | null;
        muted: boolean;
        deafened: boolean;
        remoteStreams: VoiceRemoteStream[];
        remoteSettings: Record<string, VoiceRemoteSettings>;
        speakingUserIds: string[];
        latencyMs: number | null;
        cameraEnabled: boolean;
        cameraBusy: boolean;
        cameraError: VoiceCameraError | null;
        localVideoStream: MediaStream | null;
};

type VoiceSessionInternal = {
        id: number;
        guildId: string;
        channelId: string;
        ws: WebSocket | null;
        pc: RTCPeerConnection | null;
        localStream: MediaStream | null;
        localSendStream: MediaStream | null;
        localSendTrack: MediaStreamTrack | null;
        localSendController: LocalAudioSendController | null;
        localAudioSender: RTCRtpSender | null;
        remoteStreams: Map<string, MediaStream>;
        remoteUserIds: Map<string, string | null>;
        remoteMonitors: Map<string, StreamMonitor>;
        localMonitor: StreamMonitor | null;
        manualClose: boolean;
        pingInterval: ReturnType<typeof setInterval> | null;
        pendingPings: Map<string, number>;
        pendingLocalCandidates: RTCIceCandidateInit[];
        pendingRemoteCandidates: RTCIceCandidateInit[];
        processingRemoteOffer: boolean;
        lastRemoteOfferSdp: string | null;
        localVideoStream: MediaStream | null;
        localVideoSender: RTCRtpSender | null;
        localVideoTransceiver: RTCRtpTransceiver | null;
        localGateOpen: boolean;
        localGateControllable: boolean;
};

const initialState: VoiceState = {
        status: 'disconnected',
        guildId: null,
        channelId: null,
        error: null,
        muted: false,
        deafened: false,
        remoteStreams: [],
        remoteSettings: {},
        speakingUserIds: [],
        latencyMs: null,
        cameraEnabled: false,
        cameraBusy: false,
        cameraError: null,
        localVideoStream: null
};

const state = writable<VoiceState>(initialState);
export const voiceSession = derived(state, (value) => value);

const voicePanelChannel = writable<string | null>(null);
export const voicePanelChannelId = derived(voicePanelChannel, (value) => value);

export function setVoicePanelChannelId(channelId: string | null | undefined): void {
        const normalized = channelId ? String(channelId).trim() : '';
        voicePanelChannel.set(normalized ? normalized : null);
}

let session: VoiceSessionInternal | null = null;
let sessionCounter = 0;
let pingCounter = 0;
let cameraToggleInProgress = false;

const LOCAL_GATE_CLOSE_RATIO = 0.7;
const LOCAL_GATE_HOLD_MS = 300;
const LOCAL_GATE_THRESHOLD_DB_MIN = -60;
const LOCAL_GATE_THRESHOLD_MIN = decibelsToNormalized(LOCAL_GATE_THRESHOLD_DB_MIN);
const LOCAL_MONITOR_FFT_SIZE = 2048;
const LOCAL_MONITOR_SMOOTHING = 0.6;
const getTimestamp =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? () => performance.now()
                : () => Date.now();

function clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
}

function buildAudioConstraints(settings: DeviceSettings): MediaTrackConstraints {
        const constraints: MediaTrackConstraints = {
                autoGainControl: settings.autoGainControl,
                echoCancellation: settings.echoCancellation,
                noiseSuppression: settings.noiseSuppression
        };
        if (settings.audioInputDevice) {
                constraints.deviceId = { exact: settings.audioInputDevice };
        }
        return constraints;
}

function stopStream(stream: MediaStream | null | undefined) {
        if (!stream) return;
        for (const track of stream.getTracks()) {
                try {
                        track.stop();
                } catch {}
        }
}

function applyGainToTrack(track: MediaStreamTrack | null | undefined, gain: number) {
        if (!track || typeof track.applyConstraints !== 'function') return;
        const normalized = clamp(Number.isFinite(gain) ? Number(gain) : 1, 0, 1);
        try {
                const constraints: MediaTrackConstraints = {};
                (constraints as any).volume = normalized;
                const result = track.applyConstraints(constraints);
                if (result && typeof (result as Promise<void>).catch === 'function') {
                        (result as Promise<void>).catch(() => {});
                }
        } catch {}
}

async function replaceLocalAudioStream(settings: DeviceSettings): Promise<void> {
        if (!browser) return;
        const activeSession = session;
        if (!activeSession) return;
        const sessionId = activeSession.id;
        const constraints = buildAudioConstraints(settings);
        let newStream: MediaStream | null = null;
        let sendStream: MediaStream | null = null;
        let sendTrack: MediaStreamTrack | null = null;
        try {
                newStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        } catch (error) {
                console.error('Failed to apply audio device constraints, retrying with defaults.', error);
                try {
                        newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                } catch (fallbackError) {
                        console.error('Failed to acquire replacement audio stream.', fallbackError);
                        return;
                }
        }

        if (!session || session.id !== sessionId) {
                stopStream(newStream);
                return;
        }

        const newTrack = newStream.getAudioTracks()[0] ?? null;
        if (!newTrack) {
                stopStream(newStream);
                return;
        }

        const previousCaptureStream = activeSession.localStream;
        const previousSendStream = activeSession.localSendStream;
        const previousSendTrack = activeSession.localSendTrack;
        const previousController = activeSession.localSendController;

        const {
                sendStream: nextSendStream,
                sendTrack: nextSendTrack,
                gateControllable,
                controller
        } = buildOutboundAudioResources(newStream, settings);

        sendStream = nextSendStream;
        sendTrack = nextSendTrack;

        if (!session || session.id !== sessionId) {
                stopStream(newStream);
                if (controller) {
                        controller.dispose();
                } else {
                        stopStream(sendStream);
                        if (sendTrack && sendTrack !== sendStream?.getAudioTracks()[0]) {
                                try {
                                        sendTrack.stop();
                                } catch {}
                        }
                }
                return;
        }

        activeSession.localStream = newStream;
        activeSession.localSendStream = sendStream;
        activeSession.localSendTrack = sendTrack;
        activeSession.localSendController = controller;
        activeSession.localGateControllable = gateControllable;
        startLocalMonitor(activeSession);

        if (activeSession.pc) {
                const outboundTrack = sendTrack ?? newTrack;
                const outboundStream = sendStream ?? newStream;
                let sender = activeSession.localAudioSender;
                if (!sender) {
                        sender = activeSession.pc
                                .getSenders()
                                .find((item) => item.track?.kind === 'audio') ?? null;
                        if (sender) {
                                activeSession.localAudioSender = sender;
                        }
                }

                if (sender) {
                        try {
                                await sender.replaceTrack(outboundTrack);
                        } catch (error) {
                                console.error('Failed to replace audio track on peer connection.', error);
                        }
                } else {
                        try {
                                const createdSender = activeSession.pc.addTrack(outboundTrack, outboundStream);
                                activeSession.localAudioSender = createdSender;
                        } catch (error) {
                                console.error('Failed to attach audio track to peer connection.', error);
                        }
                }
        }

        applyMuteState(activeSession, get(state).muted);

        if (session && session.id === sessionId) {
                if (previousController && previousController !== controller) {
                        previousController.dispose();
                }
                stopStream(previousCaptureStream);
                if (previousSendStream && previousSendStream !== previousCaptureStream) {
                        stopStream(previousSendStream);
                }
                if (previousSendTrack && previousSendTrack !== previousSendStream?.getAudioTracks()[0]) {
                        try {
                                previousSendTrack.stop();
                        } catch {}
                }
        } else {
                stopStream(newStream);
                if (controller) {
                        controller.dispose();
                } else {
                        stopStream(sendStream);
                        if (sendTrack && sendTrack !== sendStream?.getAudioTracks()[0]) {
                                try {
                                        sendTrack.stop();
                                } catch {}
                        }
                }
        }
}

function getAudioContextConstructor(): typeof AudioContext | null {
        if (typeof window !== 'undefined') {
                const ctor =
                        window.AudioContext ??
                        (window as any).webkitAudioContext ??
                        (typeof AudioContext !== 'undefined' ? AudioContext : null);
                return ctor ?? null;
        }
        if (typeof AudioContext !== 'undefined') {
                return AudioContext;
        }
        return null;
}

function createLocalAudioSendController(
        stream: MediaStream,
        options: { inputLevel: number }
): LocalAudioSendController | null {
        if (!browser) return null;
        const AudioContextCtor = getAudioContextConstructor();
        if (!AudioContextCtor) return null;
        try {
                const context = new AudioContextCtor();
                const source = context.createMediaStreamSource(stream);
                const inputGain = context.createGain();
                const analyser = context.createAnalyser();
                const gateGain = context.createGain();
                const destination = context.createMediaStreamDestination();
                source.connect(inputGain);
                inputGain.connect(analyser);
                analyser.connect(gateGain);
                gateGain.connect(destination);

                analyser.fftSize = LOCAL_MONITOR_FFT_SIZE;
                analyser.smoothingTimeConstant = LOCAL_MONITOR_SMOOTHING;

                const outboundStream = destination.stream;
                const outboundTrack = outboundStream.getAudioTracks()[0] ?? null;
                if (!outboundTrack) {
                        context.close().catch(() => {});
                        return null;
                }

                const clampLevel = (value: number) => clamp(Number.isFinite(value) ? Number(value) : 1, 0, 1);
                const clampThresholdValue = (value: number) => clamp(Number.isFinite(value) ? Number(value) : 0, 0, 1);

                let disposed = false;
                let monitorActive = false;
                let monitorFrame = 0;
                let levelMultiplier = clampLevel(options.inputLevel);
                let threshold = LOCAL_GATE_THRESHOLD_MIN;
                let closeThreshold = LOCAL_GATE_THRESHOLD_MIN;
                let holdDuration = LOCAL_GATE_HOLD_MS;
                let lastGateOpenedAt = getTimestamp();
                let desiredGate = true;
                let effectiveGate = true;
                let muted = false;
                let onGateChange: ((open: boolean) => void) | null = null;
                let onSpeaking: ((speaking: boolean) => void) | null = null;
                let lastLevel = 0;
                let lastSpeaking = false;

                const buffer = new Uint8Array(analyser.fftSize);

                const applyGate = (open: boolean) => {
                        if (disposed || open === effectiveGate) {
                                effectiveGate = open;
                                return;
                        }
                        const target = open ? 1 : 0;
                        try {
                                gateGain.gain.setTargetAtTime(target, context.currentTime, 0.05);
                        } catch {
                                gateGain.gain.value = target;
                        }
                        effectiveGate = open;
                        if (onGateChange) {
                                try {
                                        onGateChange(effectiveGate);
                                } catch {}
                        }
                };

                const ensureGate = () => {
                        const shouldOpen = !muted && desiredGate;
                        applyGate(shouldOpen);
                };

                const stopMonitor = () => {
                        if (!monitorActive) return;
                        monitorActive = false;
                        if (monitorFrame) {
                                window.cancelAnimationFrame(monitorFrame);
                                monitorFrame = 0;
                        }
                };

                const update = () => {
                        if (disposed || !monitorActive) return;
                        analyser.getByteTimeDomainData(buffer);
                        const measurement = analyzeTimeDomainLevel(buffer, {
                                gain: levelMultiplier,
                                previous: lastLevel,
                                smoothing: 0.35
                        });
                        const level = clampThresholdValue(measurement.normalized);
                        lastLevel = level;
                        const now = getTimestamp();
                        if (level >= threshold) {
                                desiredGate = true;
                                lastGateOpenedAt = now;
                        } else if (desiredGate) {
                                const holdExpired = now - lastGateOpenedAt > holdDuration;
                                if (holdExpired && level <= closeThreshold) {
                                        desiredGate = false;
                                }
                        }
                        const speaking = !muted && level >= threshold;
                        if (speaking !== lastSpeaking) {
                                lastSpeaking = speaking;
                                if (onSpeaking) {
                                        try {
                                                onSpeaking(speaking);
                                        } catch {}
                                }
                        }
                        ensureGate();
                        monitorFrame = window.requestAnimationFrame(update);
                };

                const startMonitor = () => {
                        if (disposed || monitorActive) return;
                        monitorActive = true;
                        monitorFrame = window.requestAnimationFrame(update);
                };

                const configureMonitor = (config: {
                        threshold: number;
                        closeThreshold: number;
                        holdMs: number;
                        levelMultiplier: number;
                        onGateChange?: (open: boolean) => void;
                        onSpeaking?: (speaking: boolean) => void;
                }) => {
                        threshold = clampThresholdValue(config.threshold);
                        closeThreshold = clampThresholdValue(config.closeThreshold);
                        holdDuration = Math.max(0, Number.isFinite(config.holdMs) ? Number(config.holdMs) : LOCAL_GATE_HOLD_MS);
                        levelMultiplier = clampLevel(config.levelMultiplier);
                        onGateChange = typeof config.onGateChange === 'function' ? config.onGateChange : null;
                        onSpeaking = typeof config.onSpeaking === 'function' ? config.onSpeaking : null;
                        desiredGate = true;
                        lastGateOpenedAt = getTimestamp();
                        lastSpeaking = false;
                        stopMonitor();
                        ensureGate();
                        if (onGateChange) {
                                try {
                                        onGateChange(effectiveGate);
                                } catch {}
                        }
                        if (onSpeaking) {
                                try {
                                        onSpeaking(false);
                                } catch {}
                        }
                        startMonitor();
                };

                inputGain.gain.value = clampLevel(options.inputLevel);
                gateGain.gain.value = 1;
                outboundTrack.enabled = true;
                context.resume().catch(() => {});
                ensureGate();

                return {
                        stream: outboundStream,
                        track: outboundTrack,
                        setInputLevel(level: number) {
                                if (disposed) return;
                                const clamped = clampLevel(level);
                                inputGain.gain.value = clamped;
                                levelMultiplier = clamped;
                        },
                        setMuted(value: boolean) {
                                if (disposed) return;
                                muted = Boolean(value);
                                if (muted && lastSpeaking) {
                                        lastSpeaking = false;
                                        if (onSpeaking) {
                                                try {
                                                        onSpeaking(false);
                                                } catch {}
                                        }
                                }
                                ensureGate();
                        },
                        configure(config) {
                                if (disposed) return;
                                configureMonitor(config);
                        },
                        dispose() {
                                if (disposed) return;
                                disposed = true;
                                if (onGateChange) {
                                        try {
                                                onGateChange(false);
                                        } catch {}
                                }
                                if (onSpeaking) {
                                        try {
                                                onSpeaking(false);
                                        } catch {}
                                }
                                stopMonitor();
                                try {
                                        source.disconnect();
                                } catch {}
                                try {
                                        inputGain.disconnect();
                                } catch {}
                                try {
                                        analyser.disconnect();
                                } catch {}
                                try {
                                        gateGain.disconnect();
                                } catch {}
                                try {
                                        destination.disconnect?.();
                                } catch {}
                                for (const sendTrack of outboundStream.getTracks()) {
                                        try {
                                                sendTrack.stop();
                                        } catch {}
                                }
                                context.close().catch(() => {});
                        }
                };
        } catch (error) {
                console.error('Failed to build local audio processing graph.', error);
                return null;
        }
}

function applyLocalInputGain(settings: DeviceSettings) {
        const activeSession = session;
        if (!activeSession) return;
        const controller = activeSession.localSendController;
        if (controller) {
                controller.setInputLevel(settings.audioInputLevel);
                return;
        }
        const captureTrack = activeSession.localStream?.getAudioTracks()[0] ?? null;
        applyGainToTrack(captureTrack, settings.audioInputLevel);
        const sendTrack = activeSession.localSendTrack;
        if (sendTrack && sendTrack !== captureTrack) {
                applyGainToTrack(sendTrack, settings.audioInputLevel);
        }
}

function buildOutboundAudioResources(
        stream: MediaStream | null,
        settings: DeviceSettings
): {
        sendStream: MediaStream | null;
        sendTrack: MediaStreamTrack | null;
        gateControllable: boolean;
        controller: LocalAudioSendController | null;
} {
        if (!stream) {
                return { sendStream: null, sendTrack: null, gateControllable: false, controller: null };
        }
        const track = stream.getAudioTracks()[0] ?? null;
        if (!track) {
                return { sendStream: null, sendTrack: null, gateControllable: false, controller: null };
        }
        track.enabled = true;

        const controller = createLocalAudioSendController(stream, {
                inputLevel: settings.audioInputLevel
        });
        if (controller) {
                return {
                        sendStream: controller.stream,
                        sendTrack: controller.track,
                        gateControllable: true,
                        controller
                };
        }

        applyGainToTrack(track, settings.audioInputLevel);
        let cloned: MediaStreamTrack | null = null;
        try {
                cloned = typeof track.clone === 'function' ? track.clone() : null;
        } catch {
                cloned = null;
        }
        if (!cloned) {
                return { sendStream: stream, sendTrack: track, gateControllable: false, controller: null };
        }
        cloned.enabled = true;
        applyGainToTrack(cloned, settings.audioInputLevel);
        try {
                const outbound = new MediaStream();
                outbound.addTrack(cloned);
                return { sendStream: outbound, sendTrack: cloned, gateControllable: true, controller: null };
        } catch (error) {
                console.error('Failed to attach cloned audio track to send stream.', error);
                try {
                        cloned.stop();
                } catch {}
                return { sendStream: stream, sendTrack: track, gateControllable: false, controller: null };
        }
}

const defaultDeviceSettings = cloneDeviceSettings(null);
const REMOTE_SPEAKING_THRESHOLD = 0.08;
let lastDeviceSettings: DeviceSettings = defaultDeviceSettings;
let deviceSettingsQueue: Promise<void> = Promise.resolve();

function toApiSnowflake(id: string): any {
        return BigInt(id) as any;
}

function toNumericLiteral(id: string): string {
        return String(id ?? '').replace(/[^0-9]/g, '');
}

function toSnowflakeString(value: unknown): string | null {
        if (value == null) return null;
        try {
                if (typeof value === 'string') return value;
                if (typeof value === 'bigint') return value.toString();
                if (typeof value === 'number') return BigInt(value).toString();
                return String(value);
        } catch {
                try {
                        return String(value);
                } catch {
                        return null;
                }
        }
}

const remoteUserSettings = new Map<string, VoiceRemoteSettings>();
const speakingUsers = new Set<string>();

function emitRemoteSettings() {
        const record: Record<string, VoiceRemoteSettings> = {};
        for (const [userId, settings] of remoteUserSettings.entries()) {
                record[userId] = { ...settings };
        }
        state.update((current) => ({ ...current, remoteSettings: record }));
}

function emitSpeakingUsers() {
        state.update((current) => ({ ...current, speakingUserIds: Array.from(speakingUsers) }));
}

function ensureRemoteSettingsEntry(userId: string): VoiceRemoteSettings {
        let entry = remoteUserSettings.get(userId);
        if (!entry) {
                entry = { volume: 1, muted: false };
                remoteUserSettings.set(userId, entry);
                emitRemoteSettings();
        }
        return entry;
}

function pruneRemoteSettings(activeUserIds: Set<string>) {
        let changed = false;
        for (const id of Array.from(remoteUserSettings.keys())) {
                if (!activeUserIds.has(id)) {
                        remoteUserSettings.delete(id);
                        changed = true;
                }
        }
        if (changed) emitRemoteSettings();
}

function pruneSpeakingUsers(activeUserIds: Set<string>) {
        let changed = false;
        for (const id of Array.from(speakingUsers)) {
                if (!activeUserIds.has(id)) {
                        speakingUsers.delete(id);
                        changed = true;
                }
        }
        if (changed) emitSpeakingUsers();
}

function setUserSpeaking(userId: string | null, speaking: boolean) {
        if (!userId) return;
        const has = speakingUsers.has(userId);
        if (speaking) {
                if (!has) {
                        speakingUsers.add(userId);
                        emitSpeakingUsers();
                }
        } else if (has) {
                speakingUsers.delete(userId);
                emitSpeakingUsers();
        }
}

function resetRemoteState() {
        remoteUserSettings.clear();
        speakingUsers.clear();
        emitRemoteSettings();
        emitSpeakingUsers();
}

function normalizeLocalGateThreshold(value: number | null | undefined): number {
        if (!Number.isFinite(value)) return LOCAL_GATE_THRESHOLD_MIN;
        return clamp(Number(value), LOCAL_GATE_THRESHOLD_MIN, 1);
}

function createAudioLevelMonitor(
        stream: MediaStream | null,
        userId: string | null,
        options?: {
                levelMultiplier?: number;
                threshold?: number;
                thresholdMinimum?: number;
                onLevelChange?: (level: number) => void;
                fftSize?: number;
                smoothingTimeConstant?: number;
        }
): StreamMonitor | null {
        if (!browser) return null;
        if (!stream || !userId) return null;
        if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
        if (stream.getAudioTracks().length === 0) return null;
        try {
                const audioContext = new AudioContext();
                let monitorStream: MediaStream = stream;
                let disposeClone = false;
                if (typeof stream.clone === 'function') {
                        try {
                                monitorStream = stream.clone();
                                disposeClone = true;
                                for (const track of monitorStream.getAudioTracks()) {
                                        try {
                                                track.enabled = true;
                                        } catch {}
                                }
                        } catch {
                                monitorStream = stream;
                                disposeClone = false;
                        }
                }
                const source = audioContext.createMediaStreamSource(monitorStream);
                const analyser = audioContext.createAnalyser();
                const fftSize = options?.fftSize && Number.isFinite(options.fftSize)
                        ? Math.max(32, Math.min(32768, Math.floor(options.fftSize)))
                        : 512;
                analyser.fftSize = fftSize;
                if (Number.isFinite(options?.smoothingTimeConstant)) {
                        try {
                                analyser.smoothingTimeConstant = clamp(
                                        Number(options?.smoothingTimeConstant),
                                        0,
                                        0.99
                                );
                        } catch {}
                }
                const data = new Uint8Array(analyser.fftSize);
                let raf = 0;
                let disposed = false;
                let lastSpeaking = false;
                const levelMultiplier = clamp(
                        Number.isFinite(options?.levelMultiplier) ? Number(options?.levelMultiplier) : 1,
                        0,
                        4
                );
                const thresholdMinimum = clampNormalized(
                        Number.isFinite(options?.thresholdMinimum)
                                ? Number(options?.thresholdMinimum)
                                : 0
                );
                const threshold = clampNormalized(
                        Math.max(
                                thresholdMinimum,
                                Number.isFinite(options?.threshold)
                                        ? Number(options?.threshold)
                                        : REMOTE_SPEAKING_THRESHOLD
                        )
                );
                let lastLevel = 0;

                const update = () => {
                        if (disposed) return;
                        analyser.getByteTimeDomainData(data);
                        const measurement = analyzeTimeDomainLevel(data, {
                                gain: levelMultiplier,
                                previous: lastLevel,
                                smoothing: 0.35
                        });
                        const level = measurement.normalized;
                        lastLevel = level;
                        try {
                                options?.onLevelChange?.(level);
                        } catch {}
                        const speaking = level >= threshold;
                        if (speaking !== lastSpeaking) {
                                lastSpeaking = speaking;
                                setUserSpeaking(userId, speaking);
                        }
                        raf = window.requestAnimationFrame(update);
                };

                audioContext.resume().catch(() => {});
                update();

                return {
                        userId,
                        stop() {
                                if (disposed) return;
                                disposed = true;
                                if (raf) window.cancelAnimationFrame(raf);
                                setUserSpeaking(userId, false);
                                try {
                                        source.disconnect();
                                } catch {}
                                if (disposeClone) {
                                        for (const track of monitorStream.getTracks()) {
                                                try {
                                                        track.stop();
                                                } catch {}
                                        }
                                }
                                audioContext.close().catch(() => {});
                        }
                };
        } catch {
                return null;
        }
}

function startLocalMonitor(currentSession: VoiceSessionInternal) {
        currentSession.localMonitor?.stop();
        currentSession.localMonitor = null;
        const me = get(auth.user);
        const userId = toSnowflakeString((me as any)?.id);
        const controller = currentSession.localSendController;
        const localStream = currentSession.localStream;
        if (!controller && !localStream) {
                currentSession.localGateOpen = true;
                return;
        }
        const openThreshold = normalizeLocalGateThreshold(lastDeviceSettings.audioInputThreshold);
        const closeThreshold = normalizeLocalGateThreshold(openThreshold * LOCAL_GATE_CLOSE_RATIO);
        if (controller) {
                const gateSupported = currentSession.localGateControllable !== false;
                controller.configure({
                        threshold: openThreshold,
                        closeThreshold,
                        holdMs: LOCAL_GATE_HOLD_MS,
                        levelMultiplier: lastDeviceSettings.audioInputLevel,
                        onGateChange(open) {
                                const normalizedOpen = gateSupported ? open : true;
                                if (currentSession.localGateOpen !== normalizedOpen) {
                                        currentSession.localGateOpen = normalizedOpen;
                                }
                                applyMuteState(currentSession, get(state).muted, normalizedOpen);
                        },
                        onSpeaking(speaking) {
                                setUserSpeaking(userId, speaking);
                        }
                });
                return;
        }

        if (!localStream || !userId) {
                currentSession.localMonitor = null;
                currentSession.localGateOpen = true;
                return;
        }

        const gateSupported = currentSession.localGateControllable !== false;
        let gateOpen = gateSupported ? currentSession.localGateOpen ?? true : true;
        let lastGateOpenedAt = gateOpen ? getTimestamp() : 0;

        const applyGateState = (nextOpen: boolean) => {
                const normalizedOpen = gateSupported ? nextOpen : true;
                gateOpen = normalizedOpen;
                if (currentSession.localGateOpen !== normalizedOpen) {
                        currentSession.localGateOpen = normalizedOpen;
                }
                applyMuteState(currentSession, get(state).muted, normalizedOpen);
        };

        applyGateState(gateOpen);

        const monitor = createAudioLevelMonitor(localStream, userId, {
                levelMultiplier: lastDeviceSettings.audioInputLevel,
                threshold: openThreshold,
                thresholdMinimum: LOCAL_GATE_THRESHOLD_MIN,
                fftSize: LOCAL_MONITOR_FFT_SIZE,
                smoothingTimeConstant: LOCAL_MONITOR_SMOOTHING,
                onLevelChange(level) {
                        if (!browser) return;
                        const now = getTimestamp();
                        if (level >= openThreshold) {
                                lastGateOpenedAt = now;
                                if (!gateOpen) {
                                        applyGateState(true);
                                }
                                return;
                        }
                        if (!gateOpen) {
                                return;
                        }
                        const holdExpired = now - lastGateOpenedAt > LOCAL_GATE_HOLD_MS;
                        if (holdExpired && level <= closeThreshold) {
                                applyGateState(false);
                        }
                }
        });

        currentSession.localMonitor = monitor;
        if (!monitor) {
                applyGateState(true);
        }
}

function updateRemoteStreams(nextSession: VoiceSessionInternal | null) {
        const entries: VoiceRemoteStream[] = [];
        const activeUserIds = new Set<string>();
        if (nextSession) {
                for (const [id, stream] of nextSession.remoteStreams.entries()) {
                        const trackHints: string[] = [];
                        if (stream) {
                                for (const track of stream.getTracks()) {
                                        if (track?.id) trackHints.push(track.id);
                                        if (track?.label) trackHints.push(track.label);
                                }
                        }
                        const mappedUserId = nextSession.remoteUserIds.get(id) ?? null;
                        const userId = mappedUserId ?? extractUserId(stream?.id ?? null, id, ...trackHints);
                        entries.push({ id, stream, userId });
                        if (userId) {
                                activeUserIds.add(userId);
                                ensureRemoteSettingsEntry(userId);
                        }
                }
        }
        state.update((current) => ({ ...current, remoteStreams: entries }));
        if (nextSession) {
                pruneRemoteSettings(activeUserIds);
                pruneSpeakingUsers(activeUserIds);
        } else {
                resetRemoteState();
        }
}

function extractUserIdFromStreamId(streamId: string | null | undefined): string | null {
        if (typeof streamId !== 'string') return null;
        const trimmed = streamId.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('u:') || trimmed.startsWith('U:')) {
                const digits = trimmed.slice(2).replace(/[^0-9]/g, '');
                if (digits.length >= 15) {
                        return digits;
                }
        }
        return extractUserId(trimmed);
}

function extractUserIdFromStream(stream: MediaStream | null | undefined): string | null {
        if (!stream) return null;
        return extractUserIdFromStreamId(stream.id);
}

function parseUserIdFragment(value: string): string | null {
        if (/^[0-9]{15,}$/.test(value)) {
                return value;
        }

        const directMatch = value.match(/(?:^|[^0-9])([0-9]{15,})(?=$|[^0-9])/);
        if (directMatch) {
                return directMatch[1];
        }

        const prefixMatch = value.match(/(?:user|uid|participant)[-_:= ]*([0-9]{15,})/i);
        if (prefixMatch) {
                return prefixMatch[1];
        }

        const digitsOnly = value.replace(/[^0-9]/g, '');
        if (digitsOnly.length >= 15) {
                return digitsOnly;
        }

        return null;
}

function extractUserId(...candidates: (string | null | undefined)[]): string | null {
        const seen = new Set<string>();
        for (const candidate of candidates) {
                if (typeof candidate !== 'string') continue;
                const trimmed = candidate.trim();
                if (!trimmed || seen.has(trimmed)) continue;
                seen.add(trimmed);
                const parsed = parseUserIdFragment(trimmed);
                if (parsed) {
                        return parsed;
                }
        }
        return null;
}

function applyMuteState(target: VoiceSessionInternal | null, muted: boolean, gateOpen?: boolean) {
        const activeSession = target ?? session;
        if (!activeSession) return;

        const captureStream = activeSession.localStream;
        const captureTracks = captureStream ? captureStream.getAudioTracks() : [];
        const sendTrack = activeSession.localSendTrack;
        const sendIsCapture = Boolean(sendTrack && captureTracks.includes(sendTrack));
        const controller = activeSession.localSendController;

        if (!sendIsCapture) {
                for (const track of captureTracks) {
                        track.enabled = true;
                }
        }

        if (controller) {
                controller.setMuted(muted);
                if (sendTrack && !sendIsCapture) {
                        sendTrack.enabled = !muted;
                }
                return;
        }

        const gateAvailable = activeSession.localGateControllable !== false;
        const gateValue = typeof gateOpen === 'boolean' ? gateOpen : activeSession.localGateOpen ?? true;
        const effectiveGate = gateAvailable ? gateValue : true;
        const shouldTransmit = !muted && effectiveGate;

        if (sendTrack && !sendIsCapture) {
                sendTrack.enabled = shouldTransmit;
        } else {
                for (const track of captureTracks) {
                        track.enabled = shouldTransmit;
                }
        }
}

async function handleDeviceSettingsChange(
        previous: DeviceSettings,
        next: DeviceSettings
): Promise<void> {
        if (!browser) return;
        if (!session) return;

        const inputDeviceChanged = (previous.audioInputDevice ?? null) !== (next.audioInputDevice ?? null);
        const agcChanged = previous.autoGainControl !== next.autoGainControl;
        const echoChanged = previous.echoCancellation !== next.echoCancellation;
        const noiseChanged = previous.noiseSuppression !== next.noiseSuppression;
        const thresholdChanged = Math.abs(previous.audioInputThreshold - next.audioInputThreshold) > 1e-3;

        if (inputDeviceChanged || agcChanged || echoChanged || noiseChanged) {
                await replaceLocalAudioStream(next);
                return;
        }

        if (Math.abs(previous.audioInputLevel - next.audioInputLevel) > 1e-3) {
                applyLocalInputGain(next);
        }

        if (thresholdChanged) {
                startLocalMonitor(session);
        }
}

function setState(partial: Partial<VoiceState>) {
        state.update((current) => ({ ...current, ...partial }));
}

function stopLocalCamera(target: VoiceSessionInternal | null, updateStore = true) {
        if (!target) {
                if (updateStore) {
                        setState({ cameraEnabled: false, localVideoStream: null });
                }
                return;
        }

        const sender = target.localVideoSender;
        if (sender) {
                try {
                        const result = sender.replaceTrack(null);
                        if (result && typeof (result as Promise<void>).catch === 'function') {
                                (result as Promise<void>).catch(() => {});
                        }
                } catch {}
        }

        const transceiver = target.localVideoTransceiver;
        if (transceiver) {
                try {
                        transceiver.direction = 'recvonly';
                } catch {}
        }

        const stream = target.localVideoStream;
        target.localVideoStream = null;
        stopStream(stream);

        if (updateStore) {
                setState({ cameraEnabled: false, localVideoStream: null });
        }
}

function ensureLocalVideoSender(
        currentSession: VoiceSessionInternal,
        pcOverride?: RTCPeerConnection | null
): RTCRtpSender | null {
        const connection = pcOverride ?? currentSession.pc;
        if (!connection) return null;

        if (currentSession.localVideoSender) {
                return currentSession.localVideoSender;
        }

        if (currentSession.localVideoTransceiver && currentSession.localVideoTransceiver.sender) {
                currentSession.localVideoSender = currentSession.localVideoTransceiver.sender;
                return currentSession.localVideoSender;
        }

        try {
                const transceiver = connection.addTransceiver('video', { direction: 'sendrecv' });
                currentSession.localVideoTransceiver = transceiver;
                currentSession.localVideoSender = transceiver.sender;
                return transceiver.sender;
        } catch (error) {
                console.error('Failed to create local video transceiver.', error);
                return null;
        }
}

function stopLatencyProbe(currentSession: VoiceSessionInternal | null) {
        if (!currentSession) return;
        if (currentSession.pingInterval) {
                clearInterval(currentSession.pingInterval);
        }
        currentSession.pingInterval = null;
        currentSession.pendingPings.clear();
}

function sendLocalIceCandidate(
        currentSession: VoiceSessionInternal,
        candidate: RTCIceCandidateInit
): boolean {
        if (!candidate.candidate) return true;
        const socket = currentSession.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
                return false;
        }
        try {
                socket.send(
                        JSON.stringify({
                                op: 7,
                                t: 503,
                                d: {
                                        candidate: candidate.candidate,
                                        sdpMid: candidate.sdpMid ?? undefined,
                                        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined
                                }
                        })
                );
                return true;
        } catch {
                return false;
        }
}

function buildSignalUrl(rawUrl: string): string {
        try {
                const parsed = new URL(rawUrl);
                const trimmedPath = parsed.pathname.replace(/\/+$/, '');
                if (trimmedPath !== '/signal') {
                        parsed.pathname = '/signal';
                }
                return parsed.toString();
        } catch {
                return rawUrl;
        }
}

function parseSfuEventData<T = any>(payload: any): T | null {
        if (!payload) return null;
        const raw = payload.data;
        if (raw == null) return null;
        if (typeof raw === 'string') {
                        try {
                                return JSON.parse(raw) as T;
                        } catch (error) {
                                console.warn('Failed to parse SFU event payload.', error);
                                return null;
                        }
        }
        if (typeof raw === 'object') {
                return raw as T;
        }
        return null;
}

function toIceCandidateInit(data: any): RTCIceCandidateInit | null {
        if (!data || typeof data !== 'object') return null;
        const rawCandidate = data.candidate;
        if (typeof rawCandidate !== 'string' || rawCandidate.length === 0) {
                return null;
        }
        const candidate: RTCIceCandidateInit = { candidate: rawCandidate };
        if (data.sdpMid != null) {
                candidate.sdpMid = String(data.sdpMid);
        }
        if (data.sdpMLineIndex != null) {
                const index = Number(data.sdpMLineIndex);
                if (Number.isFinite(index)) {
                        candidate.sdpMLineIndex = index;
                }
        }
        return candidate;
}

async function handleRemoteIceCandidate(
        currentSession: VoiceSessionInternal,
        candidateInit: RTCIceCandidateInit
): Promise<void> {
        if (!candidateInit.candidate) {
                return;
        }

        try {
                const pc = currentSession.pc;
                if (pc && pc.remoteDescription) {
                        await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
                        logVoice('applied immediate remote ICE candidate', {
                                sessionId: currentSession.id
                        });
                } else {
                        currentSession.pendingRemoteCandidates.push(candidateInit);
                        logVoice('queued remote ICE candidate', {
                                sessionId: currentSession.id,
                                pending: currentSession.pendingRemoteCandidates.length
                        });
                }
        } catch (error) {
                console.warn('Failed to apply remote ICE candidate.', error);
        }
}

function flushPendingLocalCandidates(currentSession: VoiceSessionInternal): void {
        const pc = currentSession.pc;
        if (!pc || !pc.remoteDescription || !pc.localDescription) {
                return;
        }

        while (currentSession.pendingLocalCandidates.length > 0) {
                const nextCandidate = currentSession.pendingLocalCandidates[0]!;
                if (!sendLocalIceCandidate(currentSession, nextCandidate)) {
                        logVoice('failed to send local ICE candidate, socket not ready', {
                                sessionId: currentSession.id,
                                remaining: currentSession.pendingLocalCandidates.length
                        });
                        break;
                }
                currentSession.pendingLocalCandidates.shift();
                logVoice('sent local ICE candidate', {
                        sessionId: currentSession.id,
                        remaining: currentSession.pendingLocalCandidates.length
                });
        }
}

async function flushPendingRemoteCandidates(currentSession: VoiceSessionInternal): Promise<void> {
        const pc = currentSession.pc;
        if (!pc || !pc.remoteDescription) {
                return;
        }

        while (currentSession.pendingRemoteCandidates.length > 0) {
                const candidateInit = currentSession.pendingRemoteCandidates.shift();
                if (!candidateInit) {
                        continue;
                }
                try {
                        await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
                        logVoice('applied pending remote ICE candidate', {
                                sessionId: currentSession.id,
                                remaining: currentSession.pendingRemoteCandidates.length
                        });
                } catch (error) {
                        console.warn('Failed to apply pending remote ICE candidate.', error);
                }
        }
}

function createPingNonce(): string {
        pingCounter += 1;
        return `ping-${Date.now()}-${pingCounter}`;
}

function sendLatencyPing(currentSession: VoiceSessionInternal) {
        if (!currentSession.ws || currentSession.ws.readyState !== WebSocket.OPEN) return;
        const nonce = createPingNonce();
        const ts = Date.now();
        currentSession.pendingPings.set(nonce, ts);
        try {
                currentSession.ws.send(
                        JSON.stringify({
                                op: 2,
                                d: {
                                        nonce,
                                        ts
                                }
                        })
                );
        } catch {
                currentSession.pendingPings.delete(nonce);
        }
}

function startLatencyProbe(currentSession: VoiceSessionInternal) {
        stopLatencyProbe(currentSession);
        const tick = () => sendLatencyPing(currentSession);
        tick();
        currentSession.pingInterval = setInterval(tick, 10_000);
        logVoice('started latency probe', { sessionId: currentSession.id });
}

function respondToSfuPing(currentSession: VoiceSessionInternal, payload: any): void {
        const socket = currentSession.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const rawNonce = payload?.d?.nonce;
        const hasNonce = typeof rawNonce === 'string' || typeof rawNonce === 'number';
        const body: any = { op: 2, d: { pong: true } };
        if (hasNonce) {
                body.d.nonce = rawNonce;
        }
        try {
                socket.send(JSON.stringify(body));
                logVoice('responded to SFU ping', {
                        sessionId: currentSession.id,
                        nonce: hasNonce ? String(rawNonce) : null
                });
        } catch (error) {
                console.error('Failed to respond to SFU ping.', error);
        }
}

function clearSession(options: { error?: string | null; manual?: boolean } = {}) {
        if (options.error) {
                logVoice('clearing session with error', options.error);
        } else if (options.manual) {
                logVoice('clearing session manually');
        } else {
                logVoice('clearing session');
        }
        const current = session;
        if (!current) {
                if (options.error) {
                        setState({
                                status: 'error',
                                error: options.error,
                                guildId: null,
                                channelId: null,
                                remoteStreams: [],
                                remoteSettings: {},
                                speakingUserIds: [],
                                latencyMs: null,
                                cameraEnabled: false,
                                cameraBusy: false,
                                cameraError: null,
                                localVideoStream: null
                        });
                } else {
                        setState({
                                status: 'disconnected',
                                error: null,
                                guildId: null,
                                channelId: null,
                                remoteStreams: [],
                                remoteSettings: {},
                                speakingUserIds: [],
                                latencyMs: null,
                                cameraEnabled: false,
                                cameraBusy: false,
                                cameraError: null,
                                localVideoStream: null
                        });
                }
                setSelfVoiceChannelId(null);
                return;
        }

        cameraToggleInProgress = false;
        stopLocalCamera(current);
        current.localVideoSender = null;
        current.localVideoTransceiver = null;

        session = null;

        stopLatencyProbe(current);

        current.localMonitor?.stop();
        current.localMonitor = null;
        current.localSendController?.dispose();
        current.localSendController = null;
        stopStream(current.localSendStream);
        current.localSendStream = null;
        current.localSendTrack = null;
        current.localAudioSender = null;
        current.localGateControllable = true;
        for (const monitor of current.remoteMonitors.values()) {
                monitor.stop();
        }
        current.remoteMonitors.clear();

        current.pendingLocalCandidates = [];
        current.pendingRemoteCandidates = [];
        current.lastRemoteOfferSdp = null;

        current.remoteUserIds.clear();
        current.localGateOpen = true;

        try {
                if (current.ws) {
                        current.ws.onopen = noop;
                        current.ws.onmessage = noop;
                        current.ws.onerror = noop;
                        current.ws.onclose = noop;
                        try {
                                current.ws.close();
                        } catch {}
                }
        } catch {}

        try {
                if (current.pc) {
                        current.pc.onicecandidate = null;
                        current.pc.ontrack = null;
                        current.pc.onconnectionstatechange = null;
                        try {
                                current.pc.close();
                        } catch {}
                }
        } catch {}

        if (current.localStream) {
                for (const track of current.localStream.getTracks()) {
                        try {
                                track.stop();
                        } catch {}
                }
        }

        for (const stream of current.remoteStreams.values()) {
                for (const track of stream.getTracks()) {
                        try {
                                track.stop();
                        } catch {}
                }
        }

        current.remoteStreams.clear();

        updateRemoteStreams(null);
        setSelfVoiceChannelId(null);

        if (options.error) {
                        setState({
                                status: 'error',
                                error: options.error,
                                guildId: null,
                                channelId: null,
                                remoteStreams: [],
                                remoteSettings: {},
                                speakingUserIds: [],
                                latencyMs: null,
                                cameraEnabled: false,
                                cameraBusy: false,
                                cameraError: null,
                                localVideoStream: null
                        });
        } else {
                        setState({
                                status: 'disconnected',
                                error: null,
                                guildId: null,
                                channelId: null,
                                remoteStreams: [],
                                remoteSettings: {},
                                speakingUserIds: [],
                                latencyMs: null,
                                cameraEnabled: false,
                                cameraBusy: false,
                                cameraError: null,
                                localVideoStream: null
                        });
        }
}

async function createPeerConnection(currentSession: VoiceSessionInternal): Promise<RTCPeerConnection> {
        if (!currentSession.ws) {
                throw new Error('Missing SFU socket');
        }

        logVoice('creating peer connection', {
                sessionId: currentSession.id,
                guildId: currentSession.guildId,
                channelId: currentSession.channelId
        });

        const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        currentSession.pc = pc;
        currentSession.pendingLocalCandidates = [];
        currentSession.processingRemoteOffer = false;
        currentSession.lastRemoteOfferSdp = null;

        pc.onicecandidate = (event) => {
                if (!event.candidate) {
                        logVoice('local ICE gathering complete', {
                                sessionId: currentSession.id
                        });
                        return;
                }
                const candidateInit: RTCIceCandidateInit = {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid ?? undefined,
                        sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined
                };
                currentSession.pendingLocalCandidates.push(candidateInit);
                logVoice('local ICE candidate gathered', {
                        sessionId: currentSession.id,
                        totalPending: currentSession.pendingLocalCandidates.length
                });
                flushPendingLocalCandidates(currentSession);
        };

        pc.ontrack = (event) => {
                if (!session || session.id !== currentSession.id) return;
                const trackId = event.track?.id ?? '';
                const primaryStream = event.streams[0] ?? null;
                const primaryUserId = extractUserIdFromStream(primaryStream);
                for (const stream of event.streams) {
                        const streamId = stream.id || '';
                        const keySource = streamId || trackId || `${Date.now()}-${Math.random()}`;
                        const key = trackId ? `${keySource}:${trackId}` : keySource;
                        const trackHints: string[] = [];
                        for (const track of stream.getTracks()) {
                                if (track?.id) trackHints.push(track.id);
                                if (track?.label) trackHints.push(track.label);
                        }
                        const streamUserCandidate = extractUserIdFromStream(stream) ?? primaryUserId;
                        const userId =
                                streamUserCandidate ??
                                extractUserId(streamId, trackId, event.track?.label, key, ...trackHints);
                        currentSession.remoteStreams.set(key, stream);
                        currentSession.remoteUserIds.set(key, userId ?? null);
                        if (userId) {
                                const existingMonitor = currentSession.remoteMonitors.get(key);
                                existingMonitor?.stop();
                                const monitor = createAudioLevelMonitor(stream, userId, {
                                        threshold: REMOTE_SPEAKING_THRESHOLD
                                });
                                if (monitor) {
                                        currentSession.remoteMonitors.set(key, monitor);
                                }
                        }
                        stream.onremovetrack = () => {
                                const remaining = stream.getTracks();
                                if (remaining.length === 0) {
                                        currentSession.remoteStreams.delete(key);
                                        currentSession.remoteUserIds.delete(key);
                                }
                                const hasAudio = remaining.some((item) => item.kind === 'audio');
                                const monitor = currentSession.remoteMonitors.get(key);
                                if (!hasAudio && monitor) {
                                        monitor.stop();
                                        currentSession.remoteMonitors.delete(key);
                                }
                                if (!hasAudio && remaining.length > 0) {
                                        currentSession.remoteStreams.set(key, stream);
                                }
                                updateRemoteStreams(currentSession);
                        };
                        stream.onaddtrack = () => {
                                updateRemoteStreams(currentSession);
                        };
                }
                logVoice('remote track received', {
                        sessionId: currentSession.id,
                        trackId,
                        streamCount: event.streams.length
                });
                updateRemoteStreams(currentSession);
        };

        pc.onconnectionstatechange = () => {
                if (!session || session.id !== currentSession.id) return;
                const stateValue = pc.connectionState;
                logVoice('peer connection state change', {
                        sessionId: currentSession.id,
                        state: stateValue
                });
                if (stateValue === 'connected') {
                        const previousStatus = get(state).status;
                        setState({ status: 'connected', error: null });
                        if (previousStatus !== 'connected') {
                                playVoiceJoinSound();
                        }
                }
                if (stateValue === 'disconnected') {
                        setState({ status: 'connecting' });
                }
                if (stateValue === 'failed' || stateValue === 'closed') {
                        if (!currentSession.manualClose) {
                                clearSession({ error: 'Voice connection lost.' });
                        }
                }
        };

        pc.onnegotiationneeded = () => {
                if (!session || session.id !== currentSession.id) return;
                logVoice('peer connection negotiation needed', {
                        sessionId: currentSession.id,
                        signalingState: pc.signalingState
                });
        };

        pc.oniceconnectionstatechange = () => {
                if (!session || session.id !== currentSession.id) return;
                logVoice('ICE connection state change', {
                        sessionId: currentSession.id,
                        state: pc.iceConnectionState
                });
        };

        const currentState = get(state);
        const outboundTrack =
                currentSession.localSendTrack ?? currentSession.localStream?.getAudioTracks()[0] ?? null;
        const outboundStream = currentSession.localSendStream ?? currentSession.localStream ?? null;
        if (outboundTrack && outboundStream) {
                let sender = currentSession.localAudioSender;
                if (!sender) {
                        sender = pc
                                .getSenders()
                                .find((item) => item.track?.kind === 'audio') ?? null;
                        if (!sender) {
                                try {
                                        sender = pc.addTrack(outboundTrack, outboundStream);
                                } catch (error) {
                                        console.error('Failed to attach audio track to peer connection.', error);
                                        sender = null;
                                }
                        }
                        if (sender) {
                                currentSession.localAudioSender = sender;
                        }
                } else if (sender.track !== outboundTrack) {
                        try {
                                const result = sender.replaceTrack(outboundTrack);
                                if (result && typeof (result as Promise<void>).catch === 'function') {
                                        (result as Promise<void>).catch(() => {});
                                }
                        } catch (error) {
                                console.error('Failed to sync audio sender track.', error);
                        }
                }

                applyMuteState(currentSession, currentState.muted);
        }

        const sender = ensureLocalVideoSender(currentSession, pc);
        if (sender && currentSession.localVideoTransceiver && !get(state).cameraEnabled) {
                try {
                        currentSession.localVideoTransceiver.direction = 'recvonly';
                } catch {}
        }

        return pc;
}

async function handleServerOffer(currentSession: VoiceSessionInternal, sdp: string): Promise<void> {
        const offerSdp = typeof sdp === 'string' ? sdp : '';
        if (!offerSdp) {
                throw new Error('SFU offer missing SDP');
        }

        logVoice('handling SFU offer', {
                sessionId: currentSession.id,
                offerSize: offerSdp.length
        });

        try {
                if (currentSession.processingRemoteOffer) {
                        logVoice('ignoring SFU offer, already processing one', {
                                sessionId: currentSession.id
                        });
                        return;
                }

                const pc = currentSession.pc ?? (await createPeerConnection(currentSession));
                if (!pc) {
                        throw new Error('Peer connection unavailable');
                }

                if (
                        pc.remoteDescription?.sdp === offerSdp &&
                        currentSession.lastRemoteOfferSdp === offerSdp
                ) {
                        logVoice('ignoring duplicate SFU offer', {
                                sessionId: currentSession.id
                        });
                        return;
                }

                currentSession.processingRemoteOffer = true;
                await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
                currentSession.lastRemoteOfferSdp = offerSdp;
                logVoice('applied remote offer', { sessionId: currentSession.id });
                await flushPendingRemoteCandidates(currentSession);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                logVoice('created and set local answer', {
                        sessionId: currentSession.id,
                        answerSize: answer.sdp?.length ?? 0
                });
                flushPendingLocalCandidates(currentSession);

                if (!currentSession.ws || currentSession.ws.readyState !== WebSocket.OPEN) {
                        throw new Error('SFU socket is not open');
                }

                currentSession.ws.send(
                        JSON.stringify({
                                op: 7,
                                t: 502,
                                d: { sdp: answer.sdp ?? '' }
                        })
                );

                logVoice('sent local answer to SFU', { sessionId: currentSession.id });
        } catch (error) {
                currentSession.lastRemoteOfferSdp = null;
                throw error;
        } finally {
                currentSession.processingRemoteOffer = false;
        }
}

function ensureBrowser(): void {
        if (!browser) {
                throw new Error('Voice connections require a browser environment');
        }
}

export async function joinVoiceChannel(guildId: string, channelId: string): Promise<void> {
        ensureBrowser();
        const normalizedGuild = String(guildId ?? '').trim();
        const normalizedChannel = String(channelId ?? '').trim();
        if (!normalizedGuild || !normalizedChannel) return;

        logVoice('joinVoiceChannel invoked', {
                guildId: normalizedGuild,
                channelId: normalizedChannel
        });

        const channelLiteral = toNumericLiteral(normalizedChannel);
        if (!channelLiteral) {
                setState({ status: 'error', error: 'Invalid channel identifier.', guildId: null, channelId: null });
                return;
        }

        if (session && session.guildId === normalizedGuild && session.channelId === normalizedChannel) {
                logVoice('already connected to voice channel', {
                        guildId: normalizedGuild,
                        channelId: normalizedChannel
                });
                return;
        }

        if (session) {
                logVoice('rejoining voice channel, existing session will be closed', {
                        previousGuildId: session.guildId,
                        previousChannelId: session.channelId
                });
                leaveVoiceChannel();
        }

        const attemptId = ++sessionCounter;
        setState({
                status: 'connecting',
                guildId: normalizedGuild,
                channelId: normalizedChannel,
                error: null,
                remoteStreams: [],
                remoteSettings: {},
                speakingUserIds: [],
                latencyMs: null,
                cameraEnabled: false,
                cameraBusy: false,
                cameraError: null,
                localVideoStream: null
        });

        const deviceSnapshot = cloneDeviceSettings(lastDeviceSettings);
        let localStream: MediaStream | null = null;
        try {
                localStream = await navigator.mediaDevices.getUserMedia({
                        audio: buildAudioConstraints(deviceSnapshot)
                });
                logVoice('acquired preferred local audio stream', { sessionId: attemptId });
        } catch (error) {
                console.error('Failed to acquire preferred audio stream.', error);
                try {
                        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        logVoice('acquired fallback local audio stream', { sessionId: attemptId });
                } catch (fallbackError) {
                        console.error('Failed to acquire fallback audio stream.', fallbackError);
                        localStream = null;
                        logVoice('failed to acquire any local audio stream', { sessionId: attemptId });
                }
        }

        try {
                logVoice('requesting SFU credentials', {
                        sessionId: attemptId,
                        guildId: normalizedGuild,
                        channelId: normalizedChannel
                });
                const response = await auth.api.guild.guildGuildIdVoiceChannelIdJoinPost({
                        guildId: toApiSnowflake(normalizedGuild),
                        channelId: toApiSnowflake(normalizedChannel)
                });
                const sfuUrl = response.data?.sfu_url ?? '';
                const token = response.data?.sfu_token ?? '';
                if (!sfuUrl || !token) {
                        throw new Error('SFU connection info missing');
                }

                logVoice('received SFU credentials', {
                        sessionId: attemptId,
                        hasUrl: Boolean(sfuUrl),
                        hasToken: Boolean(token)
                });

                const signalUrl = buildSignalUrl(sfuUrl);
                const ws = new WebSocket(signalUrl);

                logVoice('created SFU websocket', {
                        sessionId: attemptId,
                        url: signalUrl
                });

                const currentSession: VoiceSessionInternal = {
                        id: attemptId,
                        guildId: normalizedGuild,
                        channelId: normalizedChannel,
                        ws,
                        pc: null,
                        localStream,
                        localSendStream: null,
                        localSendTrack: null,
                        localSendController: null,
                        localAudioSender: null,
                        remoteStreams: new Map(),
                        remoteUserIds: new Map(),
                        remoteMonitors: new Map(),
                        localMonitor: null,
                        manualClose: false,
                        pingInterval: null,
                        pendingPings: new Map(),
                        pendingLocalCandidates: [],
                        pendingRemoteCandidates: [],
                        processingRemoteOffer: false,
                        lastRemoteOfferSdp: null,
                        localVideoStream: null,
                        localVideoSender: null,
                        localVideoTransceiver: null,
                        localGateOpen: true,
                        localGateControllable: true
                };

                session = currentSession;

                logVoice('voice session created', {
                        sessionId: currentSession.id,
                        guildId: currentSession.guildId,
                        channelId: currentSession.channelId,
                        hasLocalStream: Boolean(localStream)
                });

                if (localStream) {
                        const {
                                sendStream: initialSendStream,
                                sendTrack: initialSendTrack,
                                gateControllable,
                                controller
                        } = buildOutboundAudioResources(localStream, deviceSnapshot);
                        currentSession.localSendStream = initialSendStream;
                        currentSession.localSendTrack = initialSendTrack;
                        currentSession.localSendController = controller;
                        currentSession.localGateControllable = gateControllable;
                } else {
                        currentSession.localSendStream = null;
                        currentSession.localSendTrack = null;
                        currentSession.localSendController = null;
                        currentSession.localGateControllable = false;
                }

                setSelfVoiceChannelId(normalizedChannel);
                startLocalMonitor(currentSession);

                ws.onopen = () => {
                        if (!session || session.id !== attemptId) return;
                        logVoice('SFU websocket open', { sessionId: attemptId });
                        const joinPayload = `{"op":7,"t":500,"d":{"channel":${channelLiteral},"token":${JSON.stringify(token)}}}`;
                        try {
                                ws.send(joinPayload);
                                logVoice('sent SFU join payload', {
                                        sessionId: attemptId,
                                        channelLiteral
                                });
                        } catch (error) {
                                clearSession({ error: 'Failed to join SFU.' });
                        }
                };

                ws.onerror = (event) => {
                        if (!session || session.id !== attemptId) return;
                        const errorEvent = event as unknown as { message?: unknown };
                        const errorMessage =
                                typeof errorEvent.message === 'string' ? errorEvent.message : null;
                        logVoice('SFU websocket error', {
                                sessionId: attemptId,
                                message: errorMessage
                        });
                        clearSession({ error: 'SFU connection error.' });
                };

                ws.onclose = (event) => {
                        if (!session || session.id !== attemptId) return;
                        logVoice('SFU websocket closed', {
                                sessionId: attemptId,
                                code: event.code,
                                reason: event.reason
                        });
                        stopLatencyProbe(currentSession);
                        if (currentSession.manualClose) {
                                clearSession({ manual: true });
                        } else {
                                clearSession({ error: 'Voice connection closed.' });
                        }
                };

                ws.onmessage = async (event) => {
                        if (!session || session.id !== attemptId) return;
                        let payload: any;
                        try {
                                payload = JSON.parse(event.data);
                        } catch {
                                return;
                        }
                        logVoice('received SFU message', {
                                sessionId: attemptId,
                                op: payload?.op,
                                t: payload?.t,
                                event: typeof payload?.event === 'string' ? payload.event : null
                        });

                        const eventName = typeof payload?.event === 'string' ? payload.event : null;
                        if (eventName) {
                                const eventData = parseSfuEventData(payload);
                                if (eventName === 'offer') {
                                        try {
                                                const sdp = typeof eventData?.sdp === 'string' ? eventData.sdp : '';
                                                logVoice('received SFU offer event', {
                                                        sessionId: attemptId,
                                                        sdpSize: sdp.length
                                                });
                                                await handleServerOffer(currentSession, sdp);
                                        } catch (error: any) {
                                                clearSession({
                                                        error: error?.message ?? 'Failed to apply SFU offer.'
                                                });
                                        }
                                } else if (eventName === 'candidate') {
                                        const candidateInit = toIceCandidateInit(eventData);
                                        if (candidateInit) {
                                                await handleRemoteIceCandidate(currentSession, candidateInit);
                                        }
                                } else if (eventName === 'error') {
                                        const message =
                                                typeof eventData?.message === 'string'
                                                        ? eventData.message
                                                        : 'SFU error.';
                                        logVoice('received SFU error event', {
                                                sessionId: attemptId,
                                                message
                                        });
                                        clearSession({ error: message });
                                } else if (eventName === 'answer') {
                                        logVoice('received unexpected SFU answer event', {
                                                sessionId: attemptId
                                        });
                                } else {
                                        logVoice('ignored SFU event message', {
                                                sessionId: attemptId,
                                                event: eventName
                                        });
                                }
                                return;
                        }

                        if (payload?.op === 7) {
                                if (payload?.t === 500) {
                                        if (payload?.d?.ok) {
                                                try {
                                                        logVoice('SFU join acknowledged', { sessionId: attemptId });
                                                        await createPeerConnection(currentSession);
                                                        startLatencyProbe(currentSession);
                                                        const socket = currentSession.ws;
                                                        if (socket && socket.readyState === WebSocket.OPEN) {
                                                                try {
                                                                        socket.send(
                                                                                JSON.stringify({
                                                                                        op: 7,
                                                                                        t: 505,
                                                                                        d: { muted: get(state).muted }
                                                                                })
                                                                        );
                                                                } catch {}
                                                        }
                                                } catch (error: any) {
                                                        clearSession({
                                                                error:
                                                                        error?.message ?? 'Failed to establish voice connection.'
                                                        });
                                                }
                                        } else {
                                                logVoice('SFU join rejected', {
                                                        sessionId: attemptId,
                                                        error: payload?.d?.error ?? null
                                                });
                                                clearSession({ error: payload?.d?.error ?? 'SFU join rejected.' });
                                        }
                                } else if (payload?.t === 501) {
                                        try {
                                                logVoice('received SFU offer', {
                                                        sessionId: attemptId,
                                                        sdpSize: payload?.d?.sdp?.length ?? 0
                                                });
                                                await handleServerOffer(currentSession, payload?.d?.sdp ?? '');
                                        } catch (error: any) {
                                                clearSession({
                                                        error: error?.message ?? 'Failed to apply SFU offer.'
                                                });
                                        }
                                } else if (payload?.t === 502) {
                                        logVoice('received unexpected SFU answer envelope', {
                                                sessionId: attemptId
                                        });
                                } else if (payload?.t === 503) {
                                        const candidateInit = toIceCandidateInit(payload?.d);
                                        if (candidateInit) {
                                                await handleRemoteIceCandidate(currentSession, candidateInit);
                                        }
                                } else if (payload?.t === 512) {
                                        logVoice('received SFU channel move', { sessionId: attemptId });
                                        clearSession({ error: 'Moved to another channel.' });
                                }
                        } else if (payload?.op === 2) {
                                if (payload?.d?.pong) {
                                        const rawNonce = payload?.d?.nonce;
                                        const nonce = rawNonce != null ? String(rawNonce) : null;
                                        if (nonce) {
                                                const sent = currentSession.pendingPings.get(nonce);
                                                if (sent != null) {
                                                        currentSession.pendingPings.delete(nonce);
                                                        const latency = Math.max(0, Date.now() - sent);
                                                        setState({ latencyMs: latency });
                                                        logVoice('received latency pong', {
                                                                sessionId: attemptId,
                                                                latency
                                                        });
                                                }
                                        }
                                } else if (payload?.d?.ping || payload?.d?.nonce != null) {
                                        respondToSfuPing(currentSession, payload);
                                }
                        } else {
                                logVoice('ignored SFU message', {
                                        sessionId: attemptId,
                                        op: payload?.op,
                                        keys: Object.keys(payload ?? {})
                                });
                        }
                };

                if (!localStream) {
                        applyMuteState(currentSession, get(state).muted);
                }

                updateRemoteStreams(currentSession);
        } catch (error: any) {
                session = null;
                setState({
                        status: 'error',
                        error: error?.response?.data?.message ?? error?.message ?? 'Failed to join voice channel.',
                        guildId: null,
                        channelId: null,
                        remoteStreams: [],
                        remoteSettings: {},
                        speakingUserIds: [],
                        latencyMs: null
                });
                setSelfVoiceChannelId(null);
                if (localStream) {
                        for (const track of localStream.getTracks()) {
                                try {
                                        track.stop();
                                } catch {}
                        }
                }
        }
}

export function leaveVoiceChannel(): void {
        logVoice('leaveVoiceChannel invoked', {
                hasSession: Boolean(session)
        });
        if (!session) {
                clearSession();
                return;
        }
        session.manualClose = true;
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                try {
                        session.ws.send(JSON.stringify({ op: 7, t: 504, d: {} }));
                } catch {}
        }
        clearSession({ manual: true });
}

export async function setVoiceCameraEnabled(enabled: boolean): Promise<void> {
        ensureBrowser();
        if (cameraToggleInProgress) {
                return;
        }

        const currentState = get(state);
        if (enabled === currentState.cameraEnabled) {
                if (!enabled) {
                        setState({ cameraError: null });
                }
                return;
        }

        const currentSession = session;
        if (!currentSession) {
                if (enabled) {
                        setState({ cameraError: 'not-connected', cameraEnabled: false, cameraBusy: false });
                } else {
                        setState({ cameraEnabled: false, cameraBusy: false, cameraError: null, localVideoStream: null });
                }
                return;
        }

        cameraToggleInProgress = true;
        setState({ cameraBusy: true, cameraError: null });

        const finish = () => {
                cameraToggleInProgress = false;
                setState({ cameraBusy: false });
        };

        if (!enabled) {
                stopLocalCamera(currentSession);
                finish();
                setState({ cameraEnabled: false, cameraError: null, localVideoStream: null });
                return;
        }

        let stream: MediaStream | null = null;
        const cleanup = () => {
                if (stream) {
                        stopStream(stream);
                        stream = null;
                }
        };

        const fail = (code: VoiceCameraError) => {
                if (session && session.id === currentSession.id) {
                        stopLocalCamera(currentSession, false);
                }
                setState({ cameraEnabled: false, cameraError: code, localVideoStream: null });
        };

        try {
                try {
                        const videoConstraints: MediaTrackConstraints = {
                                width: { ideal: 1280 },
                                height: { ideal: 720 },
                                frameRate: { ideal: 30 }
                        };
                        const preferredDevice = lastDeviceSettings.videoDevice;
                        if (preferredDevice) {
                                videoConstraints.deviceId = { exact: preferredDevice };
                        }
                        stream = await navigator.mediaDevices.getUserMedia({
                                video: videoConstraints
                        });
                } catch (error: any) {
                        console.error('Failed to access camera.', error);
                        const name = typeof error?.name === 'string' ? error.name : '';
                        const code: VoiceCameraError =
                                name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'acquisition';
                        fail(code);
                        return;
                }

                if (!session || session.id !== currentSession.id) {
                        return;
                }

                const track = stream.getVideoTracks()[0] ?? null;
                if (!track) {
                        fail('acquisition');
                        return;
                }

                const pc = currentSession.pc ?? (await createPeerConnection(currentSession));
                if (!session || session.id !== currentSession.id) {
                        return;
                }
                if (!pc) {
                        fail('peer');
                        return;
                }

                const sender = ensureLocalVideoSender(currentSession, pc);
                if (!sender) {
                        fail('peer');
                        return;
                }

                if (currentSession.localVideoTransceiver) {
                        try {
                                currentSession.localVideoTransceiver.direction = 'sendrecv';
                        } catch {}
                }

                try {
                        if (typeof sender.setStreams === 'function') {
                                sender.setStreams(stream);
                        }
                } catch {}

                try {
                        await sender.replaceTrack(track);
                } catch (error) {
                        console.error('Failed to replace local video track.', error);
                        fail('peer');
                        return;
                }

                currentSession.localVideoStream = stream;
                const sessionId = currentSession.id;
                track.onended = () => {
                        if (!session || session.id !== sessionId) return;
                        stopLocalCamera(currentSession);
                        setState({ cameraEnabled: false, localVideoStream: null });
                };

                setState({ cameraEnabled: true, localVideoStream: stream, cameraError: null });
                stream = null;
        } finally {
                cleanup();
                finish();
        }
}

export async function toggleVoiceCamera(): Promise<void> {
        const current = get(state);
        await setVoiceCameraEnabled(!current.cameraEnabled);
}

export function setVoiceMuted(muted: boolean): void {
        const current = get(state);
        if (current.muted === muted) return;
        applyMuteState(session, muted);
        if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
                try {
                        session.ws.send(JSON.stringify({ op: 7, t: 505, d: { muted } }));
                } catch {}
        }
        setState({ muted });
        if (muted) {
                playVoiceOffSound('mute');
        } else {
                playVoiceOnSound('mute');
        }
}

export function toggleVoiceMuted(): void {
        const current = get(state);
        setVoiceMuted(!current.muted);
}

export function setVoiceDeafened(deafened: boolean): void {
        const current = get(state);
        if (current.deafened === deafened) return;
        setState({ deafened });
        if (deafened) {
                playVoiceOffSound('deafen');
        } else {
                playVoiceOnSound('deafen');
        }
}

export function toggleVoiceDeafened(): void {
        const current = get(state);
        setVoiceDeafened(!current.deafened);
}

export function setRemoteUserVolume(userId: string, volume: number): void {
        const normalized = toSnowflakeString(userId);
        if (!normalized) return;
        const numericVolume = Number(volume);
        const clamped = Math.max(0, Math.min(1, Number.isFinite(numericVolume) ? numericVolume : 1));
        const entry = ensureRemoteSettingsEntry(normalized);
        if (entry.volume === clamped) return;
        entry.volume = clamped;
        emitRemoteSettings();
}

export function setRemoteUserMuted(userId: string, muted: boolean): void {
        const normalized = toSnowflakeString(userId);
        if (!normalized) return;
        const entry = ensureRemoteSettingsEntry(normalized);
        const wasMuted = entry.muted;
        if (wasMuted === muted) {
                if (muted) {
                        setUserSpeaking(normalized, false);
                }
                return;
        }
        entry.muted = muted;
        emitRemoteSettings();
        if (muted) {
                setUserSpeaking(normalized, false);
        }
        if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
                const userLiteral = toNumericLiteral(normalized);
                if (userLiteral) {
                        try {
                                session.ws.send(
                                        `{"op":7,"t":506,"d":{"user":${userLiteral},"muted":${muted ? 'true' : 'false'}}}`
                                );
                        } catch {}
                }
        }
}

if (browser) {
        lastDeviceSettings = cloneDeviceSettings(get(appSettings).devices);
        appSettings.subscribe(($settings) => {
                const next = cloneDeviceSettings($settings.devices);
                const previous = lastDeviceSettings;
                lastDeviceSettings = next;
                deviceSettingsQueue = deviceSettingsQueue
                        .then(() => handleDeviceSettingsChange(previous, next))
                        .catch((error) => {
                                console.error('Failed to apply device settings update.', error);
                        });
        });

        auth.isAuthenticated.subscribe((ok) => {
                if (!ok) {
                        leaveVoiceChannel();
                }
        });
}
