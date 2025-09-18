<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<style>
		body {
			overflow: hidden;
		}
	</style>
</svelte:head>

{@render children?.()}
