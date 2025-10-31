export const SERVER_UNREAD_BADGE_CLASSES =
        'pointer-events-none block h-2 w-2 rounded-full bg-white shadow-[0_0_0_2px_var(--panel-strong)] transition-all duration-150';

export const FOLDER_UNREAD_BADGE_CLASSES = SERVER_UNREAD_BADGE_CLASSES;

export const CHANNEL_UNREAD_BADGE_CLASSES =
	'pointer-events-none block h-3 w-3 rounded-full border-2 border-[var(--panel-strong)] bg-[var(--brand)]';

export const SERVER_MENTION_BADGE_CLASSES =
	'pointer-events-none absolute -bottom-1.5 -right-1.5 z-30 grid min-h-[1.375rem] min-w-[1.375rem] place-items-center rounded-full bg-[var(--danger)] px-1 text-xs font-extrabold leading-none text-[var(--bg)] shadow-[0_10px_25px_rgba(0,0,0,0.35)] ring-2 ring-[var(--panel-strong)]';

export const FOLDER_MENTION_BADGE_CLASSES = SERVER_MENTION_BADGE_CLASSES;

export const CHANNEL_MENTION_BADGE_CLASSES =
	'pointer-events-none block min-w-[1.25rem] rounded-full border-2 border-[var(--panel-strong)] bg-[var(--danger)] px-1 text-xs font-semibold leading-none text-[var(--bg)]';
