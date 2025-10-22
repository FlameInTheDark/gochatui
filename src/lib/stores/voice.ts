import { browser } from '$app/environment';
import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { setSelfVoiceChannelId } from '$lib/stores/presence';

const noop = () => {};

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
        speakingUserIds: []
};

const state = writable<VoiceState>(initialState);
export const voiceSession = derived(state, (value) => value);

let session: VoiceSessionInternal | null = null;
let sessionCounter = 0;

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

function createAudioLevelMonitor(stream: MediaStream | null, userId: string | null): StreamMonitor | null {
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
                const threshold = 6;

                const update = () => {
                        if (disposed) return;
                        analyser.getByteTimeDomainData(data);
                        let sum = 0;
                        for (let i = 0; i < data.length; i += 1) {
                                sum += Math.abs(data[i] - 128);
                        }
                        const avg = sum / data.length;
                        const speaking = avg > threshold;
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
        const monitor = createAudioLevelMonitor(localStream, userId);
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

function setState(partial: Partial<VoiceState>) {
        state.update((current) => ({ ...current, ...partial }));
}

function clearSession(options: { error?: string | null; manual?: boolean } = {}) {
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
                                speakingUserIds: []
                        });
                } else {
                        setState({
                                status: 'disconnected',
                                error: null,
                                guildId: null,
                                channelId: null,
                                remoteStreams: [],
                                remoteSettings: {},
                                speakingUserIds: []
                        });
                }
                setSelfVoiceChannelId(null);
                return;
        }

        session = null;

        current.localMonitor?.stop();
        current.localMonitor = null;
        for (const monitor of current.remoteMonitors.values()) {
                monitor.stop();
        }
        current.remoteMonitors.clear();

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
                                speakingUserIds: []
                        });
        } else {
                        setState({
                                status: 'disconnected',
                                error: null,
                                guildId: null,
                                channelId: null,
                                remoteStreams: [],
                                remoteSettings: {},
                                speakingUserIds: []
                        });
        }
}

async function createPeerConnection(currentSession: VoiceSessionInternal) {
        if (!currentSession.ws) {
                throw new Error('Missing SFU socket');
        }

        const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        currentSession.pc = pc;

        pc.onicecandidate = (event) => {
                if (!event.candidate || !currentSession.ws) return;
                try {
                        currentSession.ws.send(
                                JSON.stringify({
                                        op: 7,
                                        t: 503,
                                        d: {
                                                candidate: event.candidate.candidate,
                                                sdpMid: event.candidate.sdpMid ?? undefined,
                                                sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined
                                        }
                                })
                        );
                } catch {}
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
                                const monitor = createAudioLevelMonitor(stream, userId);
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
                updateRemoteStreams(currentSession);
        };

        pc.onconnectionstatechange = () => {
                if (!session || session.id !== currentSession.id) return;
                const stateValue = pc.connectionState;
                if (stateValue === 'connected') {
                        setState({ status: 'connected', error: null });
                }
                if (stateValue === 'failed' || stateValue === 'disconnected' || stateValue === 'closed') {
                        if (!currentSession.manualClose) {
                                clearSession({ error: 'Voice connection lost.' });
                        }
                }
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

        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);

        try {
                currentSession.ws.send(
                        JSON.stringify({
                                op: 7,
                                t: 501,
                                d: { sdp: offer.sdp ?? '' }
                        })
                );
        } catch (error) {
                throw error instanceof Error ? error : new Error('Failed to send offer');
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

        const channelLiteral = toNumericLiteral(normalizedChannel);
        if (!channelLiteral) {
                setState({ status: 'error', error: 'Invalid channel identifier.', guildId: null, channelId: null });
                return;
        }

        if (session && session.guildId === normalizedGuild && session.channelId === normalizedChannel) {
                return;
        }

        if (session) {
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
                speakingUserIds: []
        });

        let localStream: MediaStream | null = null;
        try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
                localStream = null;
        }

        try {
                const response = await auth.api.guild.guildGuildIdVoiceChannelIdJoinPost({
                        guildId: toApiSnowflake(normalizedGuild),
                        channelId: toApiSnowflake(normalizedChannel)
                });
                const sfuUrl = response.data?.sfu_url ?? '';
                const token = response.data?.sfu_token ?? '';
                if (!sfuUrl || !token) {
                        throw new Error('SFU connection info missing');
                }

                const ws = new WebSocket(sfuUrl);

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
                        manualClose: false
                };

                session = currentSession;

                setSelfVoiceChannelId(normalizedChannel);
                startLocalMonitor(currentSession);

                ws.onopen = () => {
                        if (!session || session.id !== attemptId) return;
                        const joinPayload = `{"op":7,"t":500,"d":{"channel":${channelLiteral},"token":${JSON.stringify(token)}}}`;
                        try {
                                ws.send(joinPayload);
                        } catch (error) {
                                clearSession({ error: 'Failed to join SFU.' });
                        }
                };

                ws.onerror = () => {
                        if (!session || session.id !== attemptId) return;
                        clearSession({ error: 'SFU connection error.' });
                };

                ws.onclose = () => {
                        if (!session || session.id !== attemptId) return;
                        if (currentSession.manualClose) {
                                clearSession();
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
                        if (payload?.op === 7) {
                                if (payload?.t === 500) {
                                        if (payload?.d?.ok) {
                                                try {
                                                        await createPeerConnection(currentSession);
                                                } catch (error: any) {
                                                        clearSession({
                                                                error:
                                                                        error?.message ?? 'Failed to establish voice connection.'
                                                        });
                                                }
                                        } else {
                                                clearSession({ error: payload?.d?.error ?? 'SFU join rejected.' });
                                        }
                                } else if (payload?.t === 502) {
                                        try {
                                                const desc = new RTCSessionDescription({ type: 'answer', sdp: payload?.d?.sdp });
                                                await currentSession.pc?.setRemoteDescription(desc);
                                        } catch (error: any) {
                                                clearSession({
                                                        error: error?.message ?? 'Failed to apply SFU answer.'
                                                });
                                        }
                                } else if (payload?.t === 503) {
                                        if (payload?.d?.candidate) {
                                                try {
                                                        await currentSession.pc?.addIceCandidate(
                                                                new RTCIceCandidate({
                                                                        candidate: payload.d.candidate,
                                                                        sdpMid: payload.d.sdpMid ?? undefined,
                                                                        sdpMLineIndex: payload.d.sdpMLineIndex ?? undefined
                                                                })
                                                        );
                                                } catch {}
                                        }
                                } else if (payload?.t === 512) {
                                        clearSession({ error: 'Moved to another channel.' });
                                }
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
                        speakingUserIds: []
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
        clearSession();
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
}

export function toggleVoiceMuted(): void {
        const current = get(state);
        setVoiceMuted(!current.muted);
}

export function setVoiceDeafened(deafened: boolean): void {
        setState({ deafened });
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
        auth.isAuthenticated.subscribe((ok) => {
                if (!ok) {
                        leaveVoiceChannel();
                }
        });
}
