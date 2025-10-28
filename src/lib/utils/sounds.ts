import { browser } from '$app/environment';

const SOUND_SOURCES = {
        mention: '/sounds/mention.ogg',
        voiceOff: '/sounds/voice_off.ogg',
        voiceOn: '/sounds/voice_on.ogg',
        voiceJoin: '/sounds/voice_join.ogg'
} as const;

type SoundKey = keyof typeof SOUND_SOURCES;

const audioCache = new Map<SoundKey, HTMLAudioElement>();

function getAudio(key: SoundKey): HTMLAudioElement | null {
        if (!browser) return null;
        let audio = audioCache.get(key);
        if (!audio) {
                audio = new Audio(SOUND_SOURCES[key]);
                audio.preload = 'auto';
                audioCache.set(key, audio);
        }
        return audio;
}

function playSound(key: SoundKey): void {
        const audio = getAudio(key);
        if (!audio) return;
        try {
                audio.currentTime = 0;
                const playPromise = audio.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => {});
                }
        } catch {}
}

export function playMentionSound(): void {
        playSound('mention');
}

export function playVoiceOffSound(): void {
        playSound('voiceOff');
}

export function playVoiceOnSound(): void {
        playSound('voiceOn');
}

export function playVoiceJoinSound(): void {
        playSound('voiceJoin');
}

