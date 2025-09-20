<script lang="ts">
        import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
        import type { PageData } from './$types';
        import { browser } from '$app/environment';
        import { onDestroy } from 'svelte';
        import type { DtoInvitePreview } from '$lib/api';

        let { data } = $props<{ data: PageData }>();

        type InviteState = 'ok' | 'not-found' | 'error';

        let invite = $state<DtoInvitePreview | null>(data.invite ?? null);
        let inviteCodeValue = $state<string>(data.inviteCode ?? '');
        let inviteState = $state<InviteState>((data.inviteState ?? 'error') as InviteState);

        const compactNumber = new Intl.NumberFormat(undefined, {
                notation: 'compact',
                maximumFractionDigits: 1
        });
        const standardNumber = new Intl.NumberFormat(undefined, {
                maximumFractionDigits: 0
        });
        const dateTime = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short'
        });

        function formatMemberCount(count: number | null): string {
                if (count == null) return 'Member count unavailable';
                if (count === 0) return 'No members yet';
                if (count === 1) return '1 member';
                if (count < 1000) return `${standardNumber.format(count)} members`;
                return `${compactNumber.format(count)} members`;
        }

        function createMemberDescription(count: number | null): string {
                if (count == null) return 'Sign in or create an account to continue.';
                if (count === 0) return 'Be the first to start the conversation.';
                if (count === 1) return 'One person is already inside — come say hi!';
                if (count < 10) return `${standardNumber.format(count)} members are ready to welcome you.`;
                if (count < 1000) return `Join ${standardNumber.format(count)} members collaborating in this space.`;
                return `Join ${compactNumber.format(count)} members collaborating in this space.`;
        }

        function formatDate(value: string | null | undefined): string | null {
                if (!value) return null;
                const parsed = new Date(value);
                if (Number.isNaN(parsed.getTime())) return null;
                return dateTime.format(parsed);
        }


        function getDisplayName(current: DtoInvitePreview | null): string {
                return current?.guild?.name?.trim() || 'GoChat community';
        }

        function getMemberCount(current: DtoInvitePreview | null): number | null {
                return current?.members_count ?? null;
        }

        function getMemberCountLabel(current: DtoInvitePreview | null): string {
                return formatMemberCount(getMemberCount(current));
        }

        function getMemberDescription(current: DtoInvitePreview | null): string {
                return createMemberDescription(getMemberCount(current));
        }

        function getCreatedLabel(current: DtoInvitePreview | null): string {
                return formatDate(current?.created_at) ?? 'Created recently';
        }

        function isInviteExpired(current: DtoInvitePreview | null): boolean {
                if (!current?.expires_at) return false;
                const parsed = new Date(current.expires_at);
                return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
        }

        function getInviteStatusLabel(state: InviteState, current: DtoInvitePreview | null): string {
                if (state === 'not-found') return 'Unavailable';
                if (state === 'error') return 'Status unknown';
                return isInviteExpired(current) ? 'Expired' : 'Active';
        }

        function getInviteStatusDescriptor(state: InviteState, current: DtoInvitePreview | null): string {
                if (state === 'not-found') return 'This invite could not be found or has been revoked.';
                if (state === 'error') return 'Unable to verify the invite status right now.';
                if (!current?.expires_at) return 'No expiration date';
                const formatted = formatDate(current.expires_at);
                if (!formatted) return 'Expiration unknown';
                return isInviteExpired(current) ? `Expired on ${formatted}` : `Expires on ${formatted}`;
        }

        function getStatusTone(state: InviteState, current: DtoInvitePreview | null): 'success' | 'danger' | 'warning' {
                if (state === 'ok') {
                        return isInviteExpired(current) ? 'danger' : 'success';
                }
                return state === 'not-found' ? 'danger' : 'warning';
        }

        function getInviteUnavailableMessage(state: InviteState): string | null {
                if (state === 'ok') return null;
                if (state === 'not-found') return 'This invite is no longer available or may have expired.';
                return 'We were unable to load the invite details. Please try again or contact the guild owner.';
        }

        function getHeadTitle(current: DtoInvitePreview | null): string {
                return current?.guild?.name ? `Join ${current.guild.name} on GoChat` : 'Join this GoChat community';
        }

        let copyStatus = $state<'idle' | 'copied' | 'error'>('idle');
        let copyTimer: ReturnType<typeof setTimeout> | null = null;

        async function copyCode() {
                if (!inviteCodeValue || !browser) return;
                try {
                        await navigator.clipboard.writeText(inviteCodeValue);
                        copyStatus = 'copied';
                } catch (error) {
                        console.error('Failed to copy invite code', error);
                        copyStatus = 'error';
                }

                if (copyTimer) clearTimeout(copyTimer);
                copyTimer = setTimeout(() => {
                        copyStatus = 'idle';
                }, 2400);
        }

        onDestroy(() => {
                if (copyTimer) clearTimeout(copyTimer);
        });

        $effect(() => {
                invite = (data.invite ?? null) as DtoInvitePreview | null;
                inviteCodeValue = data.inviteCode ?? '';
                inviteState = (data.inviteState ?? 'error') as InviteState;
        });

        $effect(() => {
                inviteCodeValue;
                copyStatus = 'idle';
                if (copyTimer) {
                        clearTimeout(copyTimer);
                        copyTimer = null;
                }
        });
</script>

<svelte:head>
        <title>{getHeadTitle(invite)}</title>
</svelte:head>

<div class="invite-page">
        <div class="invite-page__background" aria-hidden="true">
                <span class="invite-page__gradient invite-page__gradient--one"></span>
                <span class="invite-page__gradient invite-page__gradient--two"></span>
                <span class="invite-page__grid"></span>
        </div>

        <header class="invite-page__header">
                <a class="invite-page__brand" href="/">
                        <span class="invite-page__brand-mark" aria-hidden="true">
                                <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                        <path
                                                d="M9 15.5c0-4.418 3.134-8 7-8h4c3.866 0 7 3.582 7 8 0 2.53-1.142 4.79-2.893 6.23-.42.343-.638.875-.582 1.42l.238 2.29c.132 1.264-1.23 2.105-2.265 1.373l-2.908-2.063a1.5 1.5 0 0 0-1.708 0l-2.907 2.063c-1.036.732-2.397-.109-2.265-1.373l.238-2.29c.056-.545-.162-1.077-.582-1.42C10.142 20.29 9 18.03 9 15.5Z"
                                        />
                                </svg>
                        </span>
                        <span class="invite-page__brand-text">
                                <span class="invite-page__brand-title">GoChat</span>
                                <span class="invite-page__brand-subtitle">Community invite</span>
                        </span>
                </a>
                <a class="invite-page__header-link" href="/app">
                        <span>Open app</span>
                        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path d="M11.172 5H6a1 1 0 1 1 0-2h8a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V7.414l-6.293 6.293a1 1 0 0 1-1.414-1.414L11.172 5Z" />
                        </svg>
                </a>
        </header>

        <main class="invite-page__content">
                <section class="invite-card" aria-labelledby="guild-title">
                        <div class="invite-card__badge">Exclusive invite</div>
                        <h1 id="guild-title" class="invite-card__title">{getDisplayName(invite)}</h1>
                        <p class="invite-card__description">{getMemberDescription(invite)}</p>

                        {#if getInviteUnavailableMessage(inviteState)}
                                <div class="invite-card__alert" role="status">
                                        <span class="invite-card__alert-icon" aria-hidden="true">
                                                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                        <path
                                                                fill-rule="evenodd"
                                                                d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.596c.75 1.335-.213 3.005-1.742 3.005H3.48c-1.53 0-2.493-1.67-1.743-3.005L8.257 3.1ZM11 14a1 1 0 1 0-2 0 1 1 0 0 0 2 0Zm-.25-6.75a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0v-4Z"
                                                                clip-rule="evenodd"
                                                        />
                                                </svg>
                                        </span>
                                        <div class="invite-card__alert-body">
                                                <p class="invite-card__alert-title">Invite unavailable</p>
                                                <p class="invite-card__alert-text">{getInviteUnavailableMessage(inviteState)}</p>
                                        </div>
                                </div>
                        {/if}

                        <div class="invite-card__stats">
                                <div class="invite-card__stat">
                                        <span class="invite-card__stat-icon" aria-hidden="true">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                                                        <path
                                                                stroke-linecap="round"
                                                                stroke-linejoin="round"
                                                                d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.314 0-6 2.015-6 4.5V20h12v-1.5c0-2.485-2.686-4.5-6-4.5Z"
                                                        />
                                                </svg>
                                        </span>
                                        <div>
                                                <p class="invite-card__stat-label">Community size</p>
                                                <p class="invite-card__stat-value">{getMemberCountLabel(invite)}</p>
                                        </div>
                                </div>
                                <div class="invite-card__stat">
                                        <span class="invite-card__stat-icon" aria-hidden="true">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                                                        <rect x="4" y="5" width="16" height="15" rx="2" ry="2" />
                                                        <path stroke-linecap="round" d="M16 3v4M8 3v4M4 10h16" />
                                                </svg>
                                        </span>
                                        <div>
                                                <p class="invite-card__stat-label">Created</p>
                                                <p class="invite-card__stat-value">{getCreatedLabel(invite)}</p>
                                        </div>
                                </div>
                                <div class="invite-card__stat">
                                        <span class="invite-card__stat-icon" aria-hidden="true">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                                                        <circle cx="12" cy="12" r="9" />
                                                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 3" />
                                                </svg>
                                        </span>
                                        <div>
                                                <p class="invite-card__stat-label">Invite status</p>
                                                <p class="invite-card__stat-value">
                                                        {getInviteStatusLabel(inviteState, invite)}
                                                        <span
                                                                class={`invite-card__stat-pill invite-card__stat-pill--${getStatusTone(inviteState, invite)}`}
                                                                aria-hidden="true"
                                                        >
                                                                {getInviteStatusLabel(inviteState, invite)}
                                                        </span>
                                                </p>
                                                <p class="invite-card__stat-hint">{getInviteStatusDescriptor(inviteState, invite)}</p>
                                        </div>
                                </div>
                        </div>

                        <div class="invite-card__code-block">
                                <div>
                                        <span class="invite-card__code-label">Invite code</span>
                                        <code class="invite-card__code" aria-label={`Invite code ${inviteCodeValue || 'unavailable'}`}>
                                                {inviteCodeValue || 'Unavailable'}
                                        </code>
                                </div>
                                <button
                                        class="invite-card__copy"
                                        type="button"
                                        onclick={copyCode}
                                        disabled={!inviteCodeValue}
                                >
                                        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                <path
                                                        d="M4 4a2 2 0 0 1 2-2h5.5a2 2 0 0 1 2 2v2H15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-2H6a2 2 0 0 1-2-2V4Zm7.5 2V4H6v7h1V8a2 2 0 0 1 2-2h2.5Z"
                                                />
                                        </svg>
                                        <span>{copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy code'}</span>
                                </button>
                        </div>
                        <p class="invite-card__copy-status" aria-live="polite">
                                {#if copyStatus === 'copied'}Invite code copied to clipboard.{:else if copyStatus === 'error'}Unable to copy the invite code.{/if}
                        </p>

                        <div class="invite-card__actions">
                                <a class="invite-card__action-primary" href="/app">
                                        <span>Launch GoChat</span>
                                        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                <path d="M12.293 4.293a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1 0 1.414l-4 4a1 1 0 1 1-1.414-1.414L14.586 10H4a1 1 0 1 1 0-2h10.586l-2.293-2.293a1 1 0 0 1 0-1.414Z" />
                                        </svg>
                                </a>
                                <a class="invite-card__action-secondary" href="/">
                                        <span>Discover GoChat</span>
                                </a>
                        </div>
                        <p class="invite-card__footnote">Sign in or create an account to accept this invite.</p>
                </section>

                <section class="invite-page__auth" aria-label="Sign in or create an account">
                        <div class="invite-page__auth-shell">
                                <AuthGate>
                                        <div class="invite-page__signed-card" role="status">
                                                <div class="invite-page__signed-icon" aria-hidden="true">
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5 10.5 18 19 6" />
                                                        </svg>
                                                </div>
                                                <h2 class="invite-page__signed-title">You're already signed in</h2>
                                                <p class="invite-page__signed-text">
                                                        Launch the app to finish joining {invite?.guild?.name ?? 'this guild'}.
                                                </p>
                                                <a class="invite-page__signed-action" href="/app">
                                                        <span>Continue to GoChat</span>
                                                        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                                <path d="M12.293 4.293a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1 0 1.414l-4 4a1 1 0 1 1-1.414-1.414L14.586 10H4a1 1 0 1 1 0-2h10.586l-2.293-2.293a1 1 0 0 1 0-1.414Z" />
                                                        </svg>
                                                </a>
                                        </div>
                                </AuthGate>
                        </div>
                </section>
        </main>
</div>

<style>
        .invite-page {
                position: relative;
                min-height: 100vh;
                color: var(--text);
                background: radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.18), transparent 55%),
                        radial-gradient(circle at 75% 0%, rgba(244, 114, 182, 0.14), transparent 60%),
                        linear-gradient(160deg, rgba(10, 13, 20, 0.9) 0%, rgba(8, 11, 18, 0.98) 55%, rgba(6, 8, 14, 1) 100%);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                isolation: isolate;
        }

        .invite-page__background {
                position: absolute;
                inset: 0;
                pointer-events: none;
        }

        .invite-page__gradient {
                position: absolute;
                border-radius: 999px;
                filter: blur(0);
                opacity: 0.65;
        }

        .invite-page__gradient--one {
                top: -18rem;
                left: -8rem;
                width: 28rem;
                height: 28rem;
                background: radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.35), transparent 70%);
        }

        .invite-page__gradient--two {
                bottom: -14rem;
                right: -12rem;
                width: 32rem;
                height: 32rem;
                background: radial-gradient(circle at 50% 50%, rgba(236, 72, 153, 0.25), transparent 70%);
        }

        .invite-page__grid {
                position: absolute;
                inset: 0;
                background-image: linear-gradient(rgba(148, 163, 184, 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(148, 163, 184, 0.04) 1px, transparent 1px);
                background-size: 120px 120px;
                mix-blend-mode: screen;
        }

        .invite-page__header {
                position: relative;
                z-index: 1;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1rem;
                padding: clamp(1.5rem, 2vw + 1rem, 2rem) clamp(1.25rem, 4vw, 3rem) 0;
                width: min(100%, 1120px);
                margin: 0 auto;
                flex-wrap: wrap;
        }

        .invite-page__brand {
                display: inline-flex;
                align-items: center;
                gap: 0.85rem;
                text-decoration: none;
                color: var(--text);
        }

        .invite-page__brand-mark {
                width: 3rem;
                height: 3rem;
                border-radius: 0.95rem;
                background: linear-gradient(140deg, rgba(99, 102, 241, 0.95), rgba(147, 51, 234, 0.85) 55%, rgba(236, 72, 153, 0.85) 100%);
                display: grid;
                place-items: center;
                color: rgba(250, 250, 255, 0.92);
                box-shadow: 0 12px 25px rgba(79, 70, 229, 0.45);
        }

        .invite-page__brand-mark svg {
                width: 1.8rem;
                height: 1.8rem;
        }

        .invite-page__brand-text {
                display: flex;
                flex-direction: column;
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.14em;
                gap: 0.15rem;
        }

        .invite-page__brand-title {
                font-weight: 700;
                color: rgba(226, 232, 255, 0.95);
        }

        .invite-page__brand-subtitle {
                color: rgba(226, 232, 255, 0.65);
                font-weight: 500;
        }

        .invite-page__header-link {
                display: inline-flex;
                align-items: center;
                gap: 0.45rem;
                padding: 0.65rem 1.1rem;
                border-radius: 999px;
                border: 1px solid rgba(148, 163, 184, 0.2);
                background: rgba(15, 23, 42, 0.45);
                color: var(--text);
                text-decoration: none;
                font-size: 0.85rem;
                font-weight: 600;
                transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }

        .invite-page__header-link:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 20px rgba(15, 23, 42, 0.35);
                background: rgba(59, 130, 246, 0.18);
        }

        .invite-page__header-link svg {
                width: 1rem;
                height: 1rem;
        }

        .invite-page__content {
                position: relative;
                z-index: 1;
                width: 100%;
                flex: 1;
                padding: clamp(2.5rem, 5vw, 4.5rem) clamp(1.25rem, 4vw, 3rem) clamp(3rem, 6vw, 4.5rem);
        }

        .invite-card,
        .invite-page__auth {
                position: relative;
                z-index: 1;
        }

        .invite-card {
                background: linear-gradient(160deg, rgba(15, 19, 29, 0.92) 0%, rgba(12, 16, 26, 0.85) 100%);
                border: 1px solid rgba(129, 140, 248, 0.25);
                border-radius: 28px;
                padding: clamp(2.1rem, 2.5vw + 1.2rem, 3rem);
                box-shadow: 0 24px 60px rgba(7, 11, 20, 0.55);
                backdrop-filter: blur(28px) saturate(140%);
                -webkit-backdrop-filter: blur(28px) saturate(140%);
                display: flex;
                flex-direction: column;
                gap: clamp(1.5rem, 2vw, 2.25rem);
                overflow: hidden;
        }

        .invite-card::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: inherit;
                border: 1px solid rgba(255, 255, 255, 0.04);
                pointer-events: none;
                mix-blend-mode: screen;
        }

        .invite-card__badge {
                align-self: flex-start;
                padding: 0.4rem 0.9rem;
                border-radius: 999px;
                border: 1px solid rgba(148, 163, 255, 0.3);
                background: rgba(99, 102, 241, 0.18);
                color: rgba(224, 231, 255, 0.85);
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.18em;
                font-weight: 600;
        }

        .invite-card__title {
                font-size: clamp(2.2rem, 3.5vw + 1rem, 2.9rem);
                line-height: 1.1;
                font-weight: 700;
                color: rgba(244, 247, 255, 0.98);
        }

        .invite-card__description {
                color: rgba(203, 213, 225, 0.85);
                max-width: 38ch;
                font-size: clamp(1rem, 1.4vw + 0.8rem, 1.1rem);
                line-height: 1.65;
        }

        .invite-card__alert {
                display: flex;
                gap: 0.9rem;
                border-radius: 18px;
                padding: 0.85rem 1rem;
                background: rgba(250, 204, 21, 0.08);
                border: 1px solid rgba(251, 191, 36, 0.25);
        }

        .invite-card__alert-icon {
                width: 2.25rem;
                height: 2.25rem;
                border-radius: 0.85rem;
                background: rgba(251, 191, 36, 0.16);
                display: grid;
                place-items: center;
                color: rgba(250, 204, 21, 0.95);
        }

        .invite-card__alert-icon svg {
                width: 1.35rem;
                height: 1.35rem;
        }

        .invite-card__alert-title {
                font-weight: 600;
                color: rgba(248, 250, 252, 0.95);
                margin-bottom: 0.25rem;
        }

        .invite-card__alert-text {
                color: rgba(226, 232, 240, 0.7);
                font-size: 0.9rem;
                line-height: 1.55;
        }

        .invite-card__stats {
                display: grid;
                gap: 1.15rem;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                padding: 1.35rem 1.6rem;
                border-radius: 22px;
                border: 1px solid rgba(99, 102, 241, 0.15);
                background: rgba(17, 24, 39, 0.55);
        }

        .invite-card__stat {
                display: flex;
                gap: 1rem;
                align-items: flex-start;
        }

        .invite-card__stat-icon {
                width: 3rem;
                height: 3rem;
                border-radius: 1rem;
                background: linear-gradient(135deg, rgba(99, 102, 241, 0.45), rgba(147, 51, 234, 0.35));
                display: grid;
                place-items: center;
                color: rgba(226, 232, 255, 0.9);
                flex-shrink: 0;
                box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08);
        }

        .invite-card__stat-icon svg {
                width: 1.55rem;
                height: 1.55rem;
        }

        .invite-card__stat-label {
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.18em;
                color: rgba(148, 163, 184, 0.8);
                font-weight: 600;
                margin-bottom: 0.25rem;
        }

        .invite-card__stat-value {
                font-size: 1.15rem;
                font-weight: 600;
                color: rgba(236, 239, 255, 0.98);
                display: flex;
                align-items: center;
                gap: 0.6rem;
        }

        .invite-card__stat-hint {
                margin-top: 0.35rem;
                font-size: 0.85rem;
                color: rgba(203, 213, 225, 0.65);
        }

        .invite-card__stat-pill {
                display: inline-flex;
                align-items: center;
                gap: 0.3rem;
                border-radius: 999px;
                padding: 0.15rem 0.65rem;
                font-size: 0.7rem;
                font-weight: 600;
                border: 1px solid transparent;
        }

        .invite-card__stat-pill--success {
                background: rgba(34, 197, 94, 0.16);
                border-color: rgba(74, 222, 128, 0.35);
                color: rgba(187, 247, 208, 0.92);
        }

        .invite-card__stat-pill--danger {
                background: rgba(248, 113, 113, 0.16);
                border-color: rgba(248, 113, 113, 0.38);
                color: rgba(254, 202, 202, 0.95);
        }

        .invite-card__stat-pill--warning {
                background: rgba(251, 191, 36, 0.18);
                border-color: rgba(251, 191, 36, 0.4);
                color: rgba(254, 243, 199, 0.95);
        }

        .invite-card__code-block {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1.25rem;
                flex-wrap: wrap;
                border-radius: 20px;
                border: 1px dashed rgba(148, 163, 255, 0.35);
                padding: 1.15rem 1.4rem;
                background: rgba(15, 23, 42, 0.55);
        }

        .invite-card__code-label {
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.18em;
                color: rgba(148, 163, 184, 0.75);
                font-weight: 600;
        }

        .invite-card__code {
                display: block;
                margin-top: 0.35rem;
                font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
                        'Courier New', monospace;
                font-size: 1.05rem;
                letter-spacing: 0.3em;
                text-transform: uppercase;
                color: rgba(224, 231, 255, 0.88);
        }

        .invite-card__copy {
                appearance: none;
                border: none;
                border-radius: 999px;
                padding: 0.65rem 1.1rem;
                display: inline-flex;
                align-items: center;
                gap: 0.45rem;
                font-weight: 600;
                font-size: 0.85rem;
                color: rgba(15, 23, 42, 0.95);
                background: linear-gradient(135deg, rgba(224, 231, 255, 0.95), rgba(192, 212, 255, 0.95));
                box-shadow: 0 12px 25px rgba(15, 23, 42, 0.35);
                cursor: pointer;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .invite-card__copy:hover:enabled {
                transform: translateY(-2px);
                box-shadow: 0 16px 35px rgba(15, 23, 42, 0.45);
        }

        .invite-card__copy:disabled {
                cursor: not-allowed;
                opacity: 0.6;
                box-shadow: none;
        }

        .invite-card__copy svg {
                width: 1rem;
                height: 1rem;
        }

        .invite-card__copy-status {
                min-height: 1.25rem;
                font-size: 0.75rem;
                color: rgba(203, 213, 225, 0.65);
        }

        .invite-card__actions {
                display: flex;
                flex-wrap: wrap;
                gap: 0.85rem;
        }

        .invite-card__action-primary,
        .invite-card__action-secondary,
        .invite-page__signed-action,
        .invite-page__header-link,
        .invite-card__copy,
        .invite-card__action-secondary {
                outline: none;
        }

        .invite-card__action-primary,
        .invite-page__signed-action {
                display: inline-flex;
                align-items: center;
                gap: 0.6rem;
                padding: 0.85rem 1.4rem;
                border-radius: 999px;
                font-weight: 600;
                text-decoration: none;
                font-size: 0.95rem;
                background: linear-gradient(135deg, rgba(99, 102, 241, 0.92), rgba(129, 140, 248, 0.9));
                color: rgba(245, 247, 255, 0.98);
                box-shadow: 0 16px 35px rgba(76, 29, 149, 0.35);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .invite-card__action-primary:hover,
        .invite-page__signed-action:hover {
                transform: translateY(-3px);
                box-shadow: 0 22px 45px rgba(76, 29, 149, 0.45);
        }

        .invite-card__action-primary svg,
        .invite-page__signed-action svg {
                width: 1.1rem;
                height: 1.1rem;
        }

        .invite-card__action-secondary {
                display: inline-flex;
                align-items: center;
                padding: 0.85rem 1.3rem;
                border-radius: 999px;
                border: 1px solid rgba(148, 163, 184, 0.25);
                color: rgba(226, 232, 240, 0.92);
                font-weight: 600;
                font-size: 0.9rem;
                text-decoration: none;
                background: rgba(15, 23, 42, 0.35);
                transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }

        .invite-card__action-secondary:hover {
                background: rgba(148, 163, 184, 0.18);
                box-shadow: 0 16px 30px rgba(15, 23, 42, 0.35);
                transform: translateY(-2px);
        }

        .invite-card__footnote {
                font-size: 0.8rem;
                color: rgba(203, 213, 225, 0.65);
        }

        .invite-page__auth {
                margin-top: clamp(2rem, 4vw, 3rem);
        }

        .invite-page__auth-shell {
                padding: clamp(1.2rem, 2vw, 2rem);
                border-radius: 26px;
                background: linear-gradient(180deg, rgba(15, 23, 42, 0.55), rgba(15, 23, 42, 0));
                border: 1px solid rgba(99, 102, 241, 0.1);
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }

        .invite-page__signed-card {
                background: linear-gradient(160deg, rgba(17, 24, 39, 0.92), rgba(12, 18, 31, 0.88));
                border: 1px solid rgba(129, 140, 248, 0.3);
                border-radius: 22px;
                padding: 2rem;
                display: flex;
                flex-direction: column;
                gap: 1.15rem;
                box-shadow: 0 18px 45px rgba(7, 11, 20, 0.55);
        }

        .invite-page__signed-icon {
                width: 3rem;
                height: 3rem;
                border-radius: 1rem;
                background: rgba(34, 197, 94, 0.18);
                color: rgba(187, 247, 208, 0.9);
                display: grid;
                place-items: center;
        }

        .invite-page__signed-icon svg {
                width: 1.6rem;
                height: 1.6rem;
        }

        .invite-page__signed-title {
                font-size: 1.3rem;
                font-weight: 600;
                color: rgba(236, 239, 255, 0.96);
        }

        .invite-page__signed-text {
                color: rgba(203, 213, 225, 0.75);
                font-size: 0.95rem;
                line-height: 1.6;
        }

        .invite-page__signed-action {
                align-self: flex-start;
        }

        .invite-page :global(.invite-page__auth-shell > div) {
                display: flex !important;
                align-items: flex-start !important;
                justify-content: center !important;
                width: 100% !important;
                height: 100% !important;
                min-height: 0 !important;
                padding: 0 !important;
                background: transparent !important;
        }

        .invite-page :global(.invite-page__auth-shell > div .panel) {
                width: min(100%, 420px);
                margin: 0 auto;
                background: linear-gradient(165deg, rgba(17, 24, 39, 0.94), rgba(12, 18, 31, 0.88));
                border: 1px solid rgba(129, 140, 248, 0.35);
                box-shadow: 0 20px 50px rgba(7, 11, 20, 0.6);
        }

        .invite-page :global(.invite-page__auth-shell > div .panel :where(input, button, textarea, select, a):focus-visible) {
                outline: none;
                box-shadow: var(--focus-ring);
        }

        .invite-page :global(.invite-page__auth-shell > div .panel button) {
                border-radius: 10px;
        }

        .invite-page :global(.invite-page__auth-shell > div .panel .underline:hover) {
                color: rgba(224, 231, 255, 0.9);
        }

        .invite-page :global(.invite-page__auth-shell > div .panel .underline:focus-visible) {
                outline: none;
                box-shadow: var(--focus-ring);
        }

        .invite-page a:focus-visible,
        .invite-page button:focus-visible {
                outline: none;
                box-shadow: var(--focus-ring);
        }

        .invite-page__content {
                display: grid;
                gap: clamp(2.2rem, 4vw, 3rem);
        }

        @media (min-width: 960px) {
                .invite-page__content {
                        grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
                        align-items: start;
                }

                .invite-page__auth {
                        margin-top: 0;
                }
        }

        @media (max-width: 600px) {
                .invite-card__code {
                        letter-spacing: 0.2em;
                        font-size: 0.95rem;
                }
        }
</style>
