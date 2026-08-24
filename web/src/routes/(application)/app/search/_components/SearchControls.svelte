<script lang="ts">
  import type { SearchCopy } from "$lib/i18n/search-copy";

  let {
    copy,
    query,
    searching,
    selected,
    pickerOpen,
    onQuery,
    onRemove,
    onTogglePicker,
  }: {
    copy: SearchCopy;
    query: string;
    searching: boolean;
    selected: { id: string; name: string }[];
    pickerOpen: boolean;
    onQuery: (value: string) => void;
    onRemove: (id: string) => void;
    onTogglePicker: () => void;
  } = $props();
</script>

<div class="flex flex-col gap-3">
  <div>
    <label for="search-query" class="sr-only">{copy.inputLabel}</label>
    <input
      id="search-query"
      type="search"
      value={query}
      oninput={(event) => onQuery(event.currentTarget.value)}
      placeholder={copy.placeholder}
      aria-busy={searching}
      autocomplete="off"
      spellcheck="false"
      class="h-11 w-full rounded-xl border border-line-2 bg-bg-2 px-4 text-[14.5px] text-fg shadow-none outline-none transition-colors placeholder:text-fg-3 focus:border-line-3 focus:ring-2 focus:ring-accent/40"
    />
  </div>

  <div class="flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      onclick={onTogglePicker}
      aria-expanded={pickerOpen}
      class="flex items-center gap-1.5 rounded-full border border-line-2 bg-bg-1 px-3.5 py-1.5 text-[13px] text-fg-2 transition-colors hover:border-line hover:text-fg"
    >
      {copy.filterOpen}
      {#if selected.length > 0}
        <span class="text-fg-4">·</span>
        <span class="text-fg-3">{copy.filterSelected(selected.length)}</span>
      {/if}
    </button>

    {#each selected as chip (chip.id)}
      <span
        class="flex items-center gap-1 rounded-full border border-line-2 bg-bg-2 px-3 py-1 text-[12.5px] text-fg-2"
      >
        <span class="max-w-[220px] truncate">{chip.name}</span>
        <button
          type="button"
          onclick={() => onRemove(chip.id)}
          aria-label={`${chip.name} ×`}
          class="p-0.5 text-fg-3 transition-colors hover:text-fg"
        >
          ×
        </button>
      </span>
    {/each}
  </div>
</div>
