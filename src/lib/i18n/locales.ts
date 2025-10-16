import { m } from '$lib/paraglide/messages.js';
import { supportedLocales, type Locale } from '$lib/stores/settings';

export type LocaleOption = {
	code: Locale;
	label: () => string;
};

const localeLabels: Record<Locale, () => string> = {
	en: () => m.language_name_en(),
	ru: () => m.language_name_ru(),
	de: () => m.language_name_de(),
	fr: () => m.language_name_fr()
};

export const localeOptions: LocaleOption[] = supportedLocales.map((code) => ({
	code,
	label: localeLabels[code]
}));
