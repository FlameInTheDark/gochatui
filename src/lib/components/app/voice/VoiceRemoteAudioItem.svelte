<script lang="ts">
        import { onDestroy } from 'svelte';

        const props = $props<{ stream: MediaStream; deafened: boolean; volume?: number; muted?: boolean }>();
        let audioEl: HTMLAudioElement | null = null;

        function applyStream(stream: MediaStream) {
                if (!audioEl) return;
                if (audioEl.srcObject !== stream) {
                        audioEl.srcObject = stream;
                }
                const playPromise = audioEl.play();
                if (playPromise) {
                        void playPromise.catch(() => {});
                }
        }

        function normalizedVolume(value: number | undefined): number {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return 1;
                return Math.max(0, Math.min(1, numeric));
        }

        function applyAudioState({
                deafened,
                muted,
                volume
        }: {
                deafened: boolean;
                muted: boolean | undefined;
                volume: number | undefined;
        }) {
                if (!audioEl) return;
                const clamped = normalizedVolume(volume);
                const shouldMute = deafened || Boolean(muted) || clamped === 0;
                audioEl.muted = shouldMute;
                audioEl.volume = shouldMute ? 0 : clamped;
        }

        $effect(() => {
                applyStream(props.stream);
        });

        $effect(() => {
                applyAudioState({
                        deafened: props.deafened,
                        muted: props.muted,
                        volume: props.volume
                });
        });

        onDestroy(() => {
                if (!audioEl) return;
                audioEl.pause();
                audioEl.srcObject = null;
        });
</script>

<audio bind:this={audioEl} autoplay playsinline></audio>
