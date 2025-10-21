<script lang="ts">
        import { onDestroy } from 'svelte';

        let { stream, deafened }: { stream: MediaStream; deafened: boolean } = $props();
        let audioEl: HTMLAudioElement | null = null;

        function applyStream() {
                if (!audioEl) return;
                if (audioEl.srcObject !== stream) {
                        audioEl.srcObject = stream;
                }
                const playPromise = audioEl.play();
                if (playPromise) {
                        void playPromise.catch(() => {});
                }
        }

        function applyDeafen() {
                if (!audioEl) return;
                audioEl.muted = deafened;
                audioEl.volume = deafened ? 0 : 1;
        }

        $effect(() => {
                applyStream();
        });

        $effect(() => {
                applyDeafen();
        });

        onDestroy(() => {
                if (!audioEl) return;
                audioEl.pause();
                audioEl.srcObject = null;
        });
</script>

<audio bind:this={audioEl} autoplay playsinline></audio>
