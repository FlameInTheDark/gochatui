export type ChannelOverride = { accept: number; deny: number };

export type ChannelOverrideMap = Record<string, ChannelOverride>;

function applyOverride(
        allowed: boolean,
        override: ChannelOverride | undefined,
        viewPermissionBit: number
): boolean {
        if (!override) return allowed;
        let result = allowed;
        if ((override.deny & viewPermissionBit) === viewPermissionBit) {
                result = false;
        }
        if ((override.accept & viewPermissionBit) === viewPermissionBit) {
                result = true;
        }
        return result;
}

export function applyViewChannelOverrides(
        initialAllowed: boolean,
        roleIds: string[],
        guildId: string | null,
        overrides: ChannelOverrideMap,
        viewPermissionBit: number
): boolean {
        let allowed = initialAllowed;
        const seen = new Set<string>();

        const applyForRole = (roleId: string | null | undefined) => {
                if (!roleId) return;
                if (seen.has(roleId)) return;
                seen.add(roleId);
                allowed = applyOverride(allowed, overrides[roleId], viewPermissionBit);
        };

        applyForRole(guildId);
        for (const roleId of roleIds) {
                applyForRole(roleId);
        }

        return allowed;
}

export function finalChannelAccessDecision(
        baseAllowed: boolean,
        basePermissions: number,
        administratorBit: number,
        guildOwnerId: string | null,
        memberId: string | null,
        channelIsPrivate: boolean
): boolean {
        let allowed = baseAllowed;

        if (!allowed) {
                if (basePermissions & administratorBit) {
                        allowed = true;
                } else if (guildOwnerId && memberId && guildOwnerId === memberId) {
                        allowed = true;
                }
        }

        if (!allowed && !channelIsPrivate) {
                allowed = true;
        }

        return allowed;
}

