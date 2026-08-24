<script lang="ts">
  import { onMount } from "svelte";
  import { replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { loadQuranData } from "$lib/data/quran-data-client";
  import type { QuranData } from "$lib/data/quran-data";
  import { TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";
  import { MIN_QUERY_LEN } from "$lib/quran/search/normalize";
  import { getSearchCopy } from "$lib/i18n/search-copy";
  import { createSearchEngine } from "$lib/search/page/engine.svelte";
  import { parseSearchUrl, serializeSearchState } from "$lib/search/page/query-url";
  import { resolveDefaultSelection } from "$lib/search/page/selection";
  import type { SectionState } from "$lib/search/page/types";
  import { reader } from "$lib/stores/reader.svelte";
  import { searchSelection } from "$lib/stores/search-selection.svelte";
  import { stackedTranslations } from "$lib/stores/stacked-translations.svelte";
  import { storageReport } from "$lib/stores/storage-report.svelte";

  import NavSuggestions from "./_components/NavSuggestions.svelte";
  import ResultSection from "./_components/ResultSection.svelte";
  import SearchControls from "./_components/SearchControls.svelte";
  import SurahSuggestions from "./_components/SurahSuggestions.svelte";
  import TranslationPicker from "./_components/TranslationPicker.svelte";

  const copy = getSearchCopy();
  const engine = createSearchEngine();

  let quranData = $state<QuranData | null>(null);
  let pickerOpen = $state(false);
  let adoptedSelection = false;
  let lastSelectionKey: string | null = null;

  const committedTooShort = $derived(
    engine.committedQuery.length < MIN_QUERY_LEN && engine.navSuggestions.length === 0,
  );

  const orderedSections = $derived.by(() => {
    void engine.sectionList;
    const byId = new Map(engine.sectionList.map((section) => [section.id, section]));
    const out: SectionState[] = [];
    const arabic = byId.get("arabic");
    if (arabic) out.push(arabic);
    for (const id of searchSelection.ids) {
      const section = byId.get(id);
      if (section && section.kind === "translation") out.push(section);
    }
    return out;
  });

  const selectedChips = $derived(
    searchSelection.ids
      .map((id) => TRANSLATION_CATALOGUE_BY_ID.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      .map((entry) => ({ id: entry.id, name: entry.translator ?? entry.name })),
  );

  const suggestSourceId = $derived(reader.lastRead?.sourceId ?? "arabic");

  onMount(() => {
    const initial = parseSearchUrl(page.url);
    searchSelection.setIds(
      resolveDefaultSelection({
        urlT: initial.t,
        persisted: searchSelection.ids,
        lastReadSourceId: reader.lastRead?.sourceId,
        stackedIds: stackedTranslations.ids,
      }),
    );
    adoptedSelection = true;
    if (initial.q.length > 0) engine.run(initial.q);
    void loadQuranData().then(
      (data) => {
        quranData = data;
      },
      () => undefined,
    );
    storageReport.hydrate();
    return () => engine.dispose();
  });

  $effect(() => {
    if (!adoptedSelection) return;
    const ids = searchSelection.ids;
    const key = ids.join(",");
    if (lastSelectionKey === null) {
      lastSelectionKey = key;
      return;
    }
    if (key === lastSelectionKey) return;
    lastSelectionKey = key;
    if (engine.committedQuery.length >= MIN_QUERY_LEN) engine.run(engine.committedQuery);
  });

  $effect(() => {
    void storageReport.artifacts;
    engine.onArtifactsChanged();
  });

  $effect(() => {
    const next = serializeSearchState(engine.committedQuery, searchSelection.ids);
    if (next === page.url.search) return;
    try {
      replaceState(`${page.url.pathname}${next}`, page.state);
    } catch {
      return;
    }
  });

  function togglePicker(): void {
    pickerOpen = !pickerOpen;
  }
</script>

<svelte:head>
  <title>{copy.title} · EasyQuran</title>
</svelte:head>

<div lang={copy.locale} dir={copy.direction}>
  <div class="mx-auto max-w-[1180px] px-6 pt-5 pb-10 sm:px-7 sm:pt-6 sm:pb-12">
    <h1 class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg">{copy.title}</h1>

    <div class="mt-5 flex flex-col gap-4 sm:mt-6">
      <SearchControls
        {copy}
        query={engine.inputQuery}
        searching={engine.searching}
        selected={selectedChips}
        {pickerOpen}
        onQuery={(value) => engine.run(value)}
        onRemove={(id) => searchSelection.remove(id)}
        onTogglePicker={togglePicker}
      />

      {#if pickerOpen}
        <TranslationPicker {copy} />
      {/if}

      <NavSuggestions
        {copy}
        matches={engine.navSuggestions}
        {quranData}
        sourceId={suggestSourceId}
      />

      <SurahSuggestions
        {copy}
        suggestions={engine.surahSuggestions}
        {quranData}
        sourceId={suggestSourceId}
      />

      <div class="mt-2 flex flex-col gap-6" aria-label={copy.resultsLabel}>
        {#if committedTooShort}
          {#if engine.inputQuery.length === 0}
            <p class="text-[13.5px] text-fg-3">{copy.emptyIdle}</p>
          {:else}
            <p class="text-[13.5px] text-fg-3">{copy.tooShort}</p>
          {/if}
        {:else if orderedSections.length === 0}
          <p class="text-[13.5px] text-fg-3">{copy.pickPrompt}</p>
        {:else}
          {#each orderedSections as section (section.id)}
            <ResultSection
              {section}
              {copy}
              {quranData}
              onRetry={(sectionId) => engine.retry(sectionId)}
              onLoadMore={(sectionId) => engine.loadMore(sectionId)}
            />
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>
