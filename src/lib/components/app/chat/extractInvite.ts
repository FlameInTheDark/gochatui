export function extractInvite(url: string): { code: string } | null {
	try {
		const parsed = new URL(url);

		const currentLocation =
			typeof window !== 'undefined' && window?.location
				? window.location
				: typeof location !== 'undefined'
					? location
					: null;

		if (!currentLocation) {
			return null;
		}

		const origin = 'origin' in currentLocation ? currentLocation.origin : undefined;
		const host = 'host' in currentLocation ? currentLocation.host : undefined;
		const protocol = 'protocol' in currentLocation ? currentLocation.protocol : undefined;

		if (origin) {
			if (parsed.origin !== origin) {
				return null;
			}
		} else if (host) {
			if (parsed.host !== host) {
				return null;
			}

			if (protocol && parsed.protocol !== protocol) {
				return null;
			}
		} else {
			return null;
		}

		const segments = parsed.pathname.split('/').filter(Boolean);
		if (
			segments.length >= 3 &&
			segments[0]?.toLowerCase() === 'app' &&
			segments[1]?.toLowerCase() === 'i'
		) {
			const code = segments[2];
			if (code) {
				return { code };
			}
		}
	} catch {
		return null;
	}

	return null;
}
