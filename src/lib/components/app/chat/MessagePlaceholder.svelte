<script lang="ts">
        const widths = ['w-3/5', 'w-4/5', 'w-2/3'];
</script>

<div class="flex gap-3 px-4 py-2" aria-hidden="true" role="presentation">
        <div class="skeleton h-10 w-10 shrink-0 rounded-full border border-[var(--stroke)] bg-[var(--panel-strong)]"></div>
        <div class="flex-1 space-y-2 py-1">
                <div class="skeleton h-3 w-28 rounded-full"></div>
                {#each widths as width, index}
                        <div class={`skeleton h-3 ${width} rounded-full`}></div>
                {/each}
        </div>
</div>

<style>
        .skeleton {
                position: relative;
                overflow: hidden;
                background-color: color-mix(in srgb, var(--panel-strong) 70%, transparent);
        }
        .skeleton::after {
                content: '';
                position: absolute;
                inset: 0;
                transform: translateX(-100%);
                background: linear-gradient(
                        120deg,
                        transparent 0%,
                        rgba(255, 255, 255, 0.2) 40%,
                        rgba(255, 255, 255, 0.25) 60%,
                        transparent 100%
                );
                animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
                100% {
                        transform: translateX(100%);
                }
        }
</style>
