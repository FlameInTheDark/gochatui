import { writable } from 'svelte/store';
import type { DtoMember } from '$lib/api';

export type MemberProfilePanelAnchor = {
        x: number;
        y: number;
        width: number;
        height: number;
};

export type MemberProfilePanelState = {
        open: boolean;
        member: DtoMember | null;
        guildId: string | null;
        anchor: MemberProfilePanelAnchor | null;
};

const initialState: MemberProfilePanelState = {
        open: false,
        member: null,
        guildId: null,
        anchor: null
};

const state = writable<MemberProfilePanelState>(initialState);

export const memberProfilePanel = {
        subscribe: state.subscribe,
        open({
                member,
                guildId,
                anchor
        }: {
                member: DtoMember | null;
                guildId: string | null;
                anchor: MemberProfilePanelAnchor | null;
        }) {
                state.set({
                        open: true,
                        member: member ?? null,
                        guildId: guildId ?? null,
                        anchor: anchor ?? null
                });
        },
        close() {
                state.set(initialState);
        }
};
