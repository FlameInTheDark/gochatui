import { writable } from 'svelte/store';
import type { DtoMember, DtoUser } from '$lib/api';

export type MemberProfilePanelAnchor = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type MemberProfilePanelState = {
	open: boolean;
	member: DtoMember | null;
	user: DtoUser | null;
	guildId: string | null;
	anchor: MemberProfilePanelAnchor | null;
};

const initialState: MemberProfilePanelState = {
	open: false,
	member: null,
	user: null,
	guildId: null,
	anchor: null
};

const state = writable<MemberProfilePanelState>(initialState);

export const memberProfilePanel = {
	subscribe: state.subscribe,
	open({
		member,
		user,
		guildId,
		anchor
	}: {
		member: DtoMember | null;
		user: DtoUser | null;
		guildId: string | null;
		anchor: MemberProfilePanelAnchor | null;
	}) {
		state.set({
			open: true,
			member: member ?? null,
			user: user ?? null,
			guildId: guildId ?? null,
			anchor: anchor ?? null
		});
	},
	close() {
		state.set(initialState);
	}
};
