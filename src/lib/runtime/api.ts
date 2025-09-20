import { env as publicEnv } from '$env/dynamic/public';
import { getRuntimeConfig } from './config';

function sanitizeBase(url: string | undefined | null): string | null {
	if (!url) return null;
	const trimmed = url.trim();
	if (!trimmed) return null;
	return trimmed.replace(/\/+$/, '');
}

export function computeApiBase(fallback: string = 'http://localhost/api/v1'): string {
	const runtimeConfigured = sanitizeBase(getRuntimeConfig()?.PUBLIC_API_BASE_URL);
	if (runtimeConfigured) {
		return runtimeConfigured;
	}

	const envConfigured = sanitizeBase(publicEnv?.PUBLIC_API_BASE_URL as string | undefined);
	if (envConfigured) {
		return envConfigured;
	}

	return sanitizeBase(fallback) ?? fallback;
}
