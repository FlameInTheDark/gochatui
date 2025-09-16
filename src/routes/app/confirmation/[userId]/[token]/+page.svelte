<script lang="ts">
        import AuthGate from '$lib/components/app/auth/AuthGate.svelte';
        import type { PageData } from './$types';

        let { data } = $props<{ data: PageData }>();

        let confirmDefaults = $state({
                id: data.userId,
                token: data.token
        });

        $effect(() => {
                confirmDefaults = {
                        id: data.userId,
                        token: data.token
                };
        });
</script>

<AuthGate
        initialMode="confirm"
        confirmDefaults={confirmDefaults}
        redirectTo="/app"
/>
