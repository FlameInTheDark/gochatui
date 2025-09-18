import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const dev = process.argv.includes('dev');

function normalizeBasePath(path) {
	if (!path) return '';
	let normalized = path.trim();
	if (!normalized || normalized === '/') return '';
	if (!normalized.startsWith('/')) normalized = `/${normalized}`;
	return normalized.replace(/\/+$/, '');
}

const basePath = normalizeBasePath(process.env.PUBLIC_BASE_PATH);
const assetOutDir = basePath ? `build${basePath}` : 'build';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
        kit: {
                adapter: adapter({
                        strict: false,
                        assets: assetOutDir
                }),
                paths: {
                        base: '',
                        assets: dev ? '' : basePath
                }
        }
};

export default config;
