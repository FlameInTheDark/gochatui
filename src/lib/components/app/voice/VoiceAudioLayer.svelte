<script lang="ts">
        import { voiceSession } from '$lib/stores/voice';
        import VoiceRemoteAudioItem from './VoiceRemoteAudioItem.svelte';

        const voice = voiceSession;
</script>

<div aria-hidden="true" class="hidden">
        {#each $voice.remoteStreams as remote (remote.id)}
                <VoiceRemoteAudioItem
                        stream={remote.stream}
                        deafened={$voice.deafened}
                        volume={$voice.remoteSettings?.[remote.userId ?? '']?.volume ?? 1}
                        muted={$voice.remoteSettings?.[remote.userId ?? '']?.muted ?? false}
                />
        {/each}
</div>
