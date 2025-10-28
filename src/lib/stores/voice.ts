import { browser } from '$app/environment';
import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { setSelfVoiceChannelId } from '$lib/stores/presence';
import { appSettings, cloneDeviceSettings, type DeviceSettings } from '$lib/stores/settings';
import { analyzeTimeDomainLevel, clampNormalized } from '$lib/utils/audio';
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
};

type VoiceSessionInternal = {
        id: number;
        guildId: string;
        channelId: string;
        ws: WebSocket | null;
        pc: RTCPeerConnection | null;
        localStream: MediaStream | null;
        remoteStreams: Map<string, MediaStream>;
        remoteMonitors: Map<string, StreamMonitor>;
        localMonitor: StreamMonitor | null;
        manualClose: boolean;
        pingInterval: ReturnType<typeof setInterval> | null;
        pendingPings: Map<string, number>;
        pendingLocalCandidates: RTCIceCandidateInit[];
        pendingRemoteCandidates: RTCIceCandidateInit[];
        processingRemoteOffer: boolean;
        lastRemoteOfferSdp: string | null;
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
        latencyMs: null
};

const state = writable<VoiceState>(initialState);
export const voiceSession = derived(state, (value) => value);

let session: VoiceSessionInternal | null = null;
let sessionCounter = 0;
let pingCounter = 0;

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

        applyGainToTrack(newTrack, settings.audioInputLevel);

        const previousStream = activeSession.localStream;
        activeSession.localStream = newStream;
        startLocalMonitor(activeSession);

        if (!session || session.id !== sessionId) {
                stopStream(newStream);
                return;
        }

        if (activeSession.pc) {
                const sender = activeSession.pc.getSenders().find((item) => item.track?.kind === 'audio');
                if (sender) {
                        try {
                                await sender.replaceTrack(newTrack);
                        } catch (error) {
                                console.error('Failed to replace audio track on peer connection.', error);
                        }
                } else {
                        try {
                                activeSession.pc.addTrack(newTrack, newStream);
                        } catch (error) {
                                console.error('Failed to attach audio track to peer connection.', error);
                        }
                }
        }

        applyMuteState(newStream, get(state).muted);

        if (session && session.id === sessionId) {
                stopStream(previousStream);
        } else {
                stopStream(newStream);
        }
}

function applyLocalInputGain(settings: DeviceSettings) {
        const activeSession = session;
        if (!activeSession) return;
        const track = activeSession.localStream?.getAudioTracks()[0] ?? null;
        applyGainToTrack(track, settings.audioInputLevel);
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

function normalizedMonitorThreshold(value: number | null | undefined): number {
        if (!Number.isFinite(value)) return REMOTE_SPEAKING_THRESHOLD;
        return clampNormalized(Number(value));
}

function createAudioLevelMonitor(
        stream: MediaStream | null,
        userId: string | null,
        options?: { levelMultiplier?: number; threshold?: number }
): StreamMonitor | null {
        if (!browser) return null;
        if (!stream || !userId) return null;
        if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
        if (stream.getAudioTracks().length === 0) return null;
        try {
                const audioContext = new AudioContext();
                const source = audioContext.createMediaStreamSource(stream);
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 512;
                const data = new Uint8Array(analyser.fftSize);
                let raf = 0;
                let disposed = false;
                let lastSpeaking = false;
                const levelMultiplier = clamp(
                        Number.isFinite(options?.levelMultiplier) ? Number(options?.levelMultiplier) : 1,
                        0,
                        4
                );
                const threshold = normalizedMonitorThreshold(options?.threshold);
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
                                audioContext.close().catch(() => {});
                        }
                };
        } catch {
                return null;
        }
}

function startLocalMonitor(currentSession: VoiceSessionInternal) {
        currentSession.localMonitor?.stop();
        const localStream = currentSession.localStream;
        if (!localStream) {
                currentSession.localMonitor = null;
                return;
        }
        const me = get(auth.user);
        const userId = toSnowflakeString((me as any)?.id);
        if (!userId) {
                currentSession.localMonitor = null;
                return;
        }
        const monitor = createAudioLevelMonitor(localStream, userId, {
                levelMultiplier: lastDeviceSettings.audioInputLevel,
                threshold: lastDeviceSettings.audioInputThreshold
        });
        currentSession.localMonitor = monitor;
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
                        const userId = extractUserId(stream?.id ?? null, id, ...trackHints);
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

function applyMuteState(localStream: MediaStream | null, muted: boolean) {
        if (!localStream) return;
        for (const track of localStream.getAudioTracks()) {
                track.enabled = !muted;
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
                                latencyMs: null
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
                                latencyMs: null
                        });
                }
                setSelfVoiceChannelId(null);
                return;
        }

        session = null;

        stopLatencyProbe(current);

        current.localMonitor?.stop();
        current.localMonitor = null;
        for (const monitor of current.remoteMonitors.values()) {
                monitor.stop();
        }
        current.remoteMonitors.clear();

        current.pendingLocalCandidates = [];
        current.pendingRemoteCandidates = [];
        current.lastRemoteOfferSdp = null;

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
                                latencyMs: null
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
                                latencyMs: null
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
                for (const stream of event.streams) {
                        const streamId = stream.id || '';
                        const keySource = streamId || trackId || `${Date.now()}-${Math.random()}`;
                        const key = trackId ? `${keySource}:${trackId}` : keySource;
                        currentSession.remoteStreams.set(key, stream);
                        const trackHints: string[] = [];
                        for (const track of stream.getTracks()) {
                                if (track?.id) trackHints.push(track.id);
                                if (track?.label) trackHints.push(track.label);
                        }
                        const userId = extractUserId(streamId, trackId, event.track?.label, key, ...trackHints);
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
                                currentSession.remoteStreams.delete(key);
                                const monitor = currentSession.remoteMonitors.get(key);
                                if (monitor) {
                                        monitor.stop();
                                        currentSession.remoteMonitors.delete(key);
                                }
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
        if (currentSession.localStream) {
                for (const track of currentSession.localStream.getTracks()) {
                        try {
                                pc.addTrack(track, currentSession.localStream);
                        } catch {}
                }
                applyMuteState(currentSession.localStream, currentState.muted);
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
                latencyMs: null
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

        if (localStream) {
                const track = localStream.getAudioTracks()[0] ?? null;
                applyGainToTrack(track, deviceSnapshot.audioInputLevel);
                logVoice('applied local input gain', {
                        sessionId: attemptId,
                        trackPresent: Boolean(track)
                });
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
                        remoteStreams: new Map(),
                        remoteMonitors: new Map(),
                        localMonitor: null,
                        manualClose: false,
                        pingInterval: null,
                        pendingPings: new Map(),
                        pendingLocalCandidates: [],
                        pendingRemoteCandidates: [],
                        processingRemoteOffer: false,
                        lastRemoteOfferSdp: null
                };

                session = currentSession;

                logVoice('voice session created', {
                        sessionId: currentSession.id,
                        guildId: currentSession.guildId,
                        channelId: currentSession.channelId,
                        hasLocalStream: Boolean(localStream)
                });

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
                        applyMuteState(null, get(state).muted);
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

export function setVoiceMuted(muted: boolean): void {
        const current = get(state);
        if (current.muted === muted) return;
        applyMuteState(session?.localStream ?? null, muted);
        if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
                try {
                        session.ws.send(JSON.stringify({ op: 7, t: 505, d: { muted } }));
                } catch {}
        }
        setState({ muted });
        if (muted) {
                playVoiceOffSound();
        } else {
                playVoiceOnSound();
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
                playVoiceOffSound();
        } else {
                playVoiceOnSound();
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
