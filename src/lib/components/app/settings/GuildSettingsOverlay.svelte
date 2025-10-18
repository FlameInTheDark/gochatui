<script lang="ts">
	import { guildSettingsOpen, selectedGuildId } from '$lib/stores/appState';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages.js';
        import AvatarCropper from '$lib/components/app/user/AvatarCropper.svelte';
        import GuildInvitesManager from './GuildInvitesManager.svelte';
        import GuildRolesManager from './GuildRolesManager.svelte';
        import SettingsPanel from '$lib/components/ui/SettingsPanel.svelte';
        import { Trash2 } from 'lucide-svelte';
        import {
                PERMISSION_BAN_MEMBERS,
                PERMISSION_CREATE_INVITES,
                PERMISSION_KICK_MEMBERS,
                PERMISSION_MANAGE_CHANNELS,
                PERMISSION_MANAGE_GUILD,
                PERMISSION_MANAGE_ROLES,
                PERMISSION_TIMEOUT_MEMBERS,
                hasAnyGuildPermission,
                hasGuildPermission
        } from '$lib/utils/permissions';
        import { resolveAvatarUrl } from '$lib/utils/avatar';

	type SettingsCategory = 'profile' | 'roles' | 'moderation' | 'integrations' | 'invites';

	const guilds = auth.guilds;
	const me = auth.user;
	const activeGuild = $derived.by(() => {
		const gid = $selectedGuildId;
		if (!gid) return null;
		return $guilds.find((g) => String((g as any)?.id) === gid) ?? null;
	});
	const accessibleCategories = $derived.by(() => {
		const guild = activeGuild;
		const allowed: SettingsCategory[] = [];
		if (!guild) return allowed;
		if (hasGuildPermission(guild, $me?.id, PERMISSION_MANAGE_GUILD)) {
			allowed.push('profile');
		}
		if (hasAnyGuildPermission(guild, $me?.id, PERMISSION_MANAGE_ROLES, PERMISSION_MANAGE_GUILD)) {
			allowed.push('roles');
		}
		if (
			hasAnyGuildPermission(
				guild,
				$me?.id,
				PERMISSION_MANAGE_GUILD,
				PERMISSION_KICK_MEMBERS,
				PERMISSION_BAN_MEMBERS,
				PERMISSION_TIMEOUT_MEMBERS
			)
		) {
			allowed.push('moderation');
		}
		if (hasGuildPermission(guild, $me?.id, PERMISSION_CREATE_INVITES)) {
			allowed.push('invites');
		}
		if (
			hasAnyGuildPermission(guild, $me?.id, PERMISSION_MANAGE_GUILD, PERMISSION_MANAGE_CHANNELS)
		) {
			allowed.push('integrations');
		}
		return allowed;
	});
	let category = $state<SettingsCategory>('profile');
	let name = $state('');
        let saving = $state(false);
        let error: string | null = $state(null);
        let croppedIcon = $state<string | null>(null);

        type IconPreview = {
                id: string;
                url: string;
                width?: number | null;
                height?: number | null;
        };

        const NO_ICON_ID = '__none__';

        let availableIcons = $state<IconPreview[]>([]);
        let iconsLoading = $state(false);
        let iconsError: string | null = $state(null);
        let selectedIconId = $state<string | null>(null);
        let iconSelectionDirty = $state(false);
        let iconsLoadedGuildId = $state<string | null>(null);
        let deletingIconIds = $state<string[]>([]);

        const isGuildOwner = $derived.by(() => {
                const guild = activeGuild;
                if (!guild) return false;
                const ownerId = toBigInt((guild as any)?.owner);
                const userId = toBigInt($me?.id);
                if (ownerId == null || userId == null) return false;
                return ownerId === userId;
        });

        const iconFallbackInitial = $derived.by(() => guildInitials(activeGuild));
        const baseIconUrl = $derived.by(() => resolveAvatarUrl(activeGuild));
        const currentIconId = $derived.by(() => extractIconId(activeGuild));
        const selectedIconUrl = $derived.by(() => {
                if (selectedIconId === NO_ICON_ID) return null;
                if (!selectedIconId) return baseIconUrl;
                const entry = availableIcons.find((icon) => icon.id === selectedIconId);
                return entry?.url ?? baseIconUrl;
        });
        const previewIconUrl = $derived.by(() => (croppedIcon ? croppedIcon : selectedIconUrl));

        $effect(() => {
                if (!iconSelectionDirty && !croppedIcon) {
                        const resolvedId = currentIconId;
                        if (resolvedId) {
                                selectedIconId = resolvedId;
                                return;
                        }

                        if (baseIconUrl) {
                                selectedIconId = null;
                                return;
                        }

                        selectedIconId = NO_ICON_ID;
                }
        });

        $effect(() => {
                const open = $guildSettingsOpen;
                const gid = $selectedGuildId;
                if (open && gid && isGuildOwner) {
                        if (iconsLoadedGuildId !== gid && !iconsLoading) {
                                void loadGuildIcons(gid);
                        }
                }
                if (!open) {
                        iconSelectionDirty = false;
                }
        });

        $effect(() => {
                if (croppedIcon) {
                        selectedIconId = null;
                        iconSelectionDirty = true;
                }
        });

        $effect(() => {
                if ($guildSettingsOpen) {
                        const current = activeGuild;
                        name = current?.name ?? '';
                        error = null;
                        saving = false;
                        croppedIcon = null;
                        const allowed = accessibleCategories;
                        if (!allowed.length) {
                                guildSettingsOpen.set(false);
                                return;
                        }
                        if (!allowed.includes(category)) {
                                category = allowed[0];
                        }
                }
        });

        async function save() {
                const guild = activeGuild;
                const gid = $selectedGuildId;
                if (!guild || !gid) return;
                if (!hasGuildPermission(guild, $me?.id, PERMISSION_MANAGE_GUILD)) return;
                saving = true;
                error = null;
                try {
                        let shouldReloadGuilds = false;

                        const trimmedName = name.trim();
                        name = trimmedName;

                        const patchPayload: Record<string, unknown> = {};

                        if (trimmedName !== (guild?.name ?? '')) {
                                patchPayload.name = trimmedName;
                        }

                        const normalizedCurrentIconId = currentIconId ?? NO_ICON_ID;
                        if (selectedIconId !== null && selectedIconId !== normalizedCurrentIconId) {
                                if (!isGuildOwner) {
                                        throw new Error('Only the guild owner can change the server icon.');
                                }
                                patchPayload.icon_id =
                                        selectedIconId === NO_ICON_ID
                                                ? (0n as any)
                                                : (BigInt(selectedIconId) as any);
                        }

                        if (Object.keys(patchPayload).length) {
                                await auth.api.guild.guildGuildIdPatch({
                                        guildId: BigInt(gid) as any,
                                        guildUpdateGuildRequest: patchPayload
                                });
                                shouldReloadGuilds = true;
                        }

                        if (croppedIcon) {
                                if (!isGuildOwner) {
                                        throw new Error('Only the guild owner can change the server icon.');
                                }

                                await uploadGuildIcon(gid, croppedIcon);
                                croppedIcon = null;
                                shouldReloadGuilds = true;
                        }

                        if (shouldReloadGuilds) {
                                await auth.loadGuilds();
                                iconSelectionDirty = false;
                                await loadGuildIcons(gid, true);
                        }
                } catch (e: any) {
                        error = formatSaveError(e);
                } finally {
                        saving = false;
                }
        }

        function closeOverlay() {
                guildSettingsOpen.set(false);
        }

        function selectExistingIcon(id: string) {
                croppedIcon = null;
                selectedIconId = id;
                iconSelectionDirty = true;
        }

        function selectNoIcon() {
                croppedIcon = null;
                selectedIconId = NO_ICON_ID;
                iconSelectionDirty = true;
        }

        async function loadGuildIcons(guildId: string, force = false) {
                if (!isGuildOwner) return;
                if (iconsLoading && !force) return;
                iconsLoading = true;
                iconsError = null;
                try {
                        const response = await auth.api.guild.guildGuildIdIconsGet({
                                guildId: BigInt(guildId) as any
                        });
                        const items = Array.isArray(response.data) ? response.data : [];
                        const mapped: IconPreview[] = [];
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
                        availableIcons = mapped;
                        iconsLoadedGuildId = guildId;
                } catch (error) {
                        console.error(error);
                        iconsError = 'Failed to load server icons.';
                } finally {
                        iconsLoading = false;
                }
        }

        function isDeletingIcon(id: string): boolean {
                return deletingIconIds.includes(id);
        }

        function markIconDeleting(id: string, deleting: boolean) {
                if (deleting) {
                        if (!deletingIconIds.includes(id)) {
                                deletingIconIds = [...deletingIconIds, id];
                        }
                } else {
                        deletingIconIds = deletingIconIds.filter((existing) => existing !== id);
                }
        }

        async function deleteIcon(id: string) {
                if (!isGuildOwner) return;
                const guildId = $selectedGuildId;
                if (!guildId) return;
                if (isDeletingIcon(id)) return;
                if (selectedIconId === id) return;

                iconsError = null;
                markIconDeleting(id, true);
                try {
                        let iconId: bigint;
                        try {
                                iconId = BigInt(id);
                        } catch {
                                throw new Error('Invalid icon identifier.');
                        }

                        await auth.api.guild.guildGuildIdIconsIconIdDelete({
                                guildId: BigInt(guildId) as any,
                                iconId: iconId as any
                        });

                        availableIcons = availableIcons.filter((icon) => icon.id !== id);
                } catch (error) {
                        console.error(error);
                        iconsError = 'Failed to delete guild icon. Please try again.';
                } finally {
                        markIconDeleting(id, false);
                }
        }

        function guildInitials(guild: any): string {
                const name = String((guild as any)?.name ?? '?');
                return name.slice(0, 2).toUpperCase();
        }

        function extractIconId(guild: unknown): string | null {
                if (!guild || typeof guild !== 'object') return null;
                const record = guild as Record<string, unknown>;
                const icon = record.icon;
                if (icon && typeof icon === 'object') {
                        const iconRecord = icon as Record<string, unknown>;
                        const id = iconRecord.id ?? iconRecord.icon_id ?? iconRecord.iconId;
                        if (id != null) {
                                try {
                                        return BigInt(id as any).toString();
                                } catch {
                                        return String(id);
                                }
                        }
                }
                const fallbackId = record.icon_id ?? record.iconId ?? (typeof icon === 'string' ? icon : null);
                if (fallbackId == null) return null;
                try {
                        return BigInt(fallbackId as any).toString();
                } catch {
                        return String(fallbackId);
                }
        }

        async function uploadGuildIcon(guildId: string, dataUrl: string) {
                const response = await fetch(dataUrl);
                if (!response.ok) {
                        throw new Error('Failed to read cropped icon image.');
                }

                const blob = await response.blob();
                if (!blob.size) {
                        throw new Error('Icon image appears to be empty.');
                }

                const detectedType = (blob.type || '').trim();
                const contentType = detectedType && detectedType.startsWith('image/') ? detectedType : 'image/png';

                const metadataResponse = await auth.api.guild.guildGuildIdIconPost({
                        guildId: BigInt(guildId) as any,
                        guildCreateIconRequest: {
                                content_type: contentType,
                                file_size: blob.size
                        }
                });

                const metadata = metadataResponse.data ?? null;
                const iconIdRaw = (metadata as any)?.id;
                const guildIdRaw = (metadata as any)?.guild_id;
                if (iconIdRaw == null || guildIdRaw == null) {
                        throw new Error('Icon upload metadata was missing identifiers.');
                }

                const iconId = BigInt(iconIdRaw);
                const confirmedGuildId = BigInt(guildIdRaw);

                const buffer = await blob.arrayBuffer();
                const bytes = new Uint8Array(buffer);

                await auth.api.upload.uploadIconsGuildIdIconIdPost({
                        guildId: confirmedGuildId as any,
                        iconId: iconId as any,
                        requestBody: bytes as any
                });
        }

        function toBigInt(value: unknown): bigint | null {
                if (value == null) return null;
                try {
                        if (typeof value === 'bigint') return value;
                        if (typeof value === 'number') return BigInt(value);
                        if (typeof value === 'string' && value.trim().length > 0) {
                                return BigInt(value.trim());
                        }
                } catch {
                        return null;
                }
                return null;
        }

        function extractHttpStatus(error: unknown): number | null {
                if (!error || typeof error !== 'object') return null;
                const maybeResponse = (error as any).response;
                if (!maybeResponse || typeof maybeResponse !== 'object') return null;
                const status = (maybeResponse as any).status;
                return typeof status === 'number' ? status : null;
        }

        function formatSaveError(error: unknown): string {
                const status = extractHttpStatus(error);
                if (status === 403) {
                        return 'You do not have permission to update this server.';
                }
                if (status === 413) {
                        return 'Icon is too large even after processing. Please choose a smaller image.';
                }
                if (error instanceof Error && error.message) {
                        return error.message;
                }
                if (error && typeof error === 'object') {
                        const message = (error as any)?.response?.data?.message;
                        if (typeof message === 'string' && message.trim().length > 0) {
                                return message;
                        }
                }
                return 'Failed to save changes.';
        }
</script>

<SettingsPanel bind:open={$guildSettingsOpen} on:close={closeOverlay}>
	<svelte:fragment slot="sidebar">
		{#if accessibleCategories.includes('profile')}
			<button
				class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'profile'
					? 'bg-[var(--panel)] font-semibold'
					: ''}"
				onclick={() => (category = 'profile')}
			>
				{m.server_profile()}
			</button>
		{/if}
		{#if accessibleCategories.includes('roles')}
			<button
				class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'roles'
					? 'bg-[var(--panel)] font-semibold'
					: ''}"
				onclick={() => (category = 'roles')}
			>
				{m.roles()}
			</button>
		{/if}
		{#if accessibleCategories.includes('moderation')}
			<button
				class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'moderation'
					? 'bg-[var(--panel)] font-semibold'
					: ''}"
				onclick={() => (category = 'moderation')}
			>
				{m.moderation()}
			</button>
		{/if}
		{#if accessibleCategories.includes('invites')}
			<button
				class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'invites'
					? 'bg-[var(--panel)] font-semibold'
					: ''}"
				onclick={() => (category = 'invites')}
			>
				{m.invites()}
			</button>
		{/if}
		{#if accessibleCategories.includes('integrations')}
			<button
				class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category ===
				'integrations'
					? 'bg-[var(--panel)] font-semibold'
					: ''}"
				onclick={() => (category = 'integrations')}
			>
				{m.integrations()}
			</button>
		{/if}
	</svelte:fragment>

        {#if category === 'profile' && accessibleCategories.includes('profile')}
                <div class="space-y-4">
                        <AvatarCropper
                                bind:croppedDataUrl={croppedIcon}
                                displayBorderRadiusClass="rounded-xl"
                                displayImageAlt="Guild icon preview"
                                fallbackInitial={iconFallbackInitial}
                                helperText="PNG or JPEG recommended"
                                initialAvatarUrl={previewIconUrl}
                                maskCornerRadiusRatio={0.25}
                                maskShape="rounded"
                                previewBorderRadiusClass="rounded-xl"
                                previewImageAlt="Cropped guild icon"
                                previewLabel="Cropped icon preview (128×128)"
                                previewPlaceholderBorderRadiusClass="rounded-xl"
                                previewPlaceholderText="Adjust the crop to see icon preview"
                                resetButtonLabel="Reset icon selection"
                                uploadInputId="guild-icon-upload"
                                uploadLabel="Upload icon"
                                chooseButtonLabel="Choose icon"
                        />

                        {#if isGuildOwner}
                                <div class="panel space-y-3 p-4">
                                        <div class="text-sm font-medium">Icon history</div>
                                        {#if iconsError}
                                                <p class="text-xs text-red-400">{iconsError}</p>
                                        {/if}
                                        {#if iconsLoading}
                                                <p class="text-xs text-[var(--muted)]">Loading icons…</p>
                                        {/if}
                                        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
                                                <button
                                                        type="button"
                                                        class={`group flex flex-col items-center gap-2 text-xs transition ${
                                                                selectedIconId === NO_ICON_ID
                                                                        ? 'text-[var(--success)]'
                                                                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                                                        }`}
                                                        onclick={selectNoIcon}
                                                        aria-pressed={selectedIconId === NO_ICON_ID}
                                                        aria-label="Clear server icon"
                                                        data-tooltip-disabled
                                                >
                                                        <span
                                                                class={`flex h-16 w-16 items-center justify-center rounded-xl border text-base transition ${
                                                                        selectedIconId === NO_ICON_ID
                                                                                ? 'border-[var(--success)] bg-[var(--panel-strong)] text-[var(--success)]'
                                                                                : 'border-[var(--stroke)] bg-[var(--panel)] text-[var(--muted)] group-hover:border-[var(--brand)]/60'
                                                                }`}
                                                        >
                                                                ∅
                                                        </span>
                                                </button>

                                                {#each availableIcons as icon (icon.id)}
                                                        <div class="group relative">
                                                                <button
                                                                        type="button"
                                                                        class={`group flex flex-col items-center gap-2 text-xs transition ${
                                                                                selectedIconId === icon.id
                                                                                        ? 'text-[var(--success)]'
                                                                                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                                                                        }`}
                                                                        onclick={() => selectExistingIcon(icon.id)}
                                                                        aria-pressed={selectedIconId === icon.id}
                                                                        aria-label={icon.width && icon.height
                                                                                ? `Use ${icon.width} by ${icon.height} icon`
                                                                                : 'Use uploaded icon'}
                                                                        data-tooltip-disabled
                                                                >
                                                                        <span
                                                                                class={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border transition ${
                                                                                        selectedIconId === icon.id
                                                                                                ? 'border-[var(--success)] ring-2 ring-[var(--success)]/60'
                                                                                                : 'border-[var(--stroke)] bg-[var(--panel)] group-hover:border-[var(--brand)]/60'
                                                                                }`}
                                                                        >
                                                                                <img
                                                                                        src={icon.url}
                                                                                        alt="Previous guild icon"
                                                                                        class="h-full w-full object-cover"
                                                                                />
                                                                        </span>
                                                                </button>

                                                                <button
                                                                        type="button"
                                                                        class={`absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--panel-strong)]/90 text-[var(--muted)] transition hover:text-red-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 ${
                                                                                isDeletingIcon(icon.id) || selectedIconId === icon.id
                                                                                        ? 'cursor-not-allowed opacity-60'
                                                                                        : 'opacity-0 group-hover:opacity-100'
                                                                        }`}
                                                                        onclick={(event) => {
                                                                                event.stopPropagation();
                                                                                void deleteIcon(icon.id);
                                                                        }}
                                                                        aria-label="Delete guild icon"
                                                                        disabled={isDeletingIcon(icon.id) || selectedIconId === icon.id}
                                                                >
                                                                        <Trash2 class="h-3.5 w-3.5" stroke-width={2} />
                                                                </button>
                                                        </div>
                                                {/each}
                                        </div>
                                        {#if !iconsLoading && !availableIcons.length}
                                                <p class="text-xs text-[var(--muted)]">No previous icons yet.</p>
                                        {/if}
                                </div>
                        {/if}

                        <div>
                                <label for="guild-name" class="mb-2 block">{m.server_name()}</label>
                                <input
                                        id="guild-name"
                                        class="w-full rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                        bind:value={name}
                                />
                                <div class="mt-2 flex gap-2">
                                        <button
                                                class="rounded bg-blue-500 px-3 py-1 text-white hover:bg-blue-600 disabled:opacity-50"
                                                onclick={save}
                                                disabled={saving}
                                        >
                                                {saving ? m.saving() : m.save()}
                                        </button>
                                </div>
                                {#if error}
                                        <p class="mt-2 text-sm text-red-500">{error}</p>
                                {/if}
                        </div>
                </div>
        {:else if category === 'roles' && accessibleCategories.includes('roles')}
                <GuildRolesManager />
	{:else if category === 'moderation' && accessibleCategories.includes('moderation')}
		<p>{m.moderation()}...</p>
	{:else if category === 'invites' && accessibleCategories.includes('invites')}
		<GuildInvitesManager />
	{:else if category === 'integrations' && accessibleCategories.includes('integrations')}
		<p>{m.integrations()}...</p>
	{/if}
</SettingsPanel>
