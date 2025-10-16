<script lang="ts">
        import AvatarCropper from './AvatarCropper.svelte';
        import { auth } from '$lib/stores/auth';

        const me = auth.user;

        let name = '';
        let nameInitialized = false;
        let loading = false;
        let message: string | null = null;

        let croppedAvatar: string | null = null;
        let existingAvatarUrl: string | null = null;
        let fallbackInitial = '?';

        $: if (!nameInitialized && $me) {
                name = $me.name ?? '';
                nameInitialized = true;
        }

        $: existingAvatarUrl = resolveExistingAvatar($me);
        $: fallbackInitial = avatarInitial(name);

        async function save() {
                loading = true;
                message = null;
                try {
                        await auth.api.user.userMePatch({ userModifyUserRequest: { name } });
                        message = 'Profile updated';
                } finally {
                        loading = false;
                }
        }

        function resolveExistingAvatar(user: unknown): string | null {
                if (!user || typeof user !== 'object') return null;
                const candidate =
                        (user as any).avatarUrl ??
                        (user as any).avatar_url ??
                        (user as any).avatar ??
                        (user as any)?.profile?.avatarUrl ??
                        (user as any)?.profile?.avatar_url ??
                        null;
                if (typeof candidate === 'string' && candidate.trim().length > 0) {
                        return candidate;
                }
                return null;
        }

        function avatarInitial(source: string | null | undefined) {
                const trimmed = (source ?? '').trim();
                if (!trimmed) return '?';
                return trimmed.charAt(0).toUpperCase();
        }
</script>

<div class="space-y-4">
        <AvatarCropper
                bind:croppedDataUrl={croppedAvatar}
                fallbackInitial={fallbackInitial}
                initialAvatarUrl={existingAvatarUrl}
        />

        <div class="panel space-y-3 p-4">
                <div class="text-sm font-medium">Profile</div>
                <input
                        class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
                        placeholder="Display name"
                        bind:value={name}
                />
                <div class="flex justify-end gap-2">
                        <button
                                class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)] disabled:opacity-50"
                                disabled={loading}
                                onclick={save}>Save</button
                        >
                </div>
                {#if message}<div class="text-xs text-green-500">{message}</div>{/if}
                <div class="text-xs text-[var(--muted)]">Use logout/login if not reflected immediately.</div>
                <button class="mt-2 text-sm text-red-400 underline" onclick={() => auth.logout()}>Logout</button>
        </div>
</div>
