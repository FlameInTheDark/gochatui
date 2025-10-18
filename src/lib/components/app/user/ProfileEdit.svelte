<script lang="ts">
        import { onMount } from 'svelte';
        import AvatarCropper from './AvatarCropper.svelte';
        import { auth } from '$lib/stores/auth';
        import { resolveAvatarUrl } from '$lib/utils/avatar';

        type AvatarPreview = {
                id: string;
                url: string;
                width?: number | null;
                height?: number | null;
        };

        const NO_AVATAR_ID = '__none__';

        const me = auth.user;

        let name = '';
        let nameInitialized = false;
        let loading = false;
        let message: string | null = null;
        let messageVariant: 'success' | 'error' | null = null;

        let croppedAvatar: string | null = null;
        let fallbackInitial = '?';
        let baseAvatarUrl: string | null = null;
        let previewAvatarUrl: string | null = null;

        let avatarPreviews: AvatarPreview[] = [];
        let avatarsLoading = false;
        let avatarsError: string | null = null;

        let selectedAvatarId: string | null = null;
        let avatarSelectionDirty = false;

        onMount(() => {
                void loadAvailableAvatars();
        });

        $: baseAvatarUrl = resolveAvatarUrl($me);
        $: if (!nameInitialized && $me) {
                name = $me.name ?? '';
                nameInitialized = true;
        }

        $: fallbackInitial = avatarInitial(name);

        $: if (!avatarSelectionDirty && !croppedAvatar) {
                const resolvedId = extractAvatarId($me);
                if (resolvedId) {
                        selectedAvatarId = resolvedId;
                } else if (baseAvatarUrl) {
                        selectedAvatarId = null;
                } else {
                        selectedAvatarId = NO_AVATAR_ID;
                }
        }

        $: previewAvatarUrl =
                croppedAvatar ??
                (selectedAvatarId === NO_AVATAR_ID
                        ? null
                        : selectedAvatarId
                        ? findAvatarUrl(selectedAvatarId) ?? baseAvatarUrl
                        : baseAvatarUrl);

        $: if (croppedAvatar) {
                selectedAvatarId = null;
                avatarSelectionDirty = true;
        }

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

		await auth.api.upload.uploadAvatarsUserIdAvatarIdPost({
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

                        const patchPayload: Record<string, unknown> = {};

                        if (trimmedName !== currentName) {
                                patchPayload.name = trimmedName;
                        }

                        const currentAvatarId = extractAvatarId($me);
                        const normalizedCurrentAvatarId = currentAvatarId ?? NO_AVATAR_ID;

                        if (selectedAvatarId !== null && selectedAvatarId !== normalizedCurrentAvatarId) {
                                patchPayload.avatar =
                                        selectedAvatarId === NO_AVATAR_ID
                                                ? (0n as any)
                                                : (BigInt(selectedAvatarId) as any);
                        }

                        if (Object.keys(patchPayload).length) {
                                await auth.api.user.userMePatch({
                                        userModifyUserRequest: patchPayload
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
                                avatarSelectionDirty = false;
                                await loadAvailableAvatars();
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

        function avatarInitial(source: string | null | undefined) {
                const trimmed = (source ?? '').trim();
                if (!trimmed) return '?';
                return trimmed.charAt(0).toUpperCase();
        }

        function extractAvatarId(user: unknown): string | null {
                if (!user || typeof user !== 'object') return null;
                const record = user as Record<string, unknown>;
                const avatar = record.avatar;
                if (avatar && typeof avatar === 'object') {
                        const avatarRecord = avatar as Record<string, unknown>;
                        const id = avatarRecord.id ?? avatarRecord.avatar_id ?? avatarRecord.avatarId;
                        if (id != null) {
                                try {
                                        return BigInt(id as any).toString();
                                } catch {
                                        return String(id);
                                }
                        }
                }
                const fallbackId = record.avatar_id ?? record.avatarId ?? (typeof avatar === 'string' ? avatar : null);
                if (fallbackId == null) return null;
                try {
                        return BigInt(fallbackId as any).toString();
                } catch {
                        return String(fallbackId);
                }
        }

        function findAvatarUrl(id: string | null | undefined): string | null {
                if (!id) return null;
                const entry = avatarPreviews.find((preview) => preview.id === id);
                return entry?.url ?? null;
        }

        function selectExistingAvatar(id: string) {
                croppedAvatar = null;
                selectedAvatarId = id;
                avatarSelectionDirty = true;
        }

        function selectNoAvatar() {
                croppedAvatar = null;
                selectedAvatarId = NO_AVATAR_ID;
                avatarSelectionDirty = true;
        }

        async function loadAvailableAvatars() {
                if (avatarsLoading) return;
                avatarsLoading = true;
                avatarsError = null;
                try {
                        const response = await auth.api.user.userMeAvatarsGet();
                        const items = Array.isArray(response.data) ? response.data : [];
                        const mapped: AvatarPreview[] = [];
                        for (const item of items) {
                                const record = item as Record<string, unknown>;
                                const idRaw = record.id;
                                const url = typeof record.url === 'string' ? record.url : null;
                                if (idRaw == null || !url) continue;
                                let id: string;
                                try {
                                        id = BigInt(idRaw as any).toString();
                                } catch {
                                        id = String(idRaw);
                                }
                                mapped.push({
                                        id,
                                        url,
                                        width: (record.width as number | null | undefined) ?? null,
                                        height: (record.height as number | null | undefined) ?? null
                                });
                        }
                        avatarPreviews = mapped;
                } catch (error) {
                        console.error(error);
                        avatarsError = 'Failed to load previously uploaded avatars.';
                } finally {
                        avatarsLoading = false;
                }
        }
</script>

<div class="space-y-4">
        <AvatarCropper
                bind:croppedDataUrl={croppedAvatar}
                {fallbackInitial}
                initialAvatarUrl={previewAvatarUrl}
        />

        <div class="panel space-y-3 p-4">
                <div class="text-sm font-medium">Avatar history</div>
                {#if avatarsError}
                        <p class="text-xs text-red-400">{avatarsError}</p>
                {/if}
                {#if avatarsLoading}
                        <p class="text-xs text-[var(--muted)]">Loading avatars…</p>
                {/if}
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
                        <button
                                type="button"
                                class={`group flex flex-col items-center gap-2 text-xs transition ${
                                        selectedAvatarId === NO_AVATAR_ID
                                                ? 'text-[var(--brand)]'
                                                : 'text-[var(--muted)] hover:text-[var(--text)]'
                                }`}
                                onclick={selectNoAvatar}
                                aria-pressed={selectedAvatarId === NO_AVATAR_ID}
                                aria-label="Clear avatar"
                        >
                                <span
                                        class={`flex h-16 w-16 items-center justify-center rounded-full border text-base transition ${
                                                selectedAvatarId === NO_AVATAR_ID
                                                        ? 'border-[var(--brand)] bg-[var(--panel-strong)] text-[var(--brand)]'
                                                        : 'border-[var(--stroke)] bg-[var(--panel)] text-[var(--muted)] group-hover:border-[var(--brand)]/60'
                                        }`}
                                >
                                        ∅
                                </span>
                        </button>

                        {#each avatarPreviews as avatar (avatar.id)}
                                <button
                                        type="button"
                                        class={`group flex flex-col items-center gap-2 text-xs transition ${
                                                selectedAvatarId === avatar.id
                                                        ? 'text-[var(--brand)]'
                                                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                                        }`}
                                        onclick={() => selectExistingAvatar(avatar.id)}
                                        aria-pressed={selectedAvatarId === avatar.id}
                                        aria-label={avatar.width && avatar.height
                                                ? `Use ${avatar.width} by ${avatar.height} avatar`
                                                : 'Use uploaded avatar'}
                                >
                                        <span
                                                class={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border transition ${
                                                        selectedAvatarId === avatar.id
                                                                ? 'border-[var(--brand)] ring-2 ring-[var(--brand)]/60'
                                                                : 'border-[var(--stroke)] bg-[var(--panel)] group-hover:border-[var(--brand)]/60'
                                                }`}
                                        >
                                                <img
                                                        src={avatar.url}
                                                        alt="Previous avatar"
                                                        class="h-full w-full object-cover"
                                                />
                                        </span>
                                </button>
                        {/each}
                </div>
                {#if !avatarsLoading && !avatarPreviews.length}
                        <p class="text-xs text-[var(--muted)]">No previous avatars yet.</p>
                {/if}
        </div>

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
			<div class={`text-xs ${messageVariant === 'error' ? 'text-red-400' : 'text-green-500'}`}>
				{message}
			</div>
		{/if}
		<div class="text-xs text-[var(--muted)]">Use logout/login if not reflected immediately.</div>
		<button class="mt-2 text-sm text-red-400 underline" onclick={() => auth.logout()}>Logout</button
		>
	</div>
</div>
