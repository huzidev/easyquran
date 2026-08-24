<script lang="ts">
  import type { TranslationDirection } from "$lib/data/quran-types";
  import type { Highlight } from "$lib/quran/search/types";
  import { highlightSegments } from "$lib/quran/search/highlights";
  import { cn } from "$lib/utils";

  let {
    text,
    highlights,
    dir,
    class: className,
  }: { text: string; highlights: readonly Highlight[]; dir: TranslationDirection; class?: string } =
    $props();
  const segments = $derived(highlightSegments(text, highlights));
</script>

<span {dir} class={cn("text-fg", className)}>
  {#each segments as segment (`${segment.start}:${segment.end}:${segment.highlighted}`)}
    {#if segment.highlighted}
      <mark class="rounded-sm bg-accent-soft text-inherit">{segment.text}</mark>
    {:else}
      {segment.text}
    {/if}
  {/each}
</span>
