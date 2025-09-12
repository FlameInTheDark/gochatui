<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import {
		selectedGuildId,
		channelsByGuild,
		selectedChannelId,
		lastChannelByGuild,
		channelReady
	} from '$lib/stores/appState';
	import { subscribeWS } from '$lib/client/ws';
	import { contextMenu, copyToClipboard } from '$lib/stores/contextMenu';
	const guilds = auth.guilds;
	import { m } from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
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

	// Helpers to persist last visited channel per guild safely
	function readLastChannels(): Record<string, string> {
		try {
			const raw = localStorage.getItem('lastChannels');
			const obj = raw ? JSON.parse(raw) : {};
			const out: Record<string, string> = {};
			for (const k in obj) out[String(k)] = String(obj[k]);
			return out;
		} catch {
			return {};
		}
	}
	function writeLastChannel(gid: string, channelId: string) {
		try {
			const saved = readLastChannels();
			saved[String(gid)] = String(channelId);
			localStorage.setItem('lastChannels', JSON.stringify(saved));
		} catch {}
	}

	let switchToken = 0;

	async function selectGuild(id: string | undefined | null) {
		if (!id) return;
		const gid = String(id);
		const myToken = ++switchToken;
		// Clear previous selection before switching guild to avoid cross-guild requests
		channelReady.set(false);
		selectedChannelId.set(null);
		selectedGuildId.set(gid);
		try {
			localStorage.setItem('lastGuild', gid);
		} catch {}
		try {
			const res = await auth.api.guild.guildGuildIdChannelGet({ guildId: gid as any });
			const list = res.data ?? [];
			// If user switched guilds during fetch, ignore this result
			if ($selectedGuildId !== gid || myToken !== switchToken) return;
			channelsByGuild.update((m) => ({ ...m, [gid]: list }));
			// Filter text channels only (type === 0)
			const textChannels = list.filter((c: any) => c?.type === 0);

			// Prefer last visited channel for this guild, if still present and is text
			let targetId: string | null = null;
			let remembered = readLastChannels()?.[gid] || '';
			if (!remembered) {
				const map = $lastChannelByGuild;
				remembered = map[gid];
			}
			const rememberedOk =
				remembered && textChannels.some((c: any) => String(c?.id) === remembered);
			if (rememberedOk) {
				targetId = remembered;
			} else if (textChannels.length > 0) {
				// Auto-select first text channel
				targetId = String((textChannels[0] as any).id);
			} else {
				// No text channels; do not select any
				targetId = null;
			}
			if (targetId && $selectedGuildId === gid && myToken === switchToken) {
				selectedChannelId.set(targetId);
				subscribeWS([gid], targetId);
				// Remember this as last visited for next time (only for this gid)
				lastChannelByGuild.update((map) => ({ ...map, [gid]: targetId! }));
				channelReady.set(true);
				writeLastChannel(gid, targetId);
			}
		} catch (e) {
			// ignore
		}
	}

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

	async function renameGuildDirect(gid: string, currentName: string) {
		const name = prompt(m.rename_server_prompt(), currentName || '');
		if (!name) return;
		try {
			await auth.api.guild.guildGuildIdPatch({
				guildId: gid as any,
				guildUpdateGuildRequest: { name }
			});
			await auth.loadGuilds();
		} catch {}
	}
</script>

<div
	class="flex h-full w-[var(--col1)] flex-col items-center gap-2 overflow-hidden border-r border-[var(--stroke)] p-2"
>
	<div class="flex flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto pt-1">
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
						contextMenu.openFromEvent(e, [
							{ label: m.copy_server_id(), action: () => copyToClipboard(gid) },
							{ label: m.rename_server(), action: () => renameGuildDirect(gid, name) },
							{ label: m.leave_server(), action: () => leaveGuildDirect(gid), danger: true }
						]);
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
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				width="18"
				height="18"
				fill="currentColor"><path d="M11 5h2v14h-2z" /><path d="M5 11h14v2H5z" /></svg
			>
		</button>
	</div>

	{#if creating}
		<div
			class="fixed inset-0 z-50"
			role="dialog"
			tabindex="0"
			onclick={() => (creating = false)}
			onkeydown={(e) => {
				if (e.key === 'Escape' || e.key === 'Enter') creating = false;
			}}
		>
			<div class="absolute inset-0 bg-black/40"></div>
			<div
				class="panel absolute bottom-6 left-[var(--col1)] ml-4 w-64 p-3"
				role="document"
				tabindex="-1"
				onclick={(e) => e.stopPropagation()}
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
</div>
