# Repository Guidelines

## Project Structure & Module Organization

- Source code: `src/` (SvelteKit)
  - Routes: `src/routes/` (e.g., `+layout.svelte`, `+page.svelte`)
  - Components: `src/lib/components/` (UI and app modules)
  - Stores: `src/lib/stores/` (Svelte stores, e.g., `auth.ts`)
  - Client APIs: `src/lib/api/`, `src/lib/client/` (REST via axios, websockets)
- Assets: `src/lib/assets/`, static files: `static/`
- i18n: `project.inlang/`, messages under `messages/` (en/ru). Generated files in `src/lib/paraglide/` (do not edit).
- Config: `vite.config.ts`, `svelte.config.js`, `eslint.config.js`, `tsconfig.json`.
- Env: `.env.example` (copy to `.env`).

## Build, Test, and Development Commands

- `npm run dev` — start Vite dev server (SvelteKit).
- `npm run build` — production build (static adapter).
- `npm run preview` — preview built app locally.
- `npm run check` / `check:watch` — Svelte type and diagnostic checks.
- `npm run lint` — Prettier check + ESLint.
- `npm run format` — auto-format with Prettier.

## Coding Style & Naming Conventions

- Language: TypeScript, Svelte 5, Tailwind CSS 4.
- Formatting: Prettier (incl. `prettier-plugin-svelte`, `prettier-plugin-tailwindcss`). Run `npm run format`.
- Linting: ESLint with Svelte and TypeScript configs. Run `npm run lint`.
- Components: PascalCase (`MessageList.svelte`). Stores/utilities: camelCase (`appState.ts`). Routes use SvelteKit conventions (`+page.svelte`).

## Testing Guidelines

- No formal tests yet. Prefer Vitest + Svelte Testing Library.
- Name tests `*.spec.ts` colocated with source or under `tests/`.
- Test public component behavior (props, events) and stores’ logic. Aim for meaningful coverage on new code.

## Commit & Pull Request Guidelines

- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, etc.
- PRs: include summary, screenshots for UI changes, and linked issues. Keep diffs focused; update docs/messages as needed.
- Before pushing: `npm run lint && npm run check && npm run build`.

## Security & Configuration Tips

- Do not commit secrets. Start from `.env.example` and document new vars.
- i18n: add keys to `messages/*.json`; generated `src/lib/paraglide` code is derived—don’t edit by hand.
- Network: REST via `src/lib/api/` (axios) and WS in `src/lib/client/ws.ts`; centralize endpoints/config.

## ID Handling

- All entity IDs are 64-bit snowflakes.
- Represent IDs as `bigint` in JavaScript/TypeScript to avoid precision loss.
- Avoid casting IDs to `Number`; use `bigint` comparisons and pass IDs to APIs as `bigint` values (cast with `as any` if the generated types require `number`).
