import { browser } from '$app/environment';
import { writable, derived, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';

const noop = () => {};

export type VoiceConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type VoiceRemoteStream = {
        id: string;
        stream: MediaStream;
        userId: string | null;
};

type VoiceState = {
        status: VoiceConnectionStatus;
        guildId: string | null;
        channelId: string | null;
        error: string | null;
        muted: boolean;
        deafened: boolean;
        remoteStreams: VoiceRemoteStream[];
};

type VoiceSessionInternal = {
        id: number;
        guildId: string;
        channelId: string;
        ws: WebSocket | null;
        pc: RTCPeerConnection | null;
        localStream: MediaStream | null;
        remoteStreams: Map<string, MediaStream>;
        manualClose: boolean;
};

const initialState: VoiceState = {
        status: 'disconnected',
        guildId: null,
        channelId: null,
        error: null,
        muted: false,
        deafened: false,
        remoteStreams: []
};

const state = writable<VoiceState>(initialState);
export const voiceSession = derived(state, (value) => value);

let session: VoiceSessionInternal | null = null;
let sessionCounter = 0;

function toApiSnowflake(id: string): any {
        return BigInt(id) as any;
}

function toChannelLiteral(id: string): string {
        return String(id ?? '').replace(/[^0-9]/g, '');
}

function updateRemoteStreams(nextSession: VoiceSessionInternal | null) {
        const entries: VoiceRemoteStream[] = [];
        if (nextSession) {
                for (const [id, stream] of nextSession.remoteStreams.entries()) {
                        entries.push({
                                id,
                                stream,
                                userId: extractUserId(stream?.id ?? id)
                        });
                }
        }
        state.update((current) => ({ ...current, remoteStreams: entries }));
}

function extractUserId(streamId: string | null | undefined): string | null {
        if (!streamId) return null;
        if (streamId.startsWith('user-')) {
                const candidate = streamId.slice(5);
                if (/^[0-9]+$/.test(candidate)) {
                        return candidate;
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
                        setState({ status: 'error', error: options.error, guildId: null, channelId: null, remoteStreams: [] });
                } else {
                        setState({ status: 'disconnected', error: null, guildId: null, channelId: null, remoteStreams: [] });
                }
                return;
        }

        session = null;

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

        if (options.error) {
                        setState({ status: 'error', error: options.error, guildId: null, channelId: null, remoteStreams: [] });
        } else {
                        setState({ status: 'disconnected', error: null, guildId: null, channelId: null, remoteStreams: [] });
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
                for (const stream of event.streams) {
                        const key = stream.id || `${Date.now()}-${Math.random()}`;
                        currentSession.remoteStreams.set(key, stream);
                        stream.onremovetrack = () => {
                                currentSession.remoteStreams.delete(key);
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

        const channelLiteral = toChannelLiteral(normalizedChannel);
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
        setState({ status: 'connecting', guildId: normalizedGuild, channelId: normalizedChannel, error: null });

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
                        manualClose: false
                };

                session = currentSession;

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
                        remoteStreams: []
                });
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

if (browser) {
        auth.isAuthenticated.subscribe((ok) => {
                if (!ok) {
                        leaveVoiceChannel();
                }
        });
}
