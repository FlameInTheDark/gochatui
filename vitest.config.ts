import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	test: {
		environment: 'node',
		globals: true
	},
	resolve: {
		alias: {
			$lib: resolve(rootDir, 'src/lib'),
			'$env/dynamic/public': resolve(rootDir, 'src/tests/mocks/env-dynamic-public.ts')
		}
	}
});
