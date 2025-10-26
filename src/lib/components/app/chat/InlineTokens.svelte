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
                                class={`mention-pill ${token.mentionType === 'user' ? 'mention-user' : ''} ${
                                        token.mentionType === 'role' ? 'mention-role' : ''
                                } ${token.mentionType === 'channel' ? 'mention-channel' : ''}`}
                                style={token.accentColor ? `--mention-accent: ${token.accentColor}` : undefined}
                                onclick={token.onClick}
                                data-user-menu={token.mentionType === 'user' ? 'true' : undefined}
                        >
                                {#if token.mentionType === 'channel' && token.channelKind === 'voice'}
                                        <span class="icon" aria-hidden="true">
                                                <Volume2 class="h-3.5 w-3.5" stroke-width={2} />
                                        </span>
                                {/if}
                                <span class="label">{token.label}</span>
                        </button>
		{:else}
                        <span
                                class={`mention-pill ${token.mentionType === 'user' ? 'mention-user' : ''} ${
                                        token.mentionType === 'role' ? 'mention-role' : ''
                                } ${token.mentionType === 'channel' ? 'mention-channel' : ''}`}
                                style={token.accentColor ? `--mention-accent: ${token.accentColor}` : undefined}
                                data-user-menu={token.mentionType === 'user' ? 'true' : undefined}
                        >
                                {#if token.mentionType === 'channel' && token.channelKind === 'voice'}
                                        <span class="icon" aria-hidden="true">
                                                <Volume2 class="h-3.5 w-3.5" stroke-width={2} />
                                        </span>
                                {/if}
                                <span class="label">{token.label}</span>
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

<style>
        .mention-pill {
                display: inline-flex;
                align-items: center;
                gap: 0.25rem;
                padding: 0.125rem 0.5rem;
                margin: 0 0.125rem 0 0.125rem;
                border-radius: 9999px;
                font-weight: 500;
                font-size: inherit;
                border: none;
                background-color: color-mix(in srgb, var(--mention-accent, #5865f2) 16%, transparent);
                color: var(--mention-accent, #5865f2);
                line-height: 1.2;
                white-space: nowrap;
        }

        .mention-pill .icon {
                display: inline-flex;
                flex-shrink: 0;
        }

        .mention-pill .icon :global(svg) {
                width: 1em;
                height: 1em;
        }

        .mention-pill .label {
                display: inline-flex;
                align-items: center;
        }

        .mention-pill.mention-channel {
                background-color: color-mix(in srgb, var(--mention-accent, #4f545c) 35%, transparent);
                color: #f2f3f5;
        }

        .mention-pill.mention-role,
        .mention-pill.mention-user {
                color: var(--mention-accent, #5865f2);
        }

	button.mention-pill {
		cursor: pointer;
	}

	button.mention-pill:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
</style>
