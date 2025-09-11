<script lang="ts">
  import { contextMenu } from '$lib/stores/contextMenu';
  import type { ContextMenuItem } from '$lib/stores/contextMenu';
  import { tick } from 'svelte';

  let menuEl: HTMLDivElement | null = null;
  let posX = 0;
  let posY = 0;

  function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

  async function updatePosition() {
    if (typeof window === 'undefined') return;
    await tick();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = menuEl ? menuEl.getBoundingClientRect() : ({ width: 220, height: 200 } as any);
    posX = clamp(($contextMenu as any).x, pad, vw - rect.width - pad);
    posY = clamp(($contextMenu as any).y, pad, vh - rect.height - pad);
  }

  function onGlobalKey(e: KeyboardEvent) {
    if (e.key === 'Escape') contextMenu.close();
  }

  // Re-clamp position whenever menu opens or its target coords change
  $: (async () => {
    const cm = $contextMenu as any;
    if (cm?.open) {
      await updatePosition();
    }
  })();
</script>

<svelte:window on:keydown={onGlobalKey} on:click={() => contextMenu.close()} on:resize={updatePosition} />

{#if $contextMenu.open}
  <div class="fixed inset-0 z-[1000] pointer-events-none">
    <div bind:this={menuEl} class="absolute pointer-events-auto" style={`left:${posX}px; top:${posY}px`} on:click|stopPropagation on:contextmenu|stopPropagation>
      <div class="backdrop-blur-md rounded-lg">
        <div class="panel min-w-[200px] max-w-[260px] rounded-md p-1">
          {#each $contextMenu.items as it}
            <button class={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--panel)] ${it.danger ? 'text-red-400' : ''} ${it.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={it.disabled}
                    on:click={() => { contextMenu.close(); Promise.resolve().then(it.action); }}>
              {it.label}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
