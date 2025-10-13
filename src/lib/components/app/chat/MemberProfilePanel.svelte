<script lang="ts">
        import type { DtoMember, DtoRole, DtoUser } from '$lib/api';
        import { memberProfilePanel } from '$lib/stores/memberProfilePanel';
        import { presenceByUser, presenceIndicatorClass } from '$lib/stores/presence';
        import { loadGuildRolesCached } from '$lib/utils/guildRoles';
        import { colorIntToHex } from '$lib/utils/color';
        import {
                buildRoleMap,
                collectMemberRoleIds,
                memberInitial,
                memberPrimaryName,
                memberSecondaryName,
                resolveMemberRoleColor,
                toSnowflakeString
        } from '$lib/utils/members';
        import { presenceStatusLabel } from '$lib/utils/presenceLabels';
        import { buildAttachmentUrl } from '$lib/utils/cdn';
        import { m } from '$lib/paraglide/messages.js';
        import { tick } from 'svelte';

        let panelEl: HTMLDivElement | null = $state(null);
        let posX = $state(0);
        let posY = $state(0);
        let roleMap = $state<Record<string, DtoRole>>({});
        let rolesLoading = $state(false);
        let rolesError = $state<string | null>(null);

        const presenceMap = presenceByUser;

        function closePanel() {
                memberProfilePanel.close();
        }

        function resolveMember(): DtoMember | null {
                return $memberProfilePanel.member ?? null;
        }

        function resolveUser(): DtoUser | null {
                const memberUser = ($memberProfilePanel.member as any)?.user ?? null;
                return memberUser ?? ($memberProfilePanel.user ?? null);
        }

        function updatePosition(anchor: { x: number; y: number; width: number; height: number } | null) {
                if (typeof window === 'undefined') return;
                const pad = 8;
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const fallback = { width: 320, height: 240 };
                const rect = panelEl?.getBoundingClientRect() ?? (fallback as DOMRect);
                if (!anchor) {
                        const centeredX = (vw - rect.width) / 2;
                        const centeredY = (vh - rect.height) / 2;
                        posX = Math.max(pad, Math.min(vw - rect.width - pad, centeredX));
                        posY = Math.max(pad, Math.min(vh - rect.height - pad, centeredY));
                        return;
                }
                let x = anchor.x + anchor.width + 12;
                let y = anchor.y;
                if (x + rect.width + pad > vw) {
                        x = anchor.x - rect.width - 12;
                }
                if (x < pad) {
                        x = pad;
                }
                if (y + rect.height + pad > vh) {
                        y = vh - rect.height - pad;
                }
                if (y < pad) {
                        y = pad;
                }
                posX = x;
                posY = y;
        }

        async function ensureRoleMap(guildId: string | null) {
                if (!guildId) {
                        roleMap = {};
                        return;
                }
                rolesLoading = true;
                rolesError = null;
                try {
                        const roles = await loadGuildRolesCached(guildId);
                        roleMap = buildRoleMap(roles);
                } catch (error) {
                        rolesError = (error as { message?: string })?.message ?? null;
                        roleMap = {};
                } finally {
                        rolesLoading = false;
                        Promise.resolve()
                                .then(tick)
                                .then(() => updatePosition($memberProfilePanel.anchor));
                }
        }

        $effect(() => {
                const { open, anchor, guildId } = $memberProfilePanel;
                if (!open) {
                        roleMap = {};
                        return;
                }
                ensureRoleMap(guildId ?? null);
                Promise.resolve()
                        .then(tick)
                        .then(() => updatePosition(anchor));
        });

        const selectedMember = $derived(resolveMember());
        const selectedUser = $derived(resolveUser());

        const userId = $derived.by(() =>
                toSnowflakeString((selectedMember as any)?.user?.id) ??
                toSnowflakeString((selectedMember as any)?.id) ??
                toSnowflakeString((selectedUser as any)?.id)
        );

        const presenceInfo = $derived.by(() => (userId ? $presenceMap[userId] ?? null : null));
        const presenceStatus = $derived.by(() => presenceInfo?.status ?? null);
        const customStatusText = $derived.by(() => presenceInfo?.customStatusText ?? null);
        const statusLabel = $derived.by(() => presenceStatusLabel(presenceStatus, customStatusText));
        const hasPresence = $derived.by(() => Boolean(presenceInfo));

        const primaryName = $derived.by(() => {
                const member = selectedMember;
                if (member) {
                        return memberPrimaryName(member);
                }
                const user = selectedUser;
                const userName = (user as any)?.name;
                if (typeof userName === 'string' && userName.trim()) {
                        return userName.trim();
                }
                const id = toSnowflakeString((user as any)?.id);
                if (id) {
                        return `${m.user_default_name()} ${id}`;
                }
                return m.user_default_name();
        });

        const secondaryName = $derived.by(() => {
                const member = selectedMember;
                if (member) {
                        return memberSecondaryName(member);
                }
                const user = selectedUser;
                const username = (user as any)?.name;
                if (typeof username === 'string') {
                        const trimmed = username.trim();
                        if (trimmed && trimmed !== primaryName) {
                                return trimmed;
                        }
                }
                return '';
        });

        const discriminator = $derived.by(() => {
                const memberDisc = (selectedMember as any)?.user?.discriminator;
                if (typeof memberDisc === 'string' && memberDisc.trim()) {
                        return memberDisc.trim();
                }
                const userDisc = (selectedUser as any)?.discriminator;
                if (typeof userDisc === 'string' && userDisc.trim()) {
                        return userDisc.trim();
                }
                return '';
        });

        const avatarId = $derived.by(() =>
                toSnowflakeString((selectedMember as any)?.avatar) ??
                toSnowflakeString((selectedMember as any)?.user?.avatar) ??
                toSnowflakeString((selectedUser as any)?.avatar)
        );
        const avatarUrl = $derived.by(() => (avatarId ? buildAttachmentUrl(avatarId) : null));

        const guildId = $derived.by(() => $memberProfilePanel.guildId ?? null);

        const roleEntries = $derived.by(() => {
                const member = selectedMember;
                if (!member) return [] as { id: string; name: string; color: string | null }[];
                const gid = guildId;
                const ids = collectMemberRoleIds(member, gid);
                const entries: { id: string; name: string; color: string | null }[] = [];
                const seen = new Set<string>();
                for (const id of ids) {
                        if (!id || seen.has(id)) continue;
                        seen.add(id);
                        const role = roleMap[id];
                        const name = ((role as any)?.name ?? '').toString().trim();
                        const rawColor = (role as any)?.color;
                        const color = rawColor == null
                                ? null
                                : colorIntToHex(rawColor as number | string | bigint | null);
                        entries.push({
                                id,
                                name: name || (gid && id === gid ? '@everyone' : `@${id}`),
                                color
                        });
                }
                return entries;
        });

        const topRoleColor = $derived.by(() => {
                const member = selectedMember;
                const gid = guildId;
                if (!member) return null;
                return resolveMemberRoleColor(member, gid, roleMap);
        });

        const avatarInitial = $derived.by(() => {
                const member = selectedMember;
                if (member) {
                        return memberInitial(member);
                }
                const user = selectedUser;
                const userName = (user as any)?.name;
                if (typeof userName === 'string' && userName.trim()) {
                        return userName.trim().charAt(0).toUpperCase();
                }
                return memberInitial(null);
        });

        function handleKeydown(event: KeyboardEvent) {
                if (event.key === 'Escape') {
                        event.preventDefault();
                        closePanel();
                }
        }

        function isEventInsidePanel(target: EventTarget | null) {
                if (!panelEl) return false;
                if (!(target instanceof Node)) return false;
                return panelEl.contains(target);
        }

        function handleWindowPointerDown(event: PointerEvent) {
                if (!$memberProfilePanel.open) return;
                if (event.button !== 0 && event.pointerType === 'mouse') {
                        return;
                }
                if (!isEventInsidePanel(event.target)) {
                        closePanel();
                }
        }

        function handleWindowContextMenu(event: MouseEvent) {
                if (!$memberProfilePanel.open) return;
                if (isEventInsidePanel(event.target)) {
                        return;
                }
                event.preventDefault();
                event.stopPropagation();
                closePanel();
        }
</script>

<svelte:window
        on:keydown={handleKeydown}
        on:pointerdown={handleWindowPointerDown}
        on:contextmenu={handleWindowContextMenu}
/>

{#if $memberProfilePanel.open && (selectedMember || selectedUser)}
        <div class="pointer-events-none fixed inset-0 z-40" aria-hidden={false}>
                <div
                        bind:this={panelEl}
                        class="pointer-events-auto absolute w-80 rounded-lg border border-[var(--stroke)] bg-[var(--panel-strong)] p-4 text-sm text-[var(--text)] shadow-[var(--shadow-2)] backdrop-blur-md"
                        style:left={`${posX}px`}
                        style:top={`${posY}px`}
                        style:background={'color-mix(in srgb, var(--panel-strong) 92%, transparent)'}
                        role="dialog"
                        aria-modal="false"
                >
                        <div class="flex items-start gap-3">
                                <div class="relative h-16 w-16 shrink-0">
                                        <div class="grid h-full w-full place-items-center overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--panel)] text-lg font-semibold">
                                                {#if avatarUrl}
                                                        <img alt={primaryName} class="h-full w-full object-cover" src={avatarUrl} />
                                                {:else}
                                                        <span>{avatarInitial}</span>
                                                {/if}
                                        </div>
                                        <span
                                                class={`absolute -right-0.5 -bottom-0.5 h-4 w-4 rounded-full border-2 border-[var(--panel-strong)] ${presenceIndicatorClass(presenceStatus)}`}
                                                class:opacity-50={!hasPresence}
                                        />
                                </div>
                                <div class="min-w-0 flex-1 space-y-1">
                                        <div class="truncate text-lg font-semibold" style:color={topRoleColor ?? null}>
                                                {primaryName}
                                        </div>
                                        {#if secondaryName || discriminator}
                                                <div class="truncate text-xs text-[var(--muted)]">
                                                        {#if secondaryName}
                                                                <span>{secondaryName}</span>
                                                        {/if}
                                                        {#if discriminator && (!secondaryName || secondaryName !== discriminator)}
                                                                {#if secondaryName}
                                                                        <span class="mx-1">&bull;</span>
                                                                {/if}
                                                                <span>#{discriminator}</span>
                                                        {/if}
                                                </div>
                                        {/if}
                                        <div class="text-xs text-[var(--muted)]">{statusLabel}</div>
                                </div>
                                <button
                                        class="ml-2 rounded-md p-1 text-lg leading-none text-[var(--muted)] hover:bg-[var(--panel)]"
                                        type="button"
                                        aria-label={m.close()}
                                        on:click={closePanel}
                                        data-tooltip-disabled
                                >
                                        &times;
                                </button>
                        </div>
                        {#if guildId && selectedMember}
                                <div class="mt-4">
                                        <div class="text-xs font-semibold uppercase text-[var(--muted)]">
                                                {m.ctx_roles_menu()}
                                        </div>
                                        {#if rolesLoading}
                                                <div class="mt-2 text-xs text-[var(--muted)]">{m.ctx_roles_loading()}</div>
                                        {:else if rolesError}
                                                <div class="mt-2 text-xs text-[var(--danger)]">{rolesError}</div>
                                        {:else if roleEntries.length === 0}
                                                <div class="mt-2 text-xs text-[var(--muted)]">{m.ctx_roles_empty()}</div>
                                        {:else}
                                                <div class="mt-2 flex flex-wrap gap-2">
                                                        {#each roleEntries as role (role.id)}
                                                                <span
                                                                        class="rounded-full border border-[var(--stroke)] bg-[var(--panel)] px-2 py-1 text-xs font-medium"
                                                                        style:color={role.color ?? null}
                                                                >
                                                                        {role.name}
                                                                </span>
                                                        {/each}
                                                </div>
                                        {/if}
                                </div>
                        {/if}
                </div>
        </div>
{/if}
