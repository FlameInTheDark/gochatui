<script lang="ts">
        import AvatarCropper from './AvatarCropper.svelte';
        import { auth } from '$lib/stores/auth';

        const me = auth.user;

        let name = '';
        let nameInitialized = false;
        let loading = false;
        let message: string | null = null;
        let messageVariant: 'success' | 'error' | null = null;

        let croppedAvatar: string | null = null;
        let existingAvatarUrl: string | null = null;
        let fallbackInitial = '?';

        $: if (!nameInitialized && $me) {
                name = $me.name ?? '';
                nameInitialized = true;
        }

        $: existingAvatarUrl = resolveExistingAvatar($me);
        $: fallbackInitial = avatarInitial(name);

        async function uploadCroppedAvatar(dataUrl: string) {
                const response = await fetch(dataUrl);
                if (!response.ok) {
                        throw new Error('Failed to read cropped avatar image.');
                }

                const blob = await response.blob();
                if (!blob.size) {
                        throw new Error('Avatar image appears to be empty.');
                }

                const contentType = blob.type && blob.type.trim().length > 0 ? blob.type : 'image/png';
                const metadataResponse = await auth.api.user.userMeAvatarPost({
                        userCreateAvatarRequest: {
                                content_type: contentType,
                                file_size: blob.size
                        }
                });

                const metadata = metadataResponse.data ?? null;
                const avatarIdRaw = metadata?.id;
                const userIdRaw = metadata?.user_id;
                if (avatarIdRaw == null || userIdRaw == null) {
                        throw new Error('Avatar upload metadata did not include identifiers.');
                }

                const avatarId = BigInt(avatarIdRaw);
                const userId = BigInt(userIdRaw);
                const buffer = await blob.arrayBuffer();
                const bytes = new Uint8Array(buffer);

                await auth.api.avatars.avatarsUserIdAvatarIdPost({
                        userId: userId as any,
                        avatarId: avatarId as any,
                        requestBody: bytes as any
                });
        }

        function extractHttpStatus(error: unknown): number | null {
                if (!error || typeof error !== 'object') return null;
                const maybeResponse = (error as any).response;
                if (!maybeResponse || typeof maybeResponse !== 'object') return null;
                const status = (maybeResponse as any).status;
                return typeof status === 'number' ? status : null;
        }

        async function save() {
                loading = true;
                message = null;
                messageVariant = null;

                let updated = false;
                let shouldReloadMe = false;

                try {
                        const currentName = $me?.name ?? '';
                        const trimmedName = name.trim();
                        name = trimmedName;

                        if (trimmedName !== currentName) {
                                await auth.api.user.userMePatch({
                                        userModifyUserRequest: { name: trimmedName }
                                });
                                updated = true;
                                shouldReloadMe = true;
                        }

                        if (croppedAvatar) {
                                await uploadCroppedAvatar(croppedAvatar);
                                updated = true;
                                shouldReloadMe = true;
                        }

                        if (shouldReloadMe) {
                                await auth.loadMe();
                                croppedAvatar = null;
                        }

                        if (updated) {
                                message = 'Profile updated';
                                messageVariant = 'success';
                        } else {
                                message = 'No changes to save';
                                messageVariant = 'success';
                        }
                } catch (error) {
                        console.error(error);
                        const status = extractHttpStatus(error);
                        if (status === 413) {
                                message = 'Avatar is too large even after cropping. Please try a smaller image.';
                        } else {
                                message = 'Failed to update profile. Please try again.';
                        }
                        messageVariant = 'error';
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
                {#if message}
                        <div
                                class={`text-xs ${
                                        messageVariant === 'error' ? 'text-red-400' : 'text-green-500'
                                }`}
                        >
                                {message}
                        </div>
                {/if}
                <div class="text-xs text-[var(--muted)]">Use logout/login if not reflected immediately.</div>
                <button class="mt-2 text-sm text-red-400 underline" onclick={() => auth.logout()}>Logout</button>
        </div>
</div>
