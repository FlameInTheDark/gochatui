<script lang="ts">
        import { Volume2 } from 'lucide-svelte';
        import type { InlineToken } from './MessageItem.svelte';

	export let tokens: InlineToken[] = [];
</script>

{#each tokens as token, index (index)}
	{#if token.type === 'text'}
		<span
			class="break-words whitespace-pre-wrap"
			class:font-semibold={token.styles?.bold}
			class:italic={token.styles?.italic}
			class:underline={token.styles?.underline}
			class:line-through={token.styles?.strike}
		>
			{token.content}
		</span>
	{:else if token.type === 'link'}
		<a
			class="font-medium break-words whitespace-pre-wrap text-[var(--brand)] underline underline-offset-2 transition hover:text-[var(--brand-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:outline-none"
			class:font-semibold={token.styles?.bold}
			class:italic={token.styles?.italic}
			class:underline={token.styles?.underline}
			class:line-through={token.styles?.strike}
			href={token.url}
			rel="noopener noreferrer"
			target="_blank"
		>
			{token.label}
		</a>
        {:else if token.type === 'mention'}
                {#if token.onClick}
                        <button
                                type="button"
                                class="mention-badge"
                                style={token.accentColor ? `--mention-accent: ${token.accentColor}` : undefined}
                                data-mention-type={token.mentionType}
                                data-user-menu={token.mentionType === 'user' ? 'true' : undefined}
                                data-channel-kind={token.mentionType === 'channel' ? token.channelKind ?? 'text' : undefined}
                                onclick={token.onClick}
                        >
                                {#if token.mentionType === 'channel' && token.channelKind === 'voice'}
                                        <Volume2 class="mention-badge__icon" stroke-width={2} aria-hidden="true" />
                                {/if}
                                <span class="mention-badge__label">{token.label}</span>
                        </button>
                {:else}
                        <span
                                class="mention-badge"
                                style={token.accentColor ? `--mention-accent: ${token.accentColor}` : undefined}
                                data-mention-type={token.mentionType}
                                data-user-menu={token.mentionType === 'user' ? 'true' : undefined}
                                data-channel-kind={token.mentionType === 'channel' ? token.channelKind ?? 'text' : undefined}
                        >
                                {#if token.mentionType === 'channel' && token.channelKind === 'voice'}
                                        <Volume2 class="mention-badge__icon" stroke-width={2} aria-hidden="true" />
                                {/if}
                                <span class="mention-badge__label">{token.label}</span>
                        </span>
                {/if}
	{:else}
		<code
			class="rounded border border-[var(--stroke)] bg-[var(--panel-strong)] px-1 py-0.5 font-mono whitespace-pre-wrap"
		>
			{token.content}
		</code>
	{/if}
{/each}
