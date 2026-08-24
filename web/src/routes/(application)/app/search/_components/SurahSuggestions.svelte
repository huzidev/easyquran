<script lang="ts">
  import type { QuranData } from "$lib/data/quran-data";
  import type { SearchCopy } from "$lib/i18n/search-copy";
  import { surahHrefFor } from "$lib/search/page/navigate";
  import type { SurahSuggestion } from "$lib/search/page/types";

  let {
    copy,
    suggestions,
    quranData,
    sourceId,
  }: {
    copy: SearchCopy;
    suggestions: readonly SurahSuggestion[];
    quranData: QuranData | null;
    sourceId: string | null;
  } = $props();

  const hrefFor = (num: number): string | null =>
    quranData && sourceId !== null ? surahHrefFor(sourceId, quranData, num) : null;
</script>

{#if suggestions.length > 0}
  <section aria-label={copy.sectionSurahs} class="flex flex-col gap-1.5">
    <h2 class="text-[14.5px] font-medium text-fg">{copy.sectionSurahs}</h2>
    <ul class="flex flex-wrap gap-1.5">
      {#each suggestions as suggestion (suggestion.num)}
        {@const href = hrefFor(suggestion.num)}
        <li>
          {#if href !== null}
            <a
              href={href}
              class="flex items-baseline gap-1.5 rounded-full border border-line-2 bg-bg-1 px-3 py-1.5 text-[12.5px] text-fg-2 transition-colors hover:border-line hover:text-fg"
            >
              <span class="truncate">{suggestion.num}. {suggestion.transliteration}</span>
              <span lang="ar" dir="rtl" class="font-arabic text-fg-3">{suggestion.arabic}</span>
            </a>
          {:else}
            <span
              class="flex items-baseline gap-1.5 rounded-full border border-line-2 bg-bg-1 px-3 py-1.5 text-[12.5px] text-fg-3"
            >
              <span class="truncate">{suggestion.num}. {suggestion.transliteration}</span>
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
