import { writable } from 'svelte/store';
import { setLocale } from '$lib/paraglide/runtime';

export type Theme = 'light' | 'dark' | 'system';

const supportedLocales = ['en', 'ru', 'de', 'fr'] as const;
export type Locale = (typeof supportedLocales)[number];

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

function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && supportedLocales.includes(value as Locale);
}

const storedLocale = typeof localStorage !== 'undefined' ? localStorage.getItem('locale') : null;
const initialLocale = (storedLocale && isLocale(storedLocale) && storedLocale) || 'en';

setLocale(initialLocale);
export const locale = writable<Locale>(initialLocale);

locale.subscribe((l: Locale) => {
	setLocale(l);
	try {
		localStorage.setItem('locale', l);
	} catch {
		/* empty */
	}
});

export const settingsOpen = writable(false);
