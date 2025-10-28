<script lang="ts">
        import { onDestroy } from 'svelte';

        const props = $props<{
                stream: MediaStream | null;
                videoActive?: boolean;
                label: string;
                badge?: string | null;
                speaking?: boolean;
                avatarUrl?: string | null;
                initial?: string | null;
                variant?: 'primary' | 'thumbnail';
                interactive?: boolean;
                selected?: boolean;
        }>();

        const variant = $derived(props.variant ?? 'thumbnail');
        const interactive = $derived(Boolean(props.interactive));
        const selected = $derived(Boolean(props.selected));
        const speaking = $derived(Boolean(props.speaking));
        const videoEnabled = $derived(Boolean(props.videoActive && props.stream));

        const containerClass = $derived(() => {
                const classes = [
                        'relative overflow-hidden rounded-lg border border-[var(--stroke)] bg-black text-white'
                ];
                if (variant === 'thumbnail') {
                        classes.push('aspect-video');
                } else {
                        classes.push('flex h-full w-full items-center justify-center');
                }
                if (interactive) {
                        classes.push('cursor-pointer transition');
                }
                if (selected) {
                        classes.push('ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--bg)]');
                } else if (speaking) {
                        classes.push('ring-2 ring-emerald-400 ring-offset-2 ring-offset-[var(--bg)]');
                }
                return classes.join(' ');
        });

        const videoClass = $derived(() =>
                variant === 'primary' ? 'h-full w-full object-contain' : 'h-full w-full object-cover'
        );

        const avatarWrapperClass = $derived(() => {
                const classes = [
                        'flex items-center justify-center overflow-hidden rounded-full bg-[var(--panel)] text-[var(--fg-strong)]'
                ];
                if (variant === 'primary') {
                        classes.push('h-40 w-40 text-4xl font-semibold');
                } else {
                        classes.push('h-16 w-16 text-lg font-semibold');
                }
                return classes.join(' ');
        });

        let videoEl: HTMLVideoElement | null = $state(null);

        $effect(() => {
                if (!videoEl) return;
                if (!videoEnabled) {
                        try {
                                videoEl.pause();
                        } catch {}
                        videoEl.srcObject = null;
                        return;
                }
                const stream = props.stream;
                if (!stream) {
                        videoEl.srcObject = null;
                        return;
                }
                if (videoEl.srcObject !== stream) {
                        videoEl.srcObject = stream;
                }
                const playPromise = videoEl.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => {});
                }
        });

        onDestroy(() => {
                if (!videoEl) return;
                try {
                        videoEl.pause();
                } catch {}
                videoEl.srcObject = null;
        });

        function fallbackInitial(): string {
                if (props.initial && props.initial.trim()) {
                        return props.initial.trim().charAt(0).toUpperCase();
                }
                return props.label.trim().charAt(0).toUpperCase() || '?';
        }
</script>

<div class={containerClass}>
        {#if videoEnabled}
                <video bind:this={videoEl} class={videoClass} autoplay muted playsinline></video>
        {:else}
                <div class="flex h-full w-full flex-col items-center justify-center gap-3 bg-[var(--panel-strong)]">
                        <div class={avatarWrapperClass}>
                                {#if props.avatarUrl}
                                        <img src={props.avatarUrl} alt="" class="h-full w-full object-cover" />
                                {:else}
                                        <span>{fallbackInitial()}</span>
                                {/if}
                        </div>
                </div>
        {/if}
        <div
                class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-3 py-2 text-xs"
        >
                <span class="min-w-0 truncate">{props.label}</span>
                {#if props.badge}
                        <span class="text-[10px] tracking-wide uppercase opacity-70">{props.badge}</span>
                {/if}
        </div>
</div>
