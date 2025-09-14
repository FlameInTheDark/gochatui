import { writable } from 'svelte/store';
import { setLocale } from '$lib/paraglide/runtime';
import { goto } from '$app/navigation';

export type Theme = 'light' | 'dark' | 'system';
export type Locale = 'en' | 'ru';

const initialTheme =
	(typeof localStorage !== 'undefined' && (localStorage.getItem('theme') as Theme)) || 'system';

function applyTheme(t: Theme) {
	if (typeof document === 'undefined' || typeof window === 'undefined') return;
	const mode =
		t === 'system'
			? window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light'
			: t;
	document.documentElement.setAttribute('data-theme', mode);
}

export const theme = writable<Theme>(initialTheme);

theme.subscribe((t) => {
	if (typeof document !== 'undefined') {
		applyTheme(t);
		try {
			localStorage.setItem('theme', t);
		} catch {
			/* empty */
		}
	}
});

const initialLocale =
	(typeof localStorage !== 'undefined' && (localStorage.getItem('locale') as Locale)) || 'en';

export const locale = writable<Locale>(initialLocale);

let initial = true;
locale.subscribe((l: Locale) => {
	if (typeof window !== 'undefined') {
		// Update the locale without forcing a full page reload
		setLocale(l, { reload: false });

		if (initial) {
			initial = false;
		} else {
			// Trigger a client-side navigation to refresh translations
			/* eslint-disable-next-line svelte/no-navigation-without-resolve */
			goto(window.location.pathname + window.location.search, {
				replaceState: true,
				invalidateAll: true
			});
		}

		try {
			localStorage.setItem('locale', l);
		} catch {
			/* empty */
		}
	}
});

export const settingsOpen = writable(false);
