import { writable } from 'svelte/store';
import { setLocale } from '$lib/paraglide/runtime';

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

locale.subscribe((l: Locale) => {
	if (typeof window !== 'undefined') {
		// Updating the locale should not trigger a page reload
		setLocale(l, { reload: false });
		try {
			localStorage.setItem('locale', l);
		} catch {
			/* empty */
		}
	}
});

export const settingsOpen = writable(false);
