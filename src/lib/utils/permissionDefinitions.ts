import { m } from '$lib/paraglide/messages.js';

export type PermissionDefinition = {
	value: number;
	label: () => string;
	description: () => string;
};

export type PermissionCategory = {
	id: string;
	label: () => string;
	permissions: PermissionDefinition[];
};

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
	{
		id: 'server',
		label: () => m.role_permissions_category_server(),
		permissions: [
			{
				value: 1 << 0,
				label: () => m.role_perm_server_view_channels_name(),
				description: () => m.role_perm_server_view_channels_desc()
			},
			{
				value: 1 << 1,
				label: () => m.role_perm_server_manage_channels_name(),
				description: () => m.role_perm_server_manage_channels_desc()
			},
			{
				value: 1 << 2,
				label: () => m.role_perm_server_manage_roles_name(),
				description: () => m.role_perm_server_manage_roles_desc()
			},
			{
				value: 1 << 3,
				label: () => m.role_perm_server_view_audit_log_name(),
				description: () => m.role_perm_server_view_audit_log_desc()
			},
			{
				value: 1 << 4,
				label: () => m.role_perm_server_manage_name(),
				description: () => m.role_perm_server_manage_desc()
			}
		]
	},
	{
		id: 'membership',
		label: () => m.role_permissions_category_membership(),
		permissions: [
			{
				value: 1 << 5,
				label: () => m.role_perm_membership_create_invite_name(),
				description: () => m.role_perm_membership_create_invite_desc()
			},
			{
				value: 1 << 6,
				label: () => m.role_perm_membership_change_nickname_name(),
				description: () => m.role_perm_membership_change_nickname_desc()
			},
			{
				value: 1 << 7,
				label: () => m.role_perm_membership_manage_nickname_name(),
				description: () => m.role_perm_membership_manage_nickname_desc()
			},
			{
				value: 1 << 8,
				label: () => m.role_perm_membership_kick_members_name(),
				description: () => m.role_perm_membership_kick_members_desc()
			},
			{
				value: 1 << 9,
				label: () => m.role_perm_membership_ban_members_name(),
				description: () => m.role_perm_membership_ban_members_desc()
			},
			{
				value: 1 << 10,
				label: () => m.role_perm_membership_timeout_members_name(),
				description: () => m.role_perm_membership_timeout_members_desc()
			}
		]
	},
	{
		id: 'text',
		label: () => m.role_permissions_category_text(),
		permissions: [
			{
				value: 1 << 11,
				label: () => m.role_perm_text_send_message_name(),
				description: () => m.role_perm_text_send_message_desc()
			},
			{
				value: 1 << 12,
				label: () => m.role_perm_text_send_message_in_threads_name(),
				description: () => m.role_perm_text_send_message_in_threads_desc()
			},
			{
				value: 1 << 13,
				label: () => m.role_perm_text_create_threads_name(),
				description: () => m.role_perm_text_create_threads_desc()
			},
			{
				value: 1 << 14,
				label: () => m.role_perm_text_attach_files_name(),
				description: () => m.role_perm_text_attach_files_desc()
			},
			{
				value: 1 << 15,
				label: () => m.role_perm_text_add_reactions_name(),
				description: () => m.role_perm_text_add_reactions_desc()
			},
			{
				value: 1 << 16,
				label: () => m.role_perm_text_mention_roles_name(),
				description: () => m.role_perm_text_mention_roles_desc()
			},
			{
				value: 1 << 17,
				label: () => m.role_perm_text_manage_messages_name(),
				description: () => m.role_perm_text_manage_messages_desc()
			},
			{
				value: 1 << 18,
				label: () => m.role_perm_text_manage_threads_name(),
				description: () => m.role_perm_text_manage_threads_desc()
			},
			{
				value: 1 << 19,
				label: () => m.role_perm_text_read_message_history_name(),
				description: () => m.role_perm_text_read_message_history_desc()
			}
		]
	},
	{
		id: 'voice',
		label: () => m.role_permissions_category_voice(),
		permissions: [
			{
				value: 1 << 20,
				label: () => m.role_perm_voice_connect_name(),
				description: () => m.role_perm_voice_connect_desc()
			},
			{
				value: 1 << 21,
				label: () => m.role_perm_voice_speak_name(),
				description: () => m.role_perm_voice_speak_desc()
			},
			{
				value: 1 << 22,
				label: () => m.role_perm_voice_video_name(),
				description: () => m.role_perm_voice_video_desc()
			},
			{
				value: 1 << 23,
				label: () => m.role_perm_voice_mute_members_name(),
				description: () => m.role_perm_voice_mute_members_desc()
			},
			{
				value: 1 << 24,
				label: () => m.role_perm_voice_deafen_members_name(),
				description: () => m.role_perm_voice_deafen_members_desc()
			},
			{
				value: 1 << 25,
				label: () => m.role_perm_voice_move_members_name(),
				description: () => m.role_perm_voice_move_members_desc()
			}
		]
	},
	{
		id: 'advanced',
		label: () => m.role_permissions_category_advanced(),
		permissions: [
			{
				value: 1 << 26,
				label: () => m.role_perm_administrator_name(),
				description: () => m.role_perm_administrator_desc()
			}
		]
	}
];

export const CHANNEL_PERMISSION_CATEGORIES: PermissionCategory[] = PERMISSION_CATEGORIES.filter(
	(category) => category.id !== 'advanced'
);
