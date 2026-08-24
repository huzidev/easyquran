<script lang="ts">
  import type { QuranData } from "$lib/data/quran-data";
  import HighlightedArabic from "$lib/components/text/HighlightedArabic.svelte";
  import HighlightedText from "$lib/components/text/HighlightedText.svelte";
  import { TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";
  import { ayahHrefFor, openVerse } from "$lib/search/page/navigate";
  import type { SectionHit, SectionState } from "$lib/search/page/types";

  let {
    hit,
    section,
    quranData,
  }: {
    hit: SectionHit;
    section: SectionState;
    quranData: QuranData | null;
  } = $props();

  const surah = $derived(quranData?.surahByNum(hit.surah) ?? null);
  const href = $derived(quranData ? ayahHrefFor(section.id, quranData, hit.surah, hit.ayah) : null);
  const label = $derived(
    surah ? `${surah.name} ${hit.surah}:${hit.ayah}` : `${hit.surah}:${hit.ayah}`,
  );
  const direction = $derived(TRANSLATION_CATALOGUE_BY_ID.get(section.id)?.direction ?? "ltr");

  function opened(): void {
    openVerse(hit.surah, hit.ayah, section.kind === "translation" ? section.id : undefined);
  }
</script>

<div class="flex flex-col gap-1.5 py-3">
  {#if href !== null}
    <a
      href={href}
      onclick={opened}
      class="w-fit text-[12px] font-medium text-fg-3 underline-offset-4 transition-colors hover:text-fg hover:underline"
    >
      {label}
    </a>
  {:else}
    <span class="w-fit text-[12px] font-medium text-fg-3">{label}</span>
  {/if}

  {#if hit.text.length > 0}
    {#if section.kind === "arabic"}
      <HighlightedArabic text={hit.text} highlights={hit.highlights} class="max-w-[62ch]" />
    {:else}
      <HighlightedText text={hit.text} highlights={hit.highlights} dir={direction} />
    {/if}
  {/if}
</div>
