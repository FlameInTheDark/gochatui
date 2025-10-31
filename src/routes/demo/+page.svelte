<script lang="ts">
        import { base } from '$app/paths';

        import ServerBar from '$lib/components/server-bar/ServerBar.svelte';
</script>

<main class="demo-page">
        <a class="demo-link" href={`${base}/demo/paraglide`}>paraglide</a>
        <section class="server-bar-preview">
                <ServerBar />
        </section>
</main>

<style>
        .demo-page {
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                padding: 1.5rem;
        }

        .demo-link {
                color: inherit;
                text-decoration: underline;
                width: fit-content;
        }

        .server-bar-preview {
                border-radius: 1rem;
                overflow: hidden;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
        }

        .server-bar-preview :global(.server-bar-demo) {
                border-radius: inherit;
        }
</style>
