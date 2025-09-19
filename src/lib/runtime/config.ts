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

export function getRuntimeConfig(): RuntimeConfig | null {
	if (cachedConfig !== undefined) {
		return cachedConfig;
	}
	if (typeof globalThis !== 'undefined') {
		const globalWithConfig = globalThis as typeof globalThis & {
			__RUNTIME_CONFIG__?: RuntimeConfig;
		};
		const maybeConfig = globalWithConfig.__RUNTIME_CONFIG__;
		if (maybeConfig && typeof maybeConfig === 'object') {
			cachedConfig = maybeConfig as RuntimeConfig;
			return cachedConfig;
		}
	}
	cachedConfig = null;
	return cachedConfig;
}

export function getRuntimeConfigValue<K extends keyof RuntimeConfig>(
	key: K
): RuntimeConfig[K] | undefined {
	const config = getRuntimeConfig();
	return config ? config[key] : undefined;
}
