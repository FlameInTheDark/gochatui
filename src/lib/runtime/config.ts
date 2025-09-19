export type RuntimeConfig = {
	PUBLIC_BASE_PATH?: string;
	PUBLIC_API_BASE_URL?: string;
	PUBLIC_WS_URL?: string;
};

declare global {
	var __RUNTIME_CONFIG__: RuntimeConfig | undefined;
	interface Window {
		__RUNTIME_CONFIG__?: RuntimeConfig;
	}
}

let cachedConfig: RuntimeConfig | null | undefined;

function readRuntimeConfig(): RuntimeConfig | null {
	if (typeof globalThis === 'undefined') {
		return null;
	}

	const globalWithConfig = globalThis as typeof globalThis & {
		__RUNTIME_CONFIG__?: RuntimeConfig;
	};

	const maybeConfig = globalWithConfig.__RUNTIME_CONFIG__;
	if (maybeConfig && typeof maybeConfig === 'object') {
		return maybeConfig as RuntimeConfig;
	}

	return null;
}

export function getRuntimeConfig(): RuntimeConfig | null {
	const shouldRefreshFromGlobal =
		cachedConfig === undefined || (cachedConfig === null && typeof window !== 'undefined');

	if (shouldRefreshFromGlobal) {
		const maybeConfig = readRuntimeConfig();

		if (maybeConfig) {
			cachedConfig = maybeConfig;
			return cachedConfig;
		}

		if (cachedConfig === undefined) {
			cachedConfig = null;
		}
	}

	return cachedConfig ?? null;
}

export function getRuntimeConfigValue<K extends keyof RuntimeConfig>(
	key: K
): RuntimeConfig[K] | undefined {
	const config = getRuntimeConfig();
	return config ? config[key] : undefined;
}
