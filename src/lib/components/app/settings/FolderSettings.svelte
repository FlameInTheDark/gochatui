<script lang="ts">
        import { m } from '$lib/paraglide/messages.js';
        import { appSettings, mutateAppSettings, type GuildFolderItem } from '$lib/stores/settings';
        import { colorIntToHex } from '$lib/utils/color';
        import { tick, untrack } from 'svelte';

	type FolderDraft = {
		name: string;
		color: string;
		error: string | null;
	};

        const { focusRequest } = $props<{
                focusRequest: {
                        folderId: string;
                        requestId: number;
                } | null;
        }>();

        let drafts = $state<Record<string, FolderDraft>>({});
        let handledFocusRequestId: number | null = null;

	const normalizeHex = (value: string): string => {
		const raw = value.startsWith('#') ? value.slice(1) : value;
		const sanitized = raw.replace(/[^0-9a-f]/gi, '').slice(0, 6);
		return `#${sanitized.padEnd(6, '0').toUpperCase()}`;
	};

	const hexToColorInt = (hex: string): number => {
		const sanitized = hex.startsWith('#') ? hex.slice(1) : hex;
		const parsed = Number.parseInt(sanitized, 16);
		return Number.isFinite(parsed) ? parsed : 0;
	};

	const validateName = (value: string): string | null => {
		if (!value.trim()) {
			return m.folder_name_required();
		}
		return null;
	};

        const ensureDraftsForFolders = (folders: GuildFolderItem[]) => {
                const currentDrafts = untrack(() => drafts);
                const next: Record<string, FolderDraft> = {};
                let changed = false;

                for (const folder of folders) {
                        const existing = currentDrafts[folder.id];
                        const computed: FolderDraft = {
                                name: existing?.name ?? folder.name ?? '',
                                color: existing?.color ?? colorIntToHex(folder.color),
                                error: existing?.error ?? null
                        };

                        if (
                                !existing ||
                                existing.name !== computed.name ||
                                existing.color !== computed.color ||
                                existing.error !== computed.error
                        ) {
                                changed = true;
                        }

                        next[folder.id] = computed;
                }

                if (!changed) {
                        for (const key of Object.keys(currentDrafts)) {
                                if (!(key in next)) {
                                        changed = true;
                                        break;
                                }
                        }
                }

                if (changed) {
                        drafts = next;
                }
        };

	const saveFolder = (folder: GuildFolderItem) => {
		const draft = drafts[folder.id];
		if (!draft) return;

		const trimmedName = draft.name.trim();
		const error = validateName(trimmedName);
		drafts[folder.id] = { ...draft, name: trimmedName, error };
		if (error) return;

		const normalizedColor = normalizeHex(draft.color);
		drafts[folder.id] = { ...drafts[folder.id], color: normalizedColor };

		mutateAppSettings((settings) => {
			const target = settings.guildLayout.find(
				(item): item is GuildFolderItem => item.kind === 'folder' && item.id === folder.id
			);
			if (!target) return false;

			const nextName = trimmedName;
			const nextColor = hexToColorInt(normalizedColor);
			const currentName = target.name ?? '';
			const currentColor =
				typeof target.color === 'number' && Number.isFinite(target.color) ? target.color : 0;

			if (currentName === nextName && currentColor === nextColor) {
				return false;
			}

			target.name = nextName;
			target.color = nextColor;
			return true;
		});
	};

	const folders = $derived(
		$appSettings.guildLayout.filter((item): item is GuildFolderItem => item.kind === 'folder')
	);

	const draftIsDirty = (folder: GuildFolderItem, draft: FolderDraft): boolean => {
		const name = draft.name.trim();
		const color = hexToColorInt(draft.color);
		const currentName = folder.name ?? '';
		const currentColor = folder.color ?? 0;
		return name !== currentName || color !== currentColor;
	};

        $effect(() => {
                ensureDraftsForFolders(folders);
        });

        $effect(() => {
                const request = focusRequest;
                if (!request) return;
                if (request.requestId === handledFocusRequestId) return;
                if (typeof document === 'undefined') return;
                const folderExists = folders.some((folder) => folder.id === request.folderId);
                handledFocusRequestId = request.requestId;
                if (!folderExists) {
                        return;
                }
                void (async () => {
                        await tick();
                        const input = document.getElementById(
                                `folder-name-${request.folderId}`
                        ) as HTMLInputElement | null;
                        if (input) {
                                input.focus();
                                input.select();
                                input.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }
                })();
        });
</script>

<section class="space-y-4">
	<header class="space-y-1">
		<h2 class="text-xl font-semibold">{m.folder_settings()}</h2>
		<p class="text-sm text-[var(--muted)]">{m.folder_settings_description()}</p>
	</header>

	{#if folders.length === 0}
		<p class="text-sm text-[var(--muted)]">{m.folder_settings_empty()}</p>
	{:else}
		<div class="space-y-6">
			{#each folders as folder (folder.id)}
				{#if drafts[folder.id]}
					<div class="space-y-4 rounded-lg border border-[var(--stroke)] bg-[var(--panel)] p-4">
						<div>
							<label class="mb-1 block text-sm font-medium" for={`folder-name-${folder.id}`}>
								{m.folder_name()}
							</label>
							<input
								id={`folder-name-${folder.id}`}
								type="text"
								class="w-full rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 focus:border-[var(--brand)] focus:outline-none"
								value={drafts[folder.id].name}
								oninput={(event) => {
									drafts[folder.id].name = event.currentTarget.value;
									drafts[folder.id].error = null;
								}}
								onblur={() => saveFolder(folder)}
								placeholder={m.folder_name_placeholder()}
							/>
							{#if drafts[folder.id].error}
								<p class="mt-1 text-sm text-[var(--danger)]">
									{drafts[folder.id].error}
								</p>
							{/if}
						</div>

						<div>
							<label class="mb-1 block text-sm font-medium" for={`folder-color-${folder.id}`}>
								{m.folder_color()}
							</label>
							<div class="flex items-center gap-3">
								<input
									id={`folder-color-${folder.id}`}
									type="color"
									class="h-10 w-16 cursor-pointer rounded border border-[var(--stroke)] bg-[var(--panel-strong)]"
									value={drafts[folder.id].color}
									oninput={(event) => {
										drafts[folder.id].color = event.currentTarget.value.toUpperCase();
									}}
									onchange={() => {
										drafts[folder.id].color = normalizeHex(drafts[folder.id].color);
										saveFolder(folder);
									}}
								/>
								<input
									type="text"
									class="w-28 rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 font-mono text-sm focus:border-[var(--brand)] focus:outline-none"
									value={drafts[folder.id].color}
									oninput={(event) => {
										drafts[folder.id].color = event.currentTarget.value.toUpperCase();
									}}
									onblur={() => {
										drafts[folder.id].color = normalizeHex(drafts[folder.id].color);
										saveFolder(folder);
									}}
								/>
							</div>
						</div>

						<div class="flex justify-end">
							{#if drafts[folder.id]}
								{#if draftIsDirty(folder, drafts[folder.id])}
									<button
										class="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-strong)]"
										onclick={() => saveFolder(folder)}
									>
										{m.save()}
									</button>
								{:else}
									<button
										class="cursor-default rounded bg-[var(--panel-strong)] px-4 py-2 text-sm text-[var(--muted)]"
										disabled
									>
										{m.save()}
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</section>
