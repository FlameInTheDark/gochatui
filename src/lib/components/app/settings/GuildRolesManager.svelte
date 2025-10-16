<script lang="ts">
	import { selectedGuildId } from '$lib/stores/appState';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages.js';
	import type { DtoRole } from '$lib/api';
	import {
		invalidateGuildRolesCache,
		mergeGuildRoleCache,
		writeGuildRoleCache
	} from '$lib/utils/guildRoles';
	import { refreshGuildEffectivePermissions } from '$lib/utils/guildPermissionSync';
	import { PRESET_COLORS } from '$lib/constants/colorPresets';
	import {
		PERMISSION_CATEGORIES,
		type PermissionCategory,
		type PermissionDefinition
	} from '$lib/utils/permissionDefinitions';
	import { colorIntToHex, parseColorValue } from '$lib/utils/color';
	import { Palette } from 'lucide-svelte';

	type RoleDraft = {
		name: string;
		color: string;
		permissions: number;
	};

	const DEFAULT_ROLE_PERMISSIONS =
		(1 << 0) |
		(1 << 5) |
		(1 << 6) |
		(1 << 11) |
		(1 << 12) |
		(1 << 13) |
		(1 << 14) |
		(1 << 15) |
		(1 << 19) |
		(1 << 20) |
		(1 << 21) |
		(1 << 22);

	const DEFAULT_ROLE_COLOR = PRESET_COLORS[0];

	let roles = $state<DtoRole[]>([]);
	let loading = $state(false);
	let loadError: string | null = $state(null);
	let formError: string | null = $state(null);
	let saving = $state(false);
	let deletingId: string | null = $state(null);
	let editingRoleId = $state<string | 'new' | null>(null);
	let draft = $state<RoleDraft | null>(null);
	let initialDraft = $state<RoleDraft | null>(null);
	let hasChanges = $state(false);
	let canSave = $state(false);

	$effect(() => {
		if (!draft || !initialDraft) {
			hasChanges = false;
			return;
		}
		hasChanges =
			draft.name !== initialDraft.name ||
			draft.color !== initialDraft.color ||
			draft.permissions !== initialDraft.permissions;
	});

	$effect(() => {
		if (!draft || !hasChanges || saving) {
			canSave = false;
			return;
		}
		canSave = draft.name.trim().length > 0;
	});

	function getRoleId(role?: DtoRole | null): string | null {
		if (!role) return null;
		const id = (role as any).id;
		if (id === 0) return '0';
		if (!id) return null;
		return String(id);
	}

	function normalizeHex(hex: string | null | undefined): string {
		if (typeof hex !== 'string') return DEFAULT_ROLE_COLOR;
		const raw = hex.trim();
		if (raw.length === 0) return DEFAULT_ROLE_COLOR;
		const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
		const sanitized = withoutHash.replace(/[^0-9a-f]/gi, '').slice(0, 6);
		if (!sanitized) return DEFAULT_ROLE_COLOR;
		return `#${sanitized.padEnd(6, '0').toUpperCase()}`;
	}

	function colorsEqual(a: string, b: string): boolean {
		return normalizeHex(a) === normalizeHex(b);
	}

	function openColorPicker() {
		if (typeof document === 'undefined') return;
		const input = document.getElementById('role-color-picker') as HTMLInputElement | null;
		if (!input) return;
		if (typeof input.showPicker === 'function') {
			input.showPicker();
			return;
		}
		input.click();
	}

	function applyPresetColor(color: string) {
		updateDraft({ color: normalizeHex(color) });
	}

	function colorIntFromHex(hex: string): number {
		return parseColorValue(hex) ?? 0;
	}

	function roleDisplayName(role: DtoRole | null): string {
		const name = role?.name?.trim();
		return name && name.length > 0 ? name : m.role_default_role_name();
	}

	function roleColor(role: DtoRole): string {
		const id = getRoleId(role);
		if (id && editingRoleId && editingRoleId !== 'new' && draft && editingRoleId === id) {
			return normalizeHex(draft.color);
		}

		return normalizeHex(colorIntToHex(role?.color));
	}

	function createDraftFromRole(role?: DtoRole | null): RoleDraft {
		return {
			name: role?.name ?? '',
			color: normalizeHex(colorIntToHex(role?.color)),
			permissions: role?.permissions != null ? Number(role.permissions) : 0
		};
	}

	function createEmptyDraft(): RoleDraft {
		return {
			name: '',
			color: DEFAULT_ROLE_COLOR,
			permissions: DEFAULT_ROLE_PERMISSIONS
		};
	}

	function updateDraft(partial: Partial<RoleDraft>) {
		if (!draft) return;
		draft = { ...draft, ...partial };
	}

	async function loadRoles(): Promise<DtoRole[]> {
		if (!$selectedGuildId) {
			roles = [];
			return [];
		}
		const currentGuild = $selectedGuildId;
		loading = true;
		loadError = null;
		try {
			const res = await auth.api.guildRoles.guildGuildIdRolesGet({
				guildId: BigInt(currentGuild) as any
			});
			const list = (res.data ?? []) as DtoRole[];
			if (currentGuild === $selectedGuildId) {
				roles = list;
				writeGuildRoleCache(currentGuild, list);
				if (editingRoleId && editingRoleId !== 'new') {
					const active = list.find((r) => getRoleId(r) === editingRoleId);
					if (!active) {
						editingRoleId = null;
						draft = null;
						initialDraft = null;
					}
				}
			}
			return list;
		} catch (err: any) {
			if (currentGuild === $selectedGuildId) {
				loadError = err?.response?.data?.message ?? err?.message ?? m.role_error_loading();
			}
			return [];
		} finally {
			if (currentGuild === $selectedGuildId) {
				loading = false;
			}
		}
	}

	$effect(() => {
		const gid = $selectedGuildId;
		if (!gid) {
			roles = [];
			editingRoleId = null;
			draft = null;
			initialDraft = null;
			loadError = null;
			return;
		}
		void loadRoles();
	});

	function startEditingRole(role: DtoRole) {
		const base = createDraftFromRole(role);
		editingRoleId = getRoleId(role);
		draft = { ...base };
		initialDraft = { ...base };
		formError = null;
	}

	function startCreating() {
		editingRoleId = 'new';
		const base = createEmptyDraft();
		draft = { ...base };
		initialDraft = { ...base };
		formError = null;
	}

	function cancelEditing() {
		editingRoleId = null;
		draft = null;
		initialDraft = null;
		formError = null;
	}

	function resetDraft() {
		if (!initialDraft) return;
		draft = { ...initialDraft };
		formError = null;
	}

	function permissionEnabled(value: number): boolean {
		if (!draft) return false;
		return (draft.permissions & value) === value;
	}

	function togglePermission(value: number) {
		if (!draft) return;
		const enabled = permissionEnabled(value);
		const next = enabled ? draft.permissions & ~value : draft.permissions | value;
		draft = { ...draft, permissions: next };
	}

	function applyLocalRoleUpdate(id: string, update: Partial<DtoRole>) {
		roles = roles.map((role) => {
			const roleId = getRoleId(role);
			if (roleId && roleId === id) {
				return { ...role, ...update };
			}
			return role;
		});
		const guildId = $selectedGuildId;
		if (guildId) {
			mergeGuildRoleCache(guildId, id, update);
		}
	}

	async function saveRole() {
		if (!draft || !$selectedGuildId || saving || !hasChanges) return;
		const trimmedName = draft.name.trim();
		if (!trimmedName) {
			formError = m.role_error_name_required();
			return;
		}
		saving = true;
		formError = null;
		const normalizedColor = normalizeHex(draft.color);
		if (normalizedColor !== draft.color) {
			draft = { ...draft, color: normalizedColor };
		}
		const payload = {
			name: trimmedName,
			color: colorIntFromHex(normalizedColor),
			permissions: draft.permissions
		};
		try {
			if (editingRoleId === 'new') {
				const res = await auth.api.guildRoles.guildGuildIdRolesPost({
					guildId: BigInt($selectedGuildId) as any,
					guildCreateGuildRoleRequest: payload
				});
				if ($selectedGuildId) {
					invalidateGuildRolesCache($selectedGuildId);
					void refreshGuildEffectivePermissions($selectedGuildId);
				}
				const createdId = res.data?.id != null ? String(res.data.id) : null;
				const list = await loadRoles();
				if (createdId) {
					const created = list.find((role) => getRoleId(role) === createdId);
					if (created) {
						const base = createDraftFromRole(created);
						editingRoleId = createdId;
						draft = { ...base };
						initialDraft = { ...base };
					} else {
						cancelEditing();
					}
				} else {
					cancelEditing();
				}
			} else if (editingRoleId) {
				applyLocalRoleUpdate(editingRoleId, {
					color: payload.color,
					name: trimmedName,
					permissions: payload.permissions
				});
				await auth.api.guildRoles.guildGuildIdRolesRoleIdPatch({
					guildId: BigInt($selectedGuildId) as any,
					roleId: BigInt(editingRoleId) as any,
					guildPatchGuildRoleRequest: payload
				});
				if ($selectedGuildId) {
					invalidateGuildRolesCache($selectedGuildId);
					void refreshGuildEffectivePermissions($selectedGuildId);
				}
				const list = await loadRoles();
				const updated = list.find((role) => getRoleId(role) === editingRoleId);
				if (updated) {
					const base = createDraftFromRole(updated);
					draft = { ...base };
					initialDraft = { ...base };
				} else {
					cancelEditing();
				}
			}
		} catch (err: any) {
			formError = err?.response?.data?.message ?? err?.message ?? m.role_error_saving();
		} finally {
			saving = false;
		}
	}

	async function deleteRole(role: DtoRole) {
		const id = getRoleId(role);
		if (!id || !$selectedGuildId) return;
		const confirmed = window.confirm(m.role_confirm_delete({ name: roleDisplayName(role) }));
		if (!confirmed) return;
		deletingId = id;
		loadError = null;
		try {
			await auth.api.guildRoles.guildGuildIdRolesRoleIdDelete({
				guildId: BigInt($selectedGuildId) as any,
				roleId: BigInt(id) as any
			});
			if ($selectedGuildId) {
				invalidateGuildRolesCache($selectedGuildId);
				void refreshGuildEffectivePermissions($selectedGuildId);
			}
			if (editingRoleId === id) {
				cancelEditing();
			}
			await loadRoles();
		} catch (err: any) {
			loadError = err?.response?.data?.message ?? err?.message ?? m.role_error_deleting();
		} finally {
			deletingId = null;
		}
	}

	function isDefaultRole(role: DtoRole): boolean {
		const id = getRoleId(role);
		const gid = role?.guild_id != null ? String(role.guild_id) : null;
		return id != null && gid != null && id === gid;
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		void saveRole();
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-xl font-semibold">{m.role_manage_title()}</h2>
		<p class="mt-1 text-sm text-[var(--fg-muted)]">{m.role_manage_description()}</p>
	</div>
	<div class="grid gap-6 lg:grid-cols-[260px,1fr]">
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold tracking-wide text-[var(--fg-muted)] uppercase">
					{m.roles()}
				</h3>
				<button
					type="button"
					class="rounded bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white transition hover:bg-[var(--brand-strong)] disabled:opacity-60"
					onclick={startCreating}
					disabled={loading}
				>
					{m.role_add_button()}
				</button>
			</div>
			{#if loadError}
				<p class="text-sm text-red-500">{loadError}</p>
			{/if}
			{#if loading}
				<p class="text-sm text-[var(--fg-muted)]">{m.role_loading()}</p>
			{:else if roles.length === 0}
				<p class="text-sm text-[var(--fg-muted)]">{m.role_empty()}</p>
			{:else}
				<ul class="space-y-2">
					{#each roles as role (getRoleId(role) ?? role.name ?? '')}
						{@const id = getRoleId(role)}
						{@const selected = editingRoleId !== 'new' && editingRoleId === id}
						<li>
							<div
								class={`flex items-center gap-2 rounded border border-[var(--stroke)] bg-[var(--panel-strong)] p-2 transition ${
									selected ? 'border-[var(--brand)] ring-1 ring-[var(--brand)]' : ''
								}`}
							>
								<button
									type="button"
									class="flex flex-1 items-center gap-3 rounded px-2 py-1 text-left hover:bg-[var(--panel)] focus:outline-none"
									onclick={() => startEditingRole(role)}
								>
									<span
										class="h-4 w-4 shrink-0 rounded-full border border-[var(--stroke)]"
										style={`background-color: ${roleColor(role)};`}
									></span>
									<span class="flex-1 truncate text-sm font-medium">
										{roleDisplayName(role)}
									</span>
								</button>
								<button
									type="button"
									class="rounded px-2 py-1 text-sm font-medium text-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
									onclick={() => deleteRole(role)}
									disabled={deletingId === id || isDefaultRole(role)}
								>
									{deletingId === id ? m.role_deleting() : m.delete()}
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<div class="rounded border border-[var(--stroke)] bg-[var(--panel-strong)] p-4">
			{#if draft}
				{@const roleDraft = draft!}
				<form class="space-y-5" onsubmit={handleSubmit}>
					<div class="space-y-1">
						<label class="text-sm font-medium" for="role-name">{m.role_form_name_label()}</label>
						<input
							id="role-name"
							name="name"
							class="w-full rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
							value={roleDraft.name}
							placeholder={m.role_form_name_placeholder()}
							oninput={(event) =>
								updateDraft({ name: (event.currentTarget as HTMLInputElement).value })}
						/>
					</div>
					<div class="space-y-2">
						<label class="text-sm font-medium" for="role-color-text"
							>{m.role_form_color_label()}</label
						>
						<div class="flex flex-col gap-3">
							<div class="flex items-center gap-4">
								<button
									type="button"
									class={`relative flex h-16 w-16 items-center justify-center rounded-full border border-[var(--stroke)] transition-transform duration-150 hover:-translate-y-0.5 hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel-strong)] focus-visible:outline-none ${
										PRESET_COLORS.some((color) => colorsEqual(color, roleDraft.color))
											? ''
											: 'ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--panel-strong)]'
									}`}
									style={`background-color: ${normalizeHex(roleDraft.color)};`}
									aria-label={m.color_picker_custom()}
									onclick={openColorPicker}
								>
									<Palette class="h-6 w-6 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]" />
								</button>
								<div class="grid grid-cols-6 gap-2">
									{#each PRESET_COLORS as preset}
										<button
											type="button"
											class={`h-10 w-10 rounded-full border border-[var(--stroke)] transition-transform duration-150 hover:-translate-y-0.5 hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel-strong)] focus-visible:outline-none ${
												colorsEqual(roleDraft.color, preset)
													? 'ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--panel-strong)]'
													: ''
											}`}
											style={`background-color: ${preset};`}
											aria-label={`${m.role_form_color_label()} ${preset}`}
											onclick={() => applyPresetColor(preset)}
										></button>
									{/each}
								</div>
							</div>
							<div class="flex items-center gap-3">
								<input
									id="role-color-text"
									type="text"
									class="w-32 rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2 font-mono text-sm focus:border-[var(--brand)] focus:outline-none"
									value={roleDraft.color}
									oninput={(event) =>
										updateDraft({
											color: (event.currentTarget as HTMLInputElement).value.toUpperCase()
										})}
									onblur={(event) =>
										updateDraft({
											color: normalizeHex((event.currentTarget as HTMLInputElement).value)
										})}
								/>
							</div>
							<input
								id="role-color-picker"
								type="color"
								class="sr-only"
								value={normalizeHex(roleDraft.color)}
								oninput={(event) =>
									updateDraft({
										color: (event.currentTarget as HTMLInputElement).value.toUpperCase()
									})}
								onchange={(event) =>
									updateDraft({
										color: normalizeHex((event.currentTarget as HTMLInputElement).value)
									})}
							/>
						</div>
						<p class="text-xs text-[var(--fg-muted)]">{m.role_form_color_hint()}</p>
					</div>
					<div class="space-y-3">
						<div>
							<h3 class="text-sm font-semibold">{m.role_form_permissions_label()}</h3>
							<p class="text-xs text-[var(--fg-muted)]">{m.role_form_permissions_hint()}</p>
						</div>
						<div class="space-y-5">
							{#each PERMISSION_CATEGORIES as category}
								<div
									class="space-y-3 border-t border-[var(--stroke)] pt-3 first:border-t-0 first:pt-0"
								>
									<h4 class="text-sm font-semibold">{category.label()}</h4>
									<div class="space-y-2">
										{#each category.permissions as perm}
											{@const enabled = permissionEnabled(perm.value)}
											<div
												class="flex items-center justify-between gap-4 rounded border border-[var(--stroke)] bg-[var(--panel)] px-3 py-2"
											>
												<div class="min-w-0">
													<p class="text-sm font-medium">{perm.label()}</p>
													<p class="text-xs text-[var(--fg-muted)]">{perm.description()}</p>
												</div>
												<button
													type="button"
													role="switch"
													aria-checked={enabled}
													class={`relative h-6 w-12 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel-strong)] ${
														enabled
															? 'border-[var(--brand)] bg-[var(--brand)]'
															: 'border-[var(--stroke)] bg-[var(--panel-strong)]'
													}`}
													onclick={() => togglePermission(perm.value)}
												>
													<span class="sr-only">{perm.label()}</span>
													<span
														class={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
															enabled ? 'translate-x-6' : 'translate-x-0'
														}`}
													></span>
												</button>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
					{#if formError}
						<p class="text-sm text-red-500">{formError}</p>
					{/if}
					{#if hasChanges}
						<p class="text-xs text-[var(--brand)]">{m.role_unsaved_changes()}</p>
					{/if}
					<div class="flex flex-wrap gap-2">
						<button
							type="submit"
							class="rounded bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:opacity-60"
							disabled={!canSave}
						>
							{saving ? m.saving() : m.role_save_changes()}
						</button>
						<button
							type="button"
							class="rounded border border-[var(--stroke)] px-4 py-2 text-sm font-semibold hover:bg-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-60"
							onclick={resetDraft}
							disabled={!hasChanges || saving}
						>
							{m.role_reset_changes()}
						</button>
						<button
							type="button"
							class="rounded border border-transparent px-4 py-2 text-sm font-semibold text-[var(--fg-muted)] hover:bg-[var(--panel)]"
							onclick={cancelEditing}
							disabled={saving}
						>
							{m.cancel()}
						</button>
					</div>
				</form>
			{:else}
				<div
					class="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--fg-muted)]"
				>
					{m.role_no_selection()}
				</div>
			{/if}
		</div>
	</div>
</div>
