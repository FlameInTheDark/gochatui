<script lang="ts">
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
				{token.label}
			</button>
		{:else}
			<span
				class={`mention-pill ${token.mentionType === 'user' ? 'mention-user' : ''} ${
					token.mentionType === 'role' ? 'mention-role' : ''
				} ${token.mentionType === 'channel' ? 'mention-channel' : ''}`}
				style={token.accentColor ? `--mention-accent: ${token.accentColor}` : undefined}
				data-user-menu={token.mentionType === 'user' ? 'true' : undefined}
			>
				{token.label}
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
		padding: 0 0.5rem;
		margin: 0 0.125rem 0 0.125rem;
		border-radius: 9999px;
		font-weight: 500;
		font-size: 0.9em;
		border: none;
		background-color: rgba(88, 101, 242, 0.16);
		background-color: color-mix(in srgb, var(--mention-accent, var(--brand)) 16%, transparent);
		color: var(--mention-accent, var(--brand));
		line-height: 1.4;
		white-space: nowrap;
	}

	.mention-pill.mention-channel {
		color: var(--brand);
	}

	.mention-pill.mention-role,
	.mention-pill.mention-user {
		color: var(--mention-accent, var(--brand));
	}

	button.mention-pill {
		cursor: pointer;
	}

	button.mention-pill:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
</style>
