import { browser } from '$app/environment';

import { appSettings, type UiSoundSettingKey } from '$lib/stores/settings';

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
type VoiceToggleSetting = Extract<UiSoundSettingKey, 'mute' | 'deafen'>;

const audioCache = new Map<SoundKey, HTMLAudioElement>();

const defaultUiSoundState: Record<UiSoundSettingKey, boolean> = {
        notification: true,
        mute: true,
        deafen: true,
        voiceChannel: true
};

let currentOutputLevel = 1;
let uiSoundPreferences: Record<UiSoundSettingKey, boolean> = { ...defaultUiSoundState };

function clampOutputLevel(value: unknown): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 1;
        return Math.max(0, Math.min(1.5, numeric));
}

function updateCachedAudioVolume(): void {
        const effectiveVolume = Math.min(1, currentOutputLevel);
        for (const audio of audioCache.values()) {
                audio.volume = effectiveVolume;
        }
}

if (browser) {
        appSettings.subscribe(($settings) => {
                if (!$settings) {
                        currentOutputLevel = 1;
                        uiSoundPreferences = { ...defaultUiSoundState };
                        updateCachedAudioVolume();
                        return;
                }
                const devices = $settings.devices;
                currentOutputLevel = clampOutputLevel(devices?.audioOutputLevel);
                const uiSounds = $settings.uiSounds;
                uiSoundPreferences = {
                        notification: uiSounds.notification !== false,
                        mute: uiSounds.mute !== false,
                        deafen: uiSounds.deafen !== false,
                        voiceChannel: uiSounds.voiceChannel !== false
                };
                updateCachedAudioVolume();
        });
}

function getAudio(key: SoundKey): HTMLAudioElement | null {
        if (!browser) return null;
        let audio = audioCache.get(key);
        if (!audio) {
                audio = new Audio(SOUND_SOURCES[key]);
                audio.preload = 'auto';
                audio.volume = Math.min(1, currentOutputLevel);
                audioCache.set(key, audio);
        }
        return audio;
}

function playSound(key: SoundKey, setting: UiSoundSettingKey): void {
        if (!uiSoundPreferences[setting]) return;
        const audio = getAudio(key);
        if (!audio) return;
        try {
                audio.volume = Math.min(1, currentOutputLevel);
                audio.currentTime = 0;
                const playPromise = audio.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => {});
                }
        } catch {}
}

export function playMentionSound(): void {
        playSound('mention', 'notification');
}

export function playVoiceOffSound(setting: VoiceToggleSetting): void {
        playSound('voiceOff', setting);
}

export function playVoiceOnSound(setting: VoiceToggleSetting): void {
        playSound('voiceOn', setting);
}

export function playVoiceJoinSound(): void {
        playSound('voiceJoin', 'voiceChannel');
}

