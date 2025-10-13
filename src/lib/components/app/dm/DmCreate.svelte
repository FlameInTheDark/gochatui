<script lang="ts">
        import { auth } from '$lib/stores/auth';
        import { selectedChannelId, selectedGuildId } from '$lib/stores/appState';
        import { subscribeWS } from '$lib/client/ws';
        import { m } from '$lib/paraglide/messages.js';
        import { MessageCirclePlus } from 'lucide-svelte';
	let open = $state(false);
	let singleId = $state('');
	let groupIds = $state('');
	let error: string | null = $state(null);
	let loading = $state(false);

	async function createSingle() {
		if (!singleId) return;
		loading = true;
		error = null;
		try {
			const res = await auth.api.user.userMeChannelsPost({
				userCreateDMRequest: { recipient_id: singleId as any }
			});
			const ch: any = res.data;
			if (ch?.id) {
				const id = String(ch.id);
				selectedChannelId.set(id);
				const gid = $selectedGuildId; // may be null for DM
				subscribeWS(gid ? [gid] : [], id);
			}
			open = false;
			singleId = '';
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'Failed to create DM';
		} finally {
			loading = false;
		}
	}

	async function createGroup() {
		const ids = groupIds
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (ids.length === 0) return;
		loading = true;
		error = null;
		try {
			const res = await auth.api.user.userMeChannelsGroupPost({
				userCreateDMManyRequest: { recipients_id: ids as any }
			});
			const ch: any = res.data;
			if (ch?.id) {
				const id = String(ch.id);
				selectedChannelId.set(id);
				const gid = $selectedGuildId;
				subscribeWS(gid ? [gid] : [], id);
			}
			open = false;
			groupIds = '';
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'Failed to create group DM';
		} finally {
			loading = false;
		}
	}
</script>

<div>
        <button
                class="grid h-8 w-8 place-items-center rounded-md border border-[var(--stroke)] hover:bg-[var(--panel)]"
                onclick={() => (open = true)}
                aria-label={m.new_dm()}
        >
                <MessageCirclePlus class="h-4 w-4" stroke-width={2} />
        </button>
	{#if open}
		<div
			class="fixed inset-0 z-40 grid place-items-center bg-black/40"
			role="button"
			tabindex="0"
			onclick={() => (open = false)}
			onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && (open = false)}
		>
			<div
				class="panel w-full max-w-md p-4"
				role="dialog"
				tabindex="-1"
				onpointerdown={(e) => e.stopPropagation()}
			>
				<div class="mb-2 text-sm font-medium">{m.create_dm()}</div>
				{#if error}<div class="mb-2 text-sm text-red-500">{error}</div>{/if}
				<div class="space-y-2">
					<div>
						<div class="mb-1 text-xs text-[var(--muted)]">{m.recipient_user_id()}</div>
						<input
							type="number"
							class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
							bind:value={singleId}
						/>
						<div class="mt-2 flex justify-end">
							<button
								class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)] disabled:opacity-50"
								disabled={loading}
								onclick={createSingle}>{m.create_dm()}</button
							>
						</div>
					</div>
					<div class="border-t border-[var(--stroke)] pt-2">
						<div class="mb-1 text-xs text-[var(--muted)]">{m.group_recipients()}</div>
						<input
							type="text"
							class="w-full rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2"
							bind:value={groupIds}
						/>
						<div class="mt-2 flex justify-end">
							<button
								class="rounded-md bg-[var(--brand)] px-3 py-1 text-[var(--bg)] disabled:opacity-50"
								disabled={loading}
								onclick={createGroup}>{m.create_group_dm()}</button
							>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
