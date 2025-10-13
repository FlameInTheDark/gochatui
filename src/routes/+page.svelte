<script lang="ts">
        import { onMount } from 'svelte';
        import { m } from '$lib/paraglide/messages.js';
        import { locale, type Locale } from '$lib/stores/settings';
        import { localeOptions } from '$lib/i18n/locales';

        const currentYear = new Date().getFullYear();
        const languageOptions = localeOptions;
        const languageMenuId = 'landing-language-menu';
        const languageButtonId = 'landing-language-button';

        function getLanguageLabel(code: Locale) {
                const option = languageOptions.find((candidate) => candidate.code === code);
                return option ? option.label() : code;
        }

        let languageMenuOpen = false;
        let languageMenuContainer: HTMLDivElement | null = null;
        let languageMenuButton: HTMLButtonElement | null = null;

        function toggleLanguageMenu() {
                languageMenuOpen = !languageMenuOpen;
        }

        function closeLanguageMenu() {
                if (!languageMenuOpen) return;
                languageMenuOpen = false;
        }

        function selectLocale(next: Locale) {
                locale.set(next);
                closeLanguageMenu();
                languageMenuButton?.focus();
        }

        function handleLanguageMenuFocusOut(event: FocusEvent) {
                if (!languageMenuOpen) return;
                const nextFocus = event.relatedTarget as Node | null;
                if (!nextFocus) {
                        closeLanguageMenu();
                        return;
                }
                if (!languageMenuContainer) return;
                if (languageMenuContainer.contains(nextFocus)) return;
                closeLanguageMenu();
        }

        function handleLanguageButtonKeydown(event: KeyboardEvent) {
                if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        toggleLanguageMenu();
                        return;
                }

                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        languageMenuOpen = true;
                }
        }

        onMount(() => {
                function handlePointerDown(event: PointerEvent) {
                        if (!languageMenuOpen) return;
                        if (!languageMenuContainer) return;
                        if (!event.target) return;
                        if (languageMenuContainer.contains(event.target as Node)) return;
                        closeLanguageMenu();
                }

                function handleKeydown(event: KeyboardEvent) {
                        if (!languageMenuOpen) return;
                        if (event.key === 'Escape') {
                                event.stopPropagation();
                                closeLanguageMenu();
                                languageMenuButton?.focus();
                        }
                }

                document.addEventListener('pointerdown', handlePointerDown);
                document.addEventListener('keydown', handleKeydown);

                return () => {
                        document.removeEventListener('pointerdown', handlePointerDown);
                        document.removeEventListener('keydown', handleKeydown);
                };
        });
</script>

<svelte:head>
        <title>{m.landing_title()}</title>
        <meta name="description" content={m.landing_meta_description()} />
</svelte:head>

<div id="top" class="relative isolate min-h-screen bg-ink-900 text-zinc-200">
        <div
                class="pointer-events-none fixed inset-0 -z-10 [mask-image:radial-gradient(50%_50%_at_50%_40%,black_20%,transparent_70%)]"
        >
                <div
                        class="absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-violet-600/20 blur-3xl"
                ></div>
                <div class="absolute top-64 right-12 h-72 w-72 rounded-full bg-indigo-600/20 blur-3xl"></div>
                <div class="absolute bottom-12 left-10 h-64 w-64 rounded-full bg-fuchsia-600/10 blur-3xl"></div>
        </div>

        <header class="sticky top-0 z-50 border-b border-white/10 bg-ink-900/70 backdrop-blur">
                <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-8">
                        <a href="/" class="flex items-center gap-2">
                                <span class="inline-block h-7 w-7 rounded bg-gradient-to-tr from-violet-500 to-fuchsia-500"></span>
                                <span class="text-sm font-semibold tracking-wide">GoChat</span>
                                <span
                                        class="ml-2 hidden rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300 sm:inline"
                                        >{m.landing_header_open_source_badge()}</span
                                >
                        </a>
                        <nav class="hidden items-center gap-6 text-sm text-zinc-300 sm:flex">
                                <a class="hover:text-white" href="#features">{m.landing_link_features()}</a>
                                <a class="hover:text-white" href="#preview">{m.landing_link_preview()}</a>
                                <a class="hover:text-white" href="#cta">{m.landing_link_get_started()}</a>
                        </nav>
                        <div class="flex items-center gap-2">
                                <div class="relative" bind:this={languageMenuContainer} on:focusout={handleLanguageMenuFocusOut}>
                                        <button
                                                type="button"
                                                class="group inline-flex h-12 min-w-[160px] items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 text-left text-sm text-zinc-200 outline-none transition focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/50"
                                                aria-haspopup="listbox"
                                                aria-expanded={languageMenuOpen}
                                                aria-controls={languageMenuId}
                                                on:click={toggleLanguageMenu}
                                                on:keydown={handleLanguageButtonKeydown}
                                                bind:this={languageMenuButton}
                                                id={languageButtonId}
                                        >
                                                <span class="flex flex-1 flex-col">
                                                        <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-400/80 transition-colors group-hover:text-zinc-300">
                                                                {m.language()}
                                                        </span>
                                                        <span class="text-sm font-medium text-zinc-100">{getLanguageLabel($locale)}</span>
                                                </span>
                                                <svg
                                                        class={`h-3 w-3 transition-transform duration-150 ${
                                                                languageMenuOpen
                                                                        ? 'rotate-180 text-violet-300'
                                                                        : 'text-zinc-400 group-hover:text-zinc-200'
                                                        }`}
                                                        viewBox="0 0 12 8"
                                                        aria-hidden="true"
                                                >
                                                        <path
                                                                d="M2 2l4 4 4-4"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="1.5"
                                                                stroke-linecap="round"
                                                                stroke-linejoin="round"
                                                        />
                                                </svg>
                                        </button>

                                        {#if languageMenuOpen}
                                                <div
                                                        class="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-white/10 bg-ink-900/95 p-1 shadow-xl backdrop-blur"
                                                        role="listbox"
                                                        id={languageMenuId}
                                                        aria-labelledby={languageButtonId}
                                                        aria-activedescendant={`landing-language-${$locale}`}
                                                        tabindex="-1"
                                                >
                                                        {#each languageOptions as option (option.code)}
                                                                <button
                                                                        type="button"
                                                                        id={`landing-language-${option.code}`}
                                                                        role="option"
                                                                        aria-selected={option.code === $locale}
                                                                        class={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
                                                                                option.code === $locale
                                                                                        ? 'bg-violet-500/20 text-white'
                                                                                        : 'text-zinc-200'
                                                                        }`}
                                                                        on:click={() => selectLocale(option.code)}
                                                                >
                                                                        <span>{option.label()}</span>
                                                                        {#if option.code === $locale}
                                                                                <svg
                                                                                        class="h-3 w-3 text-violet-300"
                                                                                        viewBox="0 0 12 10"
                                                                                        aria-hidden="true"
                                                                                >
                                                                                        <path
                                                                                                d="M1.5 5.5 4.5 8.5 10.5 1.5"
                                                                                                fill="none"
                                                                                                stroke="currentColor"
                                                                                                stroke-width="1.5"
                                                                                                stroke-linecap="round"
                                                                                                stroke-linejoin="round"
                                                                                        />
                                                                                </svg>
                                                                        {/if}
                                                                </button>
                                                        {/each}
                                                </div>
                                        {/if}
                                </div>
                                <a
                                        href="https://github.com/FlameInTheDark/gochat"
                                        target="_blank"
                                        rel="noopener"
                                        class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
                                        aria-label="GitHub repository"
                                >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="text-zinc-200">
                                                <path
                                                        fill-rule="evenodd"
                                                        clip-rule="evenodd"
                                                        d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.11.79-.25.79-.56v-2.06c-3.2.7-3.87-1.39-3.87-1.39-.53-1.34-1.3-1.7-1.3-1.7-1.06-.73.08-.72.08-.72 1.17.08 1.79 1.21 1.79 1.21 1.04 1.79 2.74 1.27 3.41.97.11-.76.41-1.27.75-1.56-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.29 1.2-3.09-.12-.29-.52-1.45.11-3.03 0 0 .98-.31 3.22 1.18a11.2 11.2 0 0 1 5.86 0c2.23-1.49 3.21-1.18 3.21-1.18.64 1.58.24 2.74.12 3.03.75.8 1.2 1.83 1.2 3.09 0 4.41-2.69 5.38-5.25 5.66.42.36.8 1.06.8 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5Z"
                                                />
                                        </svg>
                                </a>
                                <a
                                        href="/app"
                                        class="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500"
                                        >{m.landing_cta_open_app()}</a
                                >
                        </div>
                </div>
        </header>

        <main>
                <section
                        class="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-6 py-16 sm:px-8 md:grid-cols-2 md:py-24"
                >
                        <div>
                                <h1 class="text-4xl font-black tracking-tight sm:text-5xl">
                                        {m.landing_hero_headline_primary()}
                                        <span
                                                class="block bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent"
                                                >{m.landing_hero_headline_highlight()}</span
                                        >
                                </h1>
                                <p class="mt-5 max-w-xl text-base leading-relaxed text-zinc-400">
                                        {m.landing_hero_subheadline()}
                                </p>
                                <div class="mt-6 flex flex-wrap items-center gap-3">
                                        <a
                                                href="https://github.com/FlameInTheDark/gochat"
                                                target="_blank"
                                                rel="noopener"
                                                class="rounded-xl border border-violet-500/40 bg-violet-600/90 px-5 py-3 text-base font-medium text-white hover:bg-violet-500"
                                                >{m.landing_hero_github_cta()}</a
                                        >
                                        <a
                                                href="/app"
                                                class="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-base text-zinc-200 hover:bg-white/10"
                                                >{m.landing_hero_live_preview_cta()}</a
                                        >
                                        <span class="ml-2 flex items-center gap-2 text-xs text-zinc-400">
                                                <svg
                                                        width="16"
                                                        height="16"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        class="opacity-80"
                                                >
                                                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                                                </svg>
                                                {m.landing_hero_browser_badge()}
                                        </span>
                                </div>
                        </div>

                        <div id="preview" class="relative">
                                <div
                                        class="relative h-[560px] w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-chrome"
                                >
                                        <div
                                                class="absolute inset-0 bg-[radial-gradient(80%_60%_at_10%_0%,rgba(139,92,246,0.08),transparent_50%),radial-gradient(60%_50%_at_90%_100%,rgba(99,102,241,0.08),transparent_50%)]"
                                        ></div>

                                        <div class="relative z-10 grid h-full grid-cols-[72px_240px_1fr]">
                                                <aside
                                                        class="flex flex-col items-center gap-3 border-r border-white/10 bg-ink-800/60 p-3"
                                                >
                                                        <span class="h-10 w-10 rounded-2xl bg-gradient-to-tr from-violet-500 to-fuchsia-500"></span>
                                                        <span class="h-10 w-10 rounded-2xl bg-zinc-800"></span>
                                                        <span class="h-10 w-10 rounded-2xl bg-zinc-800"></span>
                                                        <span class="h-10 w-10 rounded-2xl bg-zinc-800"></span>
                                                        <span class="h-10 w-10 rounded-2xl bg-zinc-800"></span>
                                                        <span class="h-10 w-10 rounded-2xl bg-zinc-800"></span>
                                                        <span class="mt-auto h-10 w-10 rounded-2xl border border-white/10 bg-white/5"></span>
                                                </aside>

                                                <aside class="flex flex-col gap-3 border-r border-white/10 bg-ink-800/30 p-3">
                                                        <div class="h-8 rounded-lg border border-white/10 bg-white/5"></div>
                                                        <div class="space-y-2">
                                                                <div class="h-7 rounded-full bg-white/5"></div>
                                                                <div class="h-7 rounded-full bg-white/5"></div>
                                                                <div class="h-7 rounded-full bg-white/5"></div>
                                                                <div class="h-7 rounded-full bg-white/5"></div>
                                                                <div class="h-7 rounded-full bg-white/5"></div>
                                                                <div class="h-7 rounded-full bg-white/5"></div>
                                                        </div>
                                                        <div class="mt-auto h-9 rounded-lg border border-white/10 bg-white/5"></div>
                                                </aside>

                                                <main class="relative flex min-w-0 flex-col">
                                                        <div
                                                                class="flex h-12 items-center gap-2 border-b border-white/10 bg-zinc-900/70 px-3"
                                                        >
                                                                <div class="h-6 w-24 rounded bg-white/5"></div>
                                                                <div
                                                                        class="ml-auto hidden h-7 w-48 rounded-lg border border-white/10 bg-white/5 sm:block"
                                                                ></div>
                                                                <div class="h-7 w-16 rounded-lg border border-white/10 bg-white/5"></div>
                                                        </div>

                                                        <div class="relative flex-1 overflow-hidden">
                                                                <div class="absolute inset-0 space-y-4 overflow-y-auto p-4 sm:p-6">
                                                                        <div class="flex items-start gap-3">
                                                                                <span class="h-8 w-8 shrink-0 rounded-lg bg-zinc-800"></span>
                                                                                <div class="flex-1 space-y-2">
                                                                                        <div class="h-3 w-24 rounded bg-white/10"></div>
                                                                                        <div class="h-3 w-3/4 rounded bg-white/5"></div>
                                                                                        <div class="h-3 w-2/3 rounded bg-white/5"></div>
                                                                                </div>
                                                                        </div>
                                                                        <div class="flex items-start gap-3">
                                                                                <span class="h-8 w-8 shrink-0 rounded-lg bg-zinc-800"></span>
                                                                                <div class="flex-1 space-y-2">
                                                                                        <div class="h-3 w-20 rounded bg-white/10"></div>
                                                                                        <div class="h-3 w-1/2 rounded bg-white/5"></div>
                                                                                        <div class="h-3 w-2/5 rounded bg-white/5"></div>
                                                                                </div>
                                                                        </div>
                                                                        <div class="flex items-start gap-3">
                                                                                <span class="h-8 w-8 shrink-0 rounded-lg bg-zinc-800"></span>
                                                                                <div class="flex-1 space-y-2">
                                                                                        <div class="h-3 w-28 rounded bg-white/10"></div>
                                                                                        <div class="h-3 w-4/5 rounded bg-white/5"></div>
                                                                                        <div class="h-3 w-1/2 rounded bg-white/5"></div>
                                                                                </div>
                                                                        </div>
                                                                        <div class="rounded-xl border border-white/10 bg-ink-900/60 p-4">
                                                                                <div class="h-3 w-1/3 rounded bg-white/10"></div>
                                                                                <div class="mt-2 h-3 w-2/3 rounded bg-white/5"></div>
                                                                        </div>
                                                                </div>

                                                                <div class="absolute inset-x-0 bottom-0 border-t border-white/10 bg-ink-900/70 p-3">
                                                                        <div
                                                                                class="mx-auto flex max-w-2xl items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/80 px-3 py-2"
                                                                        >
                                                                                <span class="h-5 w-5 rounded bg-zinc-800"></span>
                                                                                <div class="h-6 flex-1 rounded bg-white/5"></div>
                                                                                <div class="h-8 w-20 rounded-lg bg-violet-600/80"></div>
                                                                        </div>
                                                                </div>
                                                        </div>
                                                </main>
                                        </div>

                                        <span class="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/5"></span>
                                </div>
                        </div>
                </section>

                <section id="features" class="mx-auto max-w-7xl px-6 py-16 sm:px-8 sm:py-24">
                        <div class="mx-auto mb-10 max-w-2xl text-center">
                                <span
                                        class="mb-3 inline-block rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300"
                                        >{m.landing_features_section_tag()}</span
                                >
                                <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">
                                        {m.landing_features_section_title()}
                                </h2>
                                <p class="mt-3 text-zinc-400">
                                        {m.landing_features_section_description()}
                                </p>
                        </div>

                        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                <div class="h-full rounded-2xl border border-white/10 bg-ink-900/70 p-5">
                                        <div
                                                class="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                        >
                                                <svg
                                                        width="18"
                                                        height="18"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                >
                                                        <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
                                                </svg>
                                                <span class="text-sm font-semibold text-zinc-100">{m.landing_feature_channels_title()}</span>
                                        </div>
                                        <p class="text-sm leading-relaxed text-zinc-400">
                                                {m.landing_feature_channels_description()}
                                        </p>
                                </div>

                                <div class="h-full rounded-2xl border border-white/10 bg-ink-900/70 p-5">
                                        <div
                                                class="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                        >
                                                <svg
                                                        width="18"
                                                        height="18"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                >
                                                        <circle cx="11" cy="11" r="8"></circle>
                                                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                                </svg>
                                                <span class="text-sm font-semibold text-zinc-100">{m.landing_feature_search_title()}</span>
                                        </div>
                                        <p class="text-sm leading-relaxed text-zinc-400">
                                                {m.landing_feature_search_description()}
                                        </p>
                                </div>

                                <div class="h-full rounded-2xl border border-white/10 bg-ink-900/70 p-5">
                                        <div
                                                class="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                        >
                                                <svg
                                                        width="18"
                                                        height="18"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                >
                                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                                </svg>
                                                <span class="text-sm font-semibold text-zinc-100">{m.landing_feature_roles_title()}</span>
                                        </div>
                                        <p class="text-sm leading-relaxed text-zinc-400">
                                                {m.landing_feature_roles_description()}
                                        </p>
                                </div>

                                <div class="h-full rounded-2xl border border-white/10 bg-ink-900/70 p-5">
                                        <div
                                                class="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                        >
                                                <svg
                                                        width="18"
                                                        height="18"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                >
                                                        <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                                        <path d="M13.73 21a2 2 0 01-3.46 0"></path>
                                                </svg>
                                                <span class="text-sm font-semibold text-zinc-100">{m.landing_feature_notifications_title()}</span>
                                                <span
                                                        class="ml-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-200"
                                                        >{m.landing_feature_badge_coming_soon()}</span
                                                >
                                        </div>
                                        <p class="text-sm leading-relaxed text-zinc-400">
                                                {m.landing_feature_notifications_description()}
                                        </p>
                                </div>

                                <div class="h-full rounded-2xl border border-white/10 bg-ink-900/70 p-5">
                                        <div
                                                class="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                        >
                                                <svg
                                                        width="18"
                                                        height="18"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                >
                                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                                        <path d="M7 11V7a5 5 0 0110 0v4"></path>
                                                </svg>
                                                <span class="text-sm font-semibold text-zinc-100">{m.landing_feature_secure_title()}</span>
                                                <span
                                                        class="ml-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-200"
                                                        >{m.landing_feature_badge_coming_soon()}</span
                                                >
                                        </div>
                                        <p class="text-sm leading-relaxed text-zinc-400">
                                                {m.landing_feature_secure_description()}
                                        </p>
                                </div>

                                <div class="h-full rounded-2xl border border-white/10 bg-ink-900/70 p-5">
                                        <div
                                                class="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                        >
                                                <svg
                                                        width="18"
                                                        height="18"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                >
                                                        <path
                                                                d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.66 12.66 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.66 12.66 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                                                        ></path>
                                                </svg>
                                                <span class="text-sm font-semibold text-zinc-100">{m.landing_feature_voice_title()}</span>
                                                <span
                                                        class="ml-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-200"
                                                        >{m.landing_feature_badge_coming_soon()}</span
                                                >
                                        </div>
                                        <p class="text-sm leading-relaxed text-zinc-400">
                                                {m.landing_feature_voice_description()}
                                        </p>
                                </div>
                        </div>
                </section>

                <section id="cta" class="mx-auto max-w-7xl px-6 pb-20 sm:px-8">
                        <div class="rounded-2xl border border-white/10 bg-ink-900/70 p-6 sm:p-8">
                                <div class="grid items-center gap-6 md:grid-cols-2">
                                        <div>
                                                <h3 class="text-xl font-semibold">{m.landing_cta_title()}</h3>
                                                <p class="mt-2 text-sm text-zinc-400">
                                                        {m.landing_cta_description()}
                                                </p>
                                                <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
                                                        <span class="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                                                >{m.landing_cta_pill_dark()}</span
                                                        >
                                                        <span class="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                                                >{m.landing_cta_pill_keyboard()}</span
                                                        >
                                                        <span class="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                                                                >{m.landing_cta_pill_responsive()}</span
                                                        >
                                                </div>
                                        </div>
                                        <div class="flex flex-wrap items-center gap-3 md:justify-end">
                                                <a
                                                        href="/app"
                                                        class="rounded-xl bg-violet-600 px-5 py-3 text-base font-medium text-white hover:bg-violet-500"
                                                        >{m.landing_cta_open_app()}</a
                                                >
                                                <a
                                                        href="https://github.com/FlameInTheDark/gochat"
                                                        target="_blank"
                                                        rel="noopener"
                                                        class="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-base text-zinc-200 hover:bg-white/10"
                                                        >{m.landing_hero_github_cta()}</a
                                                >
                                        </div>
                                </div>
                        </div>
                </section>
        </main>

        <footer class="border-t border-white/10 py-10">
                <div
                        class="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row sm:px-8"
                >
                        <div class="flex items-center gap-2">
                                <span class="inline-block h-6 w-6 rounded bg-gradient-to-tr from-violet-500 to-fuchsia-500"></span>
                                <span class="text-sm font-semibold">GoChat</span>
                                <span class="ml-2 text-xs text-zinc-400">© {currentYear}</span>
                        </div>
                        <p class="text-center text-xs text-zinc-500 sm:text-right">
                                {m.landing_footer_tagline()}
                        </p>
                        <nav class="flex items-center gap-4 text-sm text-zinc-400">
                                <a class="hover:text-white" href="#features">{m.landing_link_features()}</a>
                                <a class="hover:text-white" href="#preview">{m.landing_link_preview()}</a>
                                <a
                                        class="hover:text-white"
                                        href="https://github.com/FlameInTheDark/gochat/actions"
                                        target="_blank"
                                        rel="noopener"
                                        >{m.landing_footer_status_link()}</a
                                >
                        </nav>
                </div>
        </footer>
</div>
