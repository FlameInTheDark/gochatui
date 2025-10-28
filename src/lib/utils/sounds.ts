import { browser } from '$app/environment';

import mentionSoundUrl from '$lib/assets/sounds/mention.ogg?url';
import voiceOffSoundUrl from '$lib/assets/sounds/voice_off.ogg?url';
import voiceOnSoundUrl from '$lib/assets/sounds/voice_on.ogg?url';
import voiceJoinSoundUrl from '$lib/assets/sounds/voice_join.ogg?url';

const SOUND_SOURCES = {
        mention: mentionSoundUrl,
        voiceOff: voiceOffSoundUrl,
        voiceOn: voiceOnSoundUrl,
        voiceJoin: voiceJoinSoundUrl
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

