<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { selectedGuildId, guildSettingsOpen } from '$lib/stores/appState';
        import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
        import type { ContextMenuItem } from '$lib/stores/contextMenu';
        const guilds = auth.guilds;
        import { m } from '$lib/paraglide/messages.js';
        import { onMount } from 'svelte';
        import { selectGuild } from '$lib/utils/guildSelection';
        import { Plus } from 'lucide-svelte';
        import {
                PERMISSION_MANAGE_CHANNELS,
                PERMISSION_MANAGE_GUILD,
                PERMISSION_MANAGE_ROLES,
                hasAnyGuildPermission
        } from '$lib/utils/permissions';
        const me = auth.user;

        function canAccessGuildSettings(guild: any): boolean {
                return hasAnyGuildPermission(
                        guild,
                        $me?.id,
                        PERMISSION_MANAGE_GUILD,
                        PERMISSION_MANAGE_ROLES,
                        PERMISSION_MANAGE_CHANNELS
                );
        }
	onMount(() => {
		const unsub = guilds.subscribe((arr) => {
			if (!$selectedGuildId && (arr?.length ?? 0) > 0) {
				let target = '';
				try {
					const saved = localStorage.getItem('lastGuild');
					if (saved) target = saved;
				} catch {}
				const exists = target && arr.some((g: any) => String(g?.id) === target);
				const pick = exists ? target : String((arr[0] as any)?.id || '');
				if (pick) {
					selectGuild(pick);
					try {
						localStorage.setItem('lastGuild', pick);
					} catch {}
				}
			}
		});
		return () => unsub();
	});

	let creating = $state(false);
	let newGuildName = $state('');
	let error: string | null = $state(null);
	let leavingGuild = $state<{ id: string; name: string } | null>(null);

	async function createGuild() {
		if (!newGuildName.trim()) return;
		try {
			await auth.api.guild.guildPost({ guildCreateGuildRequest: { name: newGuildName } });
			creating = false;
			newGuildName = '';
			error = null;
			await auth.loadGuilds();
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'Failed to create guild';
		}
	}

	async function leaveGuildDirect(gid: string) {
		try {
			await auth.api.user.userMeGuildsGuildIdDelete({ guildId: gid as any });
			await auth.loadGuilds();
		} catch {}
	}

	async function confirmLeaveGuild() {
		if (!leavingGuild) return;
		const { id } = leavingGuild;
		leavingGuild = null;
		await leaveGuildDirect(id);
		if ($selectedGuildId === id) {
			selectedGuildId.set(null);
		}
	}

        function openGuildSettings(gid: string) {
                const targetGuild = $guilds.find((g) => String((g as any)?.id) === gid);
                if (!canAccessGuildSettings(targetGuild)) return;
                selectGuild(gid);
                guildSettingsOpen.set(true);
        }
</script>

<div
	class="flex h-full w-[var(--col1)] flex-col items-center gap-2 overflow-hidden border-r border-[var(--stroke)] p-2"
>
        <div class="scroll-area flex flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto pt-1">
		{#each $guilds as g}
			<div class="group relative">
				<div
					class="absolute top-1/2 -left-2 w-1 -translate-y-1/2 rounded-full bg-[var(--brand)] transition-all {$selectedGuildId ===
					String((g as any).id)
						? 'h-6 opacity-100'
						: 'h-2 opacity-0 group-hover:h-4 group-hover:opacity-60'}"
				></div>
				<button
					class="flex h-12 w-12 transform items-center justify-center rounded-xl border border-[var(--stroke)] bg-[var(--panel-strong)] transition-all duration-150 hover:-translate-y-0.5 hover:scale-105 hover:bg-[var(--panel)] hover:ring-2 hover:ring-[var(--brand)] hover:ring-inset focus-visible:outline-none {$selectedGuildId ===
					String((g as any).id)
						? 'shadow ring-2 ring-[var(--brand)] ring-inset'
						: ''}"
					title={g.name}
					aria-current={$selectedGuildId === String((g as any).id) ? 'true' : 'false'}
					onclick={() => selectGuild(String((g as any).id))}
					oncontextmenu={(e) => {
						e.preventDefault();
						const gid = String((g as any).id);
						const name = String((g as any).name ?? 'Server');
                                                const menuItems: ContextMenuItem[] = [
                                                        { label: m.copy_server_id(), action: () => copyToClipboard(gid) }
                                                ];
                                                if (canAccessGuildSettings(g)) {
                                                        menuItems.push({
                                                                label: m.server_settings(),
                                                                action: async () => {
                                                                        openGuildSettings(gid);
                                                                }
                                                        });
                                                }
                                                menuItems.push({
                                                        label: m.leave_server(),
                                                        action: async () => {
                                                                leavingGuild = { id: gid, name };
                                                        },
                                                        danger: true
                                                });
                                                contextMenu.openFromEvent(e, menuItems);
                                        }}
                                >
					<span class="font-bold">{(g.name ?? '?').slice(0, 2).toUpperCase()}</span>
				</button>
			</div>
		{/each}
	</div>
	<div>
                <button
                        class="grid h-12 w-12 place-items-center rounded-xl border border-[var(--stroke)] hover:bg-[var(--panel)]"
                        onclick={() => (creating = !creating)}
                        title={m.new_server()}
                        aria-label={m.new_server()}
                >
                        <Plus class="h-[18px] w-[18px]" stroke-width={2} />
                </button>
	</div>

	{#if creating}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onpointerdown={() => (creating = false)}
			onkeydown={(e) => {
				if (e.key === 'Escape') creating = false;
				if (e.key === 'Enter') createGuild();
			}}
		>
                        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
			<div
				class="panel absolute top-1/2 left-1/2 w-64 -translate-x-1/2 -translate-y-1/2 p-3"
				role="document"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="mb-2 text-sm font-medium">{m.new_server()}</div>
				{#if error}<div class="mb-2 text-sm text-red-500">{error}</div>{/if}
				<input
					class="mb-2 w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
					placeholder={m.server_name()}
					bind:value={newGuildName}
				/>
				<div class="flex justify-end gap-2">
					<button
						class="rounded-md border border-[var(--stroke)] px-3 py-1"
						onclick={() => (creating = false)}>{m.cancel()}</button
					>
					<button
						class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)]"
						onclick={createGuild}>{m.create()}</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if leavingGuild}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onpointerdown={() => (leavingGuild = null)}
			onkeydown={(e) => {
				if (e.key === 'Escape') leavingGuild = null;
				if (e.key === 'Enter') confirmLeaveGuild();
			}}
		>
                        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
			<div
				class="panel absolute top-1/2 left-1/2 w-72 -translate-x-1/2 -translate-y-1/2 p-4"
				role="document"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="mb-2 text-base font-semibold">{m.leave_server_confirm_title({ server: leavingGuild.name })}</div>
				<p class="mb-4 text-sm text-[var(--muted)]">{m.leave_server_confirm_description({ server: leavingGuild.name })}</p>
				<div class="flex justify-end gap-2">
					<button
						class="rounded-md border border-[var(--stroke)] px-3 py-1"
						onclick={() => (leavingGuild = null)}
					>
						{m.cancel()}
					</button>
					<button
						class="rounded-md bg-[var(--danger)] px-3 py-1 text-[var(--bg)]"
						onclick={confirmLeaveGuild}
					>
						{m.leave_server()}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
