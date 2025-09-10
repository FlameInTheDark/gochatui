<script lang="ts">
  import LoginForm from './LoginForm.svelte';
  import RegisterForm from './RegisterForm.svelte';
  import ConfirmForm from './ConfirmForm.svelte';
  import RecoveryForm from './RecoveryForm.svelte';
  import ResetForm from './ResetForm.svelte';
  import { auth } from '$lib/stores/auth';
  import { onMount } from 'svelte';

  let mode: 'login' | 'register' | 'confirm' | 'recovery' | 'reset' = 'login';
  let { children } = $props<{ children?: () => any }>();

  const isAuthenticated = auth.isAuthenticated;

  onMount(() => {
    // try to preload guilds if already authenticated
    auth.loadGuilds().catch(() => {});
  });
</script>

{#if $isAuthenticated}
  {@render children?.()}
{:else}
  <div class="h-screen w-screen grid place-items-center p-4">
    <div class="panel w-full max-w-md p-6">
      {#if mode === 'login'}
        <LoginForm on:success={() => (mode = 'login')}/>
        <div class="mt-3 text-sm flex justify-between text-[var(--muted)]">
          <button class="underline" on:click={() => (mode = 'register')}>Create account</button>
          <button class="underline" on:click={() => (mode = 'recovery')}>Forgot?</button>
        </div>
        <div class="mt-2 text-xs text-[var(--muted)]">
          Or <button class="underline" on:click={() => (mode = 'confirm')}>confirm</button> / <button class="underline" on:click={() => (mode = 'reset')}>reset</button> with token
        </div>
      {:else if mode === 'register'}
        <RegisterForm on:sent={() => (mode = 'confirm')}/>
        <div class="mt-3 text-sm text-[var(--muted)]"><button class="underline" on:click={() => (mode = 'login')}>Back to sign in</button></div>
      {:else if mode === 'confirm'}
        <ConfirmForm on:success={() => (mode = 'login')}/>
        <div class="mt-3 text-sm text-[var(--muted)]"><button class="underline" on:click={() => (mode = 'login')}>Back to sign in</button></div>
      {:else if mode === 'recovery'}
        <RecoveryForm/>
        <div class="mt-3 text-sm text-[var(--muted)]"><button class="underline" on:click={() => (mode = 'login')}>Back to sign in</button></div>
      {:else if mode === 'reset'}
        <ResetForm/>
        <div class="mt-3 text-sm text-[var(--muted)]"><button class="underline" on:click={() => (mode = 'login')}>Back to sign in</button></div>
      {/if}
    </div>
  </div>
{/if}
