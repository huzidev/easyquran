<script lang="ts">
  import type { TranslationCatalogueEntry } from "$lib/data/quran-types";
  import type { SearchCopy } from "$lib/i18n/search-copy";
  import { publicHref } from "$lib/i18n/public-href";
  import { TRANSLATION_CATALOGUE } from "$lib/quran/catalogue";
  import { quranWorker } from "$lib/quran/worker-client";
  import { searchSelection } from "$lib/stores/search-selection.svelte";
  import { storageReport } from "$lib/stores/storage-report.svelte";

  import TranslationRow from "./TranslationRow.svelte";

  const SETTINGS_PATH = "/app/settings";

  let { copy }: { copy: SearchCopy } = $props();

  let filter = $state("");
  let progress = $state<Record<string, { loaded: number; total: number }>>({});

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return TRANSLATION_CATALOGUE;
    return TRANSLATION_CATALOGUE.filter(
      (entry) =>
        entry.language.toLowerCase().includes(q) ||
        (entry.translator !== null && entry.translator.toLowerCase().includes(q)) ||
        entry.id.toLowerCase().includes(q) ||
        entry.name.toLowerCase().includes(q),
    );
  });

  const grouped = $derived.by(() => {
    const map = new Map<string, TranslationCatalogueEntry[]>();
    for (const entry of filtered) {
      const arr = map.get(entry.language);
      if (arr) arr.push(entry);
      else map.set(entry.language, [entry]);
    }
    return [...map.entries()].map(([language, entries]) => ({ language, entries }));
  });

  const cachedIds = $derived(new Set(storageReport.artifacts.map((artifact) => artifact.id)));

  $effect(() => {
    const detach = quranWorker.onProgress((p) => {
      progress = { ...progress, [p.script]: { loaded: p.loaded, total: p.total } };
    });
    return detach;
  });
</script>

<section
  aria-label={copy.filterTitle}
  class="flex flex-col gap-3 rounded-xl border border-line-2 bg-bg-1 p-4"
>
  <h2 class="text-[14.5px] font-medium text-fg">{copy.filterTitle}</h2>

  <label
    class="flex items-center gap-2 rounded-[9px] border border-line bg-bg-2 px-3 py-2 transition-colors focus-within:border-line-3 focus-within:ring-2 focus-within:ring-accent/40"
  >
    <span class="sr-only">{copy.filterPlaceholder}</span>
    <input
      type="search"
      value={filter}
      oninput={(event) => (filter = event.currentTarget.value)}
      placeholder={copy.filterPlaceholder}
      class="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-[13px] text-fg shadow-none outline-none placeholder:text-fg-3 focus:ring-0"
    />
  </label>

  {#if grouped.length === 0}
    <p class="px-1 py-2 text-[12.5px] text-fg-3" role="status">{copy.filterNone}</p>
  {/if}

  <div class="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
    {#each grouped as group (group.language)}
      <section>
        <div class="px-1 py-1 text-[10.5px] uppercase tracking-wide text-fg-4">
          {group.language}
        </div>
        <ul class="flex flex-col gap-0.5">
          {#each group.entries as entry (entry.id)}
            <li>
              <TranslationRow
                {entry}
                {copy}
                selected={searchSelection.ids.includes(entry.id)}
                cached={cachedIds.has(entry.id)}
                progress={progress[entry.id] ?? null}
              />
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>

  <a
    href={publicHref(SETTINGS_PATH)}
    class="text-[12.5px] text-fg-3 underline-offset-4 transition-colors hover:text-fg hover:underline"
  >
    {copy.manageStorage}
  </a>
</section>
