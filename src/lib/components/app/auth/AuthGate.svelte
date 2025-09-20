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
        import { Check } from 'lucide-svelte';

        type AuthMode = 'login' | 'register' | 'register-success' | 'confirm' | 'recovery' | 'reset';

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
        let registerEmail = $state<string | null>(null);

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
                                        <button
                                                class="underline"
                                                type="button"
                                                onclick={() => {
                                                        registerEmail = null;
                                                        mode = 'register';
                                                }}
                                        >
                                                {m.auth_create_account()}
                                        </button>
                                        <button
                                                class="underline"
                                                type="button"
                                                onclick={() => (mode = 'recovery')}
                                        >
                                                {m.auth_forgot()}
                                        </button>
                                </div>
                                <div class="mt-2 space-x-1 text-xs text-[var(--muted)]">
                                        <span>Or</span>
                                        <button
                                                class="underline"
                                                type="button"
                                                onclick={() => (mode = 'confirm')}
                                        >
                                                {m.auth_confirm_word()}
                                        </button>
                                        <span>/</span>
                                        <button
                                                class="underline"
                                                type="button"
                                                onclick={() => (mode = 'reset')}
                                        >
                                                {m.auth_reset_word()}
                                        </button>
                                        <span>{m.auth_with_token()}</span>
                                </div>
                        {:else if mode === 'register'}
                                <RegisterForm
                                        on:sent={(event) => {
                                                registerEmail = event.detail.email;
                                                mode = 'register-success';
                                        }}
                                />
                                <div class="mt-3 text-sm text-[var(--muted)]">
                                        <button
                                                class="underline"
                                                type="button"
                                                onclick={() => (mode = 'login')}
                                        >
                                                {m.auth_back_to_sign_in()}
                                        </button>
                                </div>
                        {:else if mode === 'register-success'}
                                <div class="space-y-6 text-center">
                                <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[var(--brand)] text-[var(--brand)]">
                                                <Check class="h-8 w-8" stroke-width={2} />
                                        </div>
                                        <div class="space-y-2">
                                                <div class="text-xl font-semibold text-[var(--fg-strong)]">
                                                        {m.auth_registration_success_title()}
                                                </div>
                                                <p class="text-sm text-[var(--muted)]">
                                                        {m.auth_registration_success_message()}
                                                </p>
                                                {#if registerEmail}
                                                        <p class="text-sm font-medium text-[var(--fg)]">
                                                                {m.auth_registration_success_sent_to({ email: registerEmail })}
                                                        </p>
                                                {/if}
                                        </div>
                                        <button
                                                class="w-full rounded-md bg-[var(--brand)] py-2 font-medium text-[var(--bg)]"
                                                type="button"
                                                onclick={() => {
                                                        mode = 'login';
                                                        registerEmail = null;
                                                }}
                                        >
                                                {m.auth_back_to_sign_in()}
                                        </button>
                                        <div class="text-xs text-[var(--muted)]">
                                                <button
                                                        class="underline"
                                                        type="button"
                                                        onclick={() => {
                                                                registerEmail = null;
                                                                mode = 'register';
                                                        }}
                                                >
                                                        {m.auth_register_again()}
                                                </button>
                                        </div>
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
