<script lang="ts">
  import type { QuranData } from "$lib/data/quran-data";
  import type { SearchCopy } from "$lib/i18n/search-copy";
  import { peekTranslationName } from "$lib/quran/catalogue";
  import { MAX_OFFSET } from "$lib/quran/search/normalize";
  import { Skeleton } from "$lib/components/ui/skeleton";

  import AyahResult from "./AyahResult.svelte";
  import type { SectionHit, SectionState } from "$lib/search/page/types";

  let {
    section,
    copy,
    quranData,
    onRetry,
    onLoadMore,
  }: {
    section: SectionState;
    copy: SearchCopy;
    quranData: QuranData | null;
    onRetry: (sectionId: string) => void;
    onLoadMore: (sectionId: string) => void;
  } = $props();

  const heading = $derived(
    section.kind === "arabic" ? copy.sectionQuran : (peekTranslationName(section.id) ?? section.id),
  );
  const canLoadMore = $derived(
    section.phase === "done" && section.offset < MAX_OFFSET && section.offset < section.total,
  );

  const keyFor = (hit: SectionHit): string => `${hit.surah}:${hit.ayah}`;
</script>

<section aria-label={heading} class="flex flex-col gap-2">
  <div class="flex items-baseline justify-between gap-3">
    <h2 class="text-[14.5px] font-medium text-fg">{heading}</h2>
    {#if section.phase === "done" || section.phase === "more"}
      <span class="text-[12px] tabular-nums text-fg-3">{copy.count(section.total)}</span>
    {/if}
  </div>

  {#if section.phase === "gated"}
    <p class="text-[13px] text-fg-3">{copy.arabicOnlyNote}</p>
  {:else if section.phase === "loading"}
    <div class="flex flex-col gap-3 py-2" aria-hidden="true">
      <Skeleton class="h-12 w-full" />
      <Skeleton class="h-12 w-full" />
      <Skeleton class="h-12 w-full" />
    </div>
  {:else if section.phase === "error"}
    <p class="text-[13px] text-fg-3" role="alert">{copy.errorSection}</p>
    <button
      type="button"
      onclick={() => onRetry(section.id)}
      class="w-fit rounded-full border border-line-2 px-3.5 py-1.5 text-[12.5px] text-fg-2 transition-colors hover:border-line hover:text-fg"
    >
      {copy.retry}
    </button>
  {:else if section.hits.length === 0}
    <p class="text-[13px] text-fg-3">{copy.noResults}</p>
  {:else}
    <div class="divide-y divide-line">
      {#each section.hits as hit (keyFor(hit))}
        <AyahResult {hit} {section} {quranData} />
      {/each}
    </div>
    {#if section.phase === "more"}
      <p class="text-[12.5px] text-fg-3">{copy.loadingMore}</p>
    {:else if canLoadMore}
      <button
        type="button"
        onclick={() => onLoadMore(section.id)}
        class="w-fit rounded-full border border-line-2 px-3.5 py-1.5 text-[12.5px] text-fg-2 transition-colors hover:border-line hover:text-fg"
      >
        {copy.loadMore}
      </button>
    {/if}
  {/if}
</section>
