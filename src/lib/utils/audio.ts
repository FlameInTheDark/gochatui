const AUDIO_LEVEL_GAIN_MAX = 4;

export const AUDIO_LEVEL_DB_MIN = -100;
export const AUDIO_LEVEL_DB_MAX = 0;

export function clampValue(value: number, min: number, max: number): number {
        if (!Number.isFinite(value)) return min;
        return Math.max(min, Math.min(max, value));
}

export function clampNormalized(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return clampValue(value, 0, 1);
}

export function normalizedToDecibels(value: number): number {
        if (!Number.isFinite(value) || value <= 0) {
                return AUDIO_LEVEL_DB_MIN;
        }
        const db = 20 * Math.log10(value);
        return clampValue(db, AUDIO_LEVEL_DB_MIN, AUDIO_LEVEL_DB_MAX);
}

export function decibelsToNormalized(value: number): number {
        if (!Number.isFinite(value)) {
                return 0;
        }
        const clamped = clampValue(value, AUDIO_LEVEL_DB_MIN, AUDIO_LEVEL_DB_MAX);
        if (clamped <= AUDIO_LEVEL_DB_MIN) {
                return 0;
        }
        return clampNormalized(Math.pow(10, clamped / 20));
}

export function decibelsToPercent(value: number): number {
        const clamped = clampValue(value, AUDIO_LEVEL_DB_MIN, AUDIO_LEVEL_DB_MAX);
        const span = AUDIO_LEVEL_DB_MAX - AUDIO_LEVEL_DB_MIN;
        if (span <= 0) return 0;
        return ((clamped - AUDIO_LEVEL_DB_MIN) / span) * 100;
}

export function normalizedToPercent(value: number): number {
        return decibelsToPercent(normalizedToDecibels(value));
}

export function analyzeTimeDomainLevel(
        buffer: Uint8Array,
        options?: { gain?: number; previous?: number; smoothing?: number }
): { normalized: number; decibels: number } {
        if (!buffer || buffer.length === 0) {
                return { normalized: 0, decibels: AUDIO_LEVEL_DB_MIN };
        }

        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i += 1) {
                const sample = buffer[i] / 128 - 1;
                sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const gain = clampValue(Number.isFinite(options?.gain) ? Number(options?.gain) : 1, 0, AUDIO_LEVEL_GAIN_MAX);
        let normalized = clampNormalized(rms * Math.SQRT2 * gain);

        if (options?.previous != null && Number.isFinite(options.previous) && options?.smoothing) {
                const smoothing = clampValue(options.smoothing, 0, 0.99);
                normalized = normalized * (1 - smoothing) + clampNormalized(options.previous) * smoothing;
        }

        return { normalized, decibels: normalizedToDecibels(normalized) };
}
