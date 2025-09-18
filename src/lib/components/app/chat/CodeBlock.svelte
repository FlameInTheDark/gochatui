<script lang="ts">
	import hljs from 'highlight.js/lib/common';

	export let code: string;
	export let language: string | undefined;

	function highlight(code: string, language?: string) {
		if (language) {
			const normalized = language.trim().toLowerCase();
			if (normalized && hljs.getLanguage(normalized)) {
				try {
					return hljs.highlight(code, { language: normalized }).value;
				} catch {
					return hljs.highlightAuto(code).value;
				}
			}
		}
		return hljs.highlightAuto(code).value;
	}

	$: highlighted = highlight(code, language);
</script>

<pre class="hljs m-0 overflow-x-auto rounded-md border border-[var(--stroke)] bg-[var(--panel-strong)] px-3 py-2 text-sm">{@html highlighted}</pre>
