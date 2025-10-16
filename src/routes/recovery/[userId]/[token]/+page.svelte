<script lang="ts">
	import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	let resetDefaults = $state({
		id: data.userId,
		token: data.token
	});

	$effect(() => {
		resetDefaults = {
			id: data.userId,
			token: data.token
		};
	});
</script>

<AuthGate initialMode="reset" {resetDefaults} forceAuthFlow />
