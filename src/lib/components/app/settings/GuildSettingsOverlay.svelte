<script lang="ts">
        import { guildSettingsOpen, selectedGuildId } from '$lib/stores/appState';
        import { auth } from '$lib/stores/auth';
        import { m } from '$lib/paraglide/messages.js';
        import GuildInvitesManager from './GuildInvitesManager.svelte';
        import GuildRolesManager from './GuildRolesManager.svelte';
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
                if (
                        hasAnyGuildPermission(
                                guild,
                                $me?.id,
                                PERMISSION_MANAGE_ROLES,
                                PERMISSION_MANAGE_GUILD
                        )
                ) {
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
                        hasAnyGuildPermission(
                                guild,
                                $me?.id,
                                PERMISSION_MANAGE_GUILD,
                                PERMISSION_MANAGE_CHANNELS
                        )
                ) {
                        allowed.push('integrations');
                }
                return allowed;
        });
        let category = $state<SettingsCategory>('profile');
        let name = $state('');
        let saving = $state(false);
        let error: string | null = $state(null);

        $effect(() => {
                if ($guildSettingsOpen) {
                        const current = activeGuild;
                        name = current?.name ?? '';
                        error = null;
                        saving = false;
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
                        await auth.api.guild.guildGuildIdPatch({
                                guildId: BigInt(gid) as any,
                                guildUpdateGuildRequest: { name }
                        });
                        await auth.loadGuilds();
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'Failed to save';
		} finally {
			saving = false;
		}
	}

	function close() {
		guildSettingsOpen.set(false);
	}
</script>

<svelte:window on:keydown={(e) => $guildSettingsOpen && e.key === 'Escape' && close()} />
{#if $guildSettingsOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		onpointerdown={close}
	>
		<div
			class="relative flex h-[80vh] w-full max-w-3xl overflow-hidden rounded-lg bg-[var(--bg)] shadow-xl"
			onpointerdown={(e) => e.stopPropagation()}
		>
			<button
				aria-label={m.close()}
				class="absolute top-3 right-3 rounded p-1 text-xl leading-none hover:bg-[var(--panel)]"
				onclick={close}
			>
				&times;
			</button>
                        <aside class="w-48 space-y-2 border-r border-[var(--stroke)] p-4">
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
                                                class="w-full rounded px-2 py-1 text-left hover:bg-[var(--panel)] {category === 'integrations'
                                                        ? 'bg-[var(--panel)] font-semibold'
                                                        : ''}"
                                                onclick={() => (category = 'integrations')}
                                        >
                                                {m.integrations()}
                                        </button>
                                {/if}
                        </aside>
                        <section class="flex-1 space-y-4 overflow-y-auto p-4">
                                {#if category === 'profile' && accessibleCategories.includes('profile')}
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
                                {:else if category === 'roles' && accessibleCategories.includes('roles')}
                                        <GuildRolesManager />
                                {:else if category === 'moderation' && accessibleCategories.includes('moderation')}
                                        <p>{m.moderation()}...</p>
                                {:else if category === 'invites' && accessibleCategories.includes('invites')}
                                        <GuildInvitesManager />
                                {:else if category === 'integrations' && accessibleCategories.includes('integrations')}
                                        <p>{m.integrations()}...</p>
                                {/if}
                        </section>
		</div>
	</div>
{/if}
