<script lang="ts">
  import type { TranslationCatalogueEntry } from "$lib/data/quran-types";
  import type { SearchCopy } from "$lib/i18n/search-copy";
  import { quranWorker } from "$lib/quran/worker-client";
  import { searchSelection } from "$lib/stores/search-selection.svelte";
  import { formatBytes } from "$lib/utils";

  let {
    entry,
    copy,
    selected,
    cached,
    progress,
  }: {
    entry: TranslationCatalogueEntry;
    copy: SearchCopy;
    selected: boolean;
    cached: boolean;
    progress: { loaded: number; total: number } | null;
  } = $props();

  const rtl = $derived(entry.direction === "rtl");
  const pct = $derived(
    progress !== null && progress.total > 0
      ? Math.round((progress.loaded / progress.total) * 100)
      : null,
  );

  function download(): void {
    if (cached || rtl) return;
    void quranWorker.ensureTranslation(entry.id).catch(() => {});
  }
</script>

<div
  class="flex flex-col gap-1.5 rounded-[7px] px-3 py-2 text-[12.5px] transition-colors hover:bg-bg-2"
>
  <div class="flex items-center gap-2">
    <input
      id={`search-t-${entry.id}`}
      type="checkbox"
      checked={selected}
      disabled={rtl}
      onchange={() => searchSelection.toggle(entry.id)}
      class="h-4 w-4 flex-none accent-[var(--accent)]"
    />
    <label for={`search-t-${entry.id}`} class="min-w-0 flex-1 truncate text-fg-2">
      {entry.name}
      {#if entry.translator !== null}
        <span class="text-fg-4"> · {entry.translator}</span>
      {/if}
    </label>

    {#if cached}
      <span class="flex-none rounded-full bg-bg-3 px-1.5 py-0.5 text-[10px] text-fg-3">
        {copy.cached} · {formatBytes(entry.sizeBytes)}
      </span>
    {:else if rtl}
      <span class="flex-none text-[11px] text-fg-4">{copy.rtlDisabled}</span>
    {:else}
      <button
        type="button"
        onclick={download}
        disabled={pct !== null}
        class="flex-none rounded-full border border-line-2 px-2.5 py-1 text-[11px] text-fg-2 transition-colors hover:border-line hover:text-fg disabled:opacity-60"
      >
        {#if pct !== null}
          {copy.downloading}
        {:else}
          {copy.download}
        {/if}
      </button>
    {/if}
  </div>

  {#if pct !== null && !cached}
    <div class="ms-6 h-1 w-full max-w-[280px] overflow-hidden rounded-full bg-bg-3">
      <div class="h-full rounded-full bg-accent transition-[width]" style:width={`${pct}%`}></div>
    </div>
  {/if}
</div>
