<script lang="ts">
        import LoginForm from './LoginForm.svelte';
        import RegisterForm from './RegisterForm.svelte';
        import ConfirmForm from './ConfirmForm.svelte';
        import RecoveryForm from './RecoveryForm.svelte';
        import ResetForm from './ResetForm.svelte';
        import { auth } from '$lib/stores/auth';
        import { browser } from '$app/environment';
        import { goto } from '$app/navigation';
        import { onMount } from 'svelte';
        import { m } from '$lib/paraglide/messages.js';

        type AuthMode = 'login' | 'register' | 'confirm' | 'recovery' | 'reset';

        type ConfirmDefaults = {
                id?: string;
                token?: string;
                name?: string;
                discriminator?: string;
                password?: string;
        };

        type ResetDefaults = {
                id?: string;
                token?: string;
        };

        let {
                children,
                initialMode = 'login',
                confirmDefaults,
                resetDefaults,
                forceAuthFlow = false,
                redirectTo
        } = $props<{
                children?: () => any;
                initialMode?: AuthMode;
                confirmDefaults?: ConfirmDefaults;
                resetDefaults?: ResetDefaults;
                forceAuthFlow?: boolean;
                redirectTo?: string;
        }>();

        let mode = $state<AuthMode>(initialMode);

        const isAuthenticated = auth.isAuthenticated;

        onMount(() => {
                // try to preload guilds if already authenticated
                auth.loadGuilds().catch(() => {});
        });

        $effect(() => {
                if (!redirectTo || !browser) return;
                if ($isAuthenticated) goto(redirectTo);
        });
</script>

{#if $isAuthenticated && !forceAuthFlow}
        {@render children?.()}
{:else}
        <div class="grid h-screen w-screen place-items-center p-4">
                <div class="panel w-full max-w-md p-6">
                        {#if mode === 'login'}
                                <LoginForm on:success={() => (mode = 'login')} />
                                <div class="mt-3 flex justify-between text-sm text-[var(--muted)]">
                                        <button class="underline" onclick={() => (mode = 'register')}
                                                >{m.auth_create_account()}</button
                                        >
                                        <button class="underline" onclick={() => (mode = 'recovery')}>{m.auth_forgot()}</button>
                                </div>
                                <div class="mt-2 text-xs text-[var(--muted)]">
                                        Or <button class="underline" onclick={() => (mode = 'confirm')}
                                                >{m.auth_confirm_word()}</button
                                        >
                                        /
                                        <button class="underline" onclick={() => (mode = 'reset')}>{m.auth_reset_word()}</button
                                        >
                                        {m.auth_with_token()}
                                </div>
                        {:else if mode === 'register'}
                                <RegisterForm on:sent={() => (mode = 'confirm')} />
                                <div class="mt-3 text-sm text-[var(--muted)]">
                                        <button class="underline" onclick={() => (mode = 'login')}
                                                >{m.auth_back_to_sign_in()}</button
                                        >
                                </div>
                        {:else if mode === 'confirm'}
                                <ConfirmForm
                                        defaults={confirmDefaults}
                                        on:success={() => (mode = 'login')}
                                />
                                <div class="mt-3 text-sm text-[var(--muted)]">
                                        <button class="underline" onclick={() => (mode = 'login')}
                                                >{m.auth_back_to_sign_in()}</button
                                        >
                                </div>
                        {:else if mode === 'recovery'}
                                <RecoveryForm />
                                <div class="mt-3 text-sm text-[var(--muted)]">
                                        <button class="underline" onclick={() => (mode = 'login')}
                                                >{m.auth_back_to_sign_in()}</button
                                        >
                                </div>
                        {:else if mode === 'reset'}
                                <ResetForm defaults={resetDefaults} />
                                <div class="mt-3 text-sm text-[var(--muted)]">
                                        <button class="underline" onclick={() => (mode = 'login')}
                                                >{m.auth_back_to_sign_in()}</button
                                        >
                                </div>
                        {/if}
                </div>
        </div>
{/if}
