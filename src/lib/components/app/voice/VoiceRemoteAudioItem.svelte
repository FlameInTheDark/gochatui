<script lang="ts">
        import { onDestroy } from 'svelte';

        const props = $props<{
                stream: MediaStream;
                deafened: boolean;
                volume?: number;
                muted?: boolean;
                outputLevel?: number;
                outputDeviceId?: string | null;
        }>();

        let audioEl: HTMLAudioElement | null = null;
        let gainNode: GainNode | null = null;
        let sourceNode: MediaStreamAudioSourceNode | null = null;
        let destinationNode: MediaStreamAudioDestinationNode | null = null;
        let usingAudioGraph = false;
        let currentStream: MediaStream | null = null;
        let sinkErrorLogged = false;

        const sinkIdSupported =
                typeof HTMLMediaElement !== 'undefined' &&
                typeof HTMLMediaElement.prototype.setSinkId === 'function';

        function getSharedAudioContext(): AudioContext | null {
                if (typeof window === 'undefined') return null;
                const globalObj = window as any;
                const ctor: any = globalObj.AudioContext ?? globalObj.webkitAudioContext;
                if (!ctor) return null;
                const key = '__gochat_voice_shared_audio_context';
                let context: AudioContext | null = globalObj[key] ?? null;
                if (!context) {
                        try {
                                context = new ctor();
                                globalObj[key] = context;
                        } catch {
                                globalObj[key] = null;
                                return null;
                        }
                }
                if (context && typeof context.resume === 'function') {
                        context.resume().catch(() => {});
                }
                return context;
        }

        function teardownAudioGraph() {
                if (sourceNode) {
                        try {
                                sourceNode.disconnect();
                        } catch {}
                        sourceNode = null;
                }
                if (gainNode) {
                        try {
                                gainNode.disconnect();
                        } catch {}
                        gainNode = null;
                }
                destinationNode = null;
                usingAudioGraph = false;
        }

        function ensurePlayback() {
                if (!audioEl) return;
                const playPromise = audioEl.play();
                if (playPromise) {
                        void playPromise.catch(() => {});
                }
        }

        function ensurePipeline(stream: MediaStream, requireBoost: boolean) {
                if (!audioEl) return;

                if (requireBoost) {
                        const context = getSharedAudioContext();
                        if (!context) {
                                if (audioEl.srcObject !== stream) {
                                        audioEl.srcObject = stream;
                                }
                                usingAudioGraph = false;
                                currentStream = stream;
                                return;
                        }
                        if (!usingAudioGraph || currentStream !== stream) {
                                teardownAudioGraph();
                                try {
                                        sourceNode = context.createMediaStreamSource(stream);
                                        gainNode = context.createGain();
                                        destinationNode = context.createMediaStreamDestination();
                                        sourceNode.connect(gainNode);
                                        gainNode.connect(destinationNode);
                                        usingAudioGraph = true;
                                        currentStream = stream;
                                        audioEl.srcObject = destinationNode.stream;
                                        context.resume().catch(() => {});
                                } catch {
                                        teardownAudioGraph();
                                        usingAudioGraph = false;
                                        currentStream = stream;
                                        if (audioEl.srcObject !== stream) {
                                                audioEl.srcObject = stream;
                                        }
                                }
                        }
                } else {
                        if (usingAudioGraph) {
                                teardownAudioGraph();
                        }
                        if (audioEl.srcObject !== stream) {
                                audioEl.srcObject = stream;
                        }
                        currentStream = stream;
                }
        }

        function normalizedVolume(value: number | undefined): number {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return 1;
                return Math.max(0, Math.min(1, numeric));
        }

        function normalizedOutputLevel(value: number | undefined): number {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return 1;
                return Math.max(0, Math.min(1.5, numeric));
        }

        function updateAudioPlayback() {
                if (!audioEl) return;
                const activeStream = props.stream;
                if (!activeStream) return;

                const baseVolume = normalizedVolume(props.volume);
                const outputMultiplier = normalizedOutputLevel(props.outputLevel);
                const effectiveVolume = baseVolume * outputMultiplier;
                const shouldMute = props.deafened || Boolean(props.muted) || effectiveVolume <= 0;
                const requiresBoost = !shouldMute && outputMultiplier > 1 + 1e-3;

                ensurePipeline(activeStream, requiresBoost);

                audioEl.muted = shouldMute;
                if (shouldMute) {
                        if (usingAudioGraph && gainNode) {
                                gainNode.gain.value = 0;
                        }
                        audioEl.volume = 0;
                } else if (usingAudioGraph && gainNode) {
                        const boosted = Math.max(0, Math.min(1.5, effectiveVolume));
                        gainNode.gain.value = boosted;
                        audioEl.volume = 1;
                } else {
                        const clamped = Math.max(0, Math.min(1, effectiveVolume));
                        audioEl.volume = clamped;
                }

                ensurePlayback();
        }

        async function applySink(deviceId: string | null) {
                if (!audioEl || !sinkIdSupported) return;
                if (!audioEl.isConnected) return;
                const target = deviceId && deviceId.length ? deviceId : 'default';
                let currentSink: string | undefined;
                try {
                        currentSink = (audioEl as any).sinkId;
                } catch {}
                if (currentSink === target) return;
                try {
                        await audioEl.setSinkId(target);
                        sinkErrorLogged = false;
                        return;
                } catch (error) {
                        if (target !== 'default') {
                                try {
                                        await audioEl.setSinkId('default');
                                } catch {}
                        }
                        if (!sinkErrorLogged) {
                                const isAbortError =
                                        error instanceof DOMException && error.name === 'AbortError';
                                const message = isAbortError
                                        ? 'Audio output device became unavailable. Falling back to default sink.'
                                        : 'Failed to set audio output device.';
                                console.error(message, error);
                                sinkErrorLogged = true;
                        }
                }
        }

        $effect(() => {
                updateAudioPlayback();
        });

        $effect(() => {
                void applySink(props.outputDeviceId ?? null);
        });

        onDestroy(() => {
                teardownAudioGraph();
                currentStream = null;
                if (audioEl) {
                        audioEl.pause();
                        audioEl.srcObject = null;
                }
        });
</script>

<audio bind:this={audioEl} autoplay playsinline></audio>
