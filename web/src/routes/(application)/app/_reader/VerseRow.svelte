<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { browser } from "$app/environment";
  import { page } from "$app/state";
  import { reader } from "$lib/stores/reader.svelte";
  import { toArabicDigits } from "$lib/data/quran";
  import type { StackedTranslation } from "$lib/data/quran-types";

  let {
    text,
    n,
    vKey,
    isTranslation,
    onToggleNote,
    stacked = [],
    stackedPending = [],
    stackedErrored = [],
    stackedErrorLabel = "",
  }: {
    text: string;
    n: number;
    vKey: string;
    isTranslation?: boolean;
    onToggleNote?: () => void;
    stacked?: readonly StackedTranslation[];
    stackedPending?: readonly string[];
    stackedErrored?: readonly string[];
    stackedErrorLabel?: string;
  } = $props();
  let Tools = $state<
    Component<{ text: string; vKey: string; onToggleNote?: () => void }> | null
  >(null);
  let hovered = $state(false);
  let focused = $state(false);
  let isDesktop = $state(false);

  const ayahId = $derived(`ayah-${vKey.replace(":", "-")}`);
  const isRevealed = $derived(page.url.hash === `#${ayahId}`);
  const translationActive = $derived(
    isTranslation ?? ("lang" in page.params && "translator" in page.params),
  );
  const noteOpen = $derived(reader.openNote === vKey);
  const showTools = $derived(!isDesktop || hovered || focused || noteOpen);

  type ExtraRow =
    | { kind: "skeleton"; sourceId: string }
    | { kind: "error"; sourceId: string }
    | { kind: "text"; t: StackedTranslation };
  function extraRowKey(row: ExtraRow): string {
    if (row.kind === "text") return `text-${row.t.sourceId}`;
    return `${row.kind}-${row.sourceId}`;
  }
  const extraRows = $derived<ExtraRow[]>([
    ...stackedPending.map((sourceId): ExtraRow => ({ kind: "skeleton", sourceId })),
    ...stackedErrored.map((sourceId): ExtraRow => ({ kind: "error", sourceId })),
    ...stacked.map((t): ExtraRow => ({ kind: "text", t })),
  ]);

  onMount(() => {
    void import("./VerseTools.svelte")
      .then((module) => {
        Tools = module.default;
      })
      .catch(() => {});
    if (!browser) return;
    const mq = matchMedia("(min-width: 768px)");
    isDesktop = mq.matches;
    const update = () => {
      isDesktop = mq.matches;
    };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  });
</script>

<!--
  Verses are a deliberate tab stop: focusing one reveals its tools (bookmark, note, copy), which is
  the only keyboard path to them. Reviewed exception, not an oversight — revisit if the tools ever
  get their own focusable controls.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<li
  id={ayahId}
  data-verse-key={vKey}
  tabindex={showTools ? -1 : 0}
  class="verse-row group relative scroll-mt-24 border-b border-line px-5 pb-[22px] pt-[62px] transition-colors sm:px-9 {isRevealed
    ? 'revealed-ayah'
    : ''}"
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={() => (focused = false)}
>
  {#if translationActive}
    <span
      lang={page.params.lang}
      dir="auto"
      class="verse-text verse-text--translation leading-[1.85] text-fg"
      style="font-size:var(--reader-translation-size, 1.0625rem)"
    >
      {text}<span class="ayah-marker translation-marker" data-verse-anchor={vKey}>{n}</span>
    </span>
  {:else}
    <span
      dir="rtl"
      lang="ar"
      class="verse-text font-arabic leading-[2.15] text-fg"
      style="font-size:var(--reader-arabic-size, 33px)"
    >
      {text}<span class="ayah-marker arabic-marker" data-verse-anchor={vKey}>{toArabicDigits(n)}</span>
    </span>
  {/if}

  {#if reader.isVerseMode}
    {#each extraRows as row (extraRowKey(row))}
      {#if row.kind === "skeleton"}
        <div class="verse-extra verse-extra--skeleton" aria-hidden="true"></div>
      {:else if row.kind === "error"}
        <span class="verse-extra verse-extra--error">{stackedErrorLabel}</span>
      {:else}
        <span
          class="verse-extra"
          dir={row.t.direction === "rtl" ? "rtl" : "auto"}
          lang={row.t.languageCode}
          style="font-size:var(--reader-translation-size, 1.0625rem)"
        >
          <span class="verse-extra-label">{row.t.translator ?? row.t.language}</span>{row.t.text}
        </span>
      {/if}
    {/each}
  {/if}

  {#if Tools && showTools}
    <Tools {text} {vKey} {onToggleNote} />
  {/if}
</li>

<style>
  .verse-text {
    display: block;
    text-align: right;
  }

  .verse-row .verse-text {
    font-family: var(--reader-arabic-family, var(--font-arabic));
  }

  .verse-row .verse-text--translation {
    font-family: var(--reader-translation-family, var(--font-sans));
    text-align: start;
  }

  .verse-row .arabic-marker {
    font-family: var(--reader-arabic-family, var(--font-arabic));
  }

  .verse-row .translation-marker {
    font-family: var(--reader-translation-family, var(--font-sans));
  }

  :global([data-reader-mode="reading"] [data-source-kind="arabic"]) .verse-row {
    display: inline;
    padding: 0;
    border: 0;
  }

  :global([data-reader-mode="reading"] [data-source-kind="arabic"]) .verse-text {
    display: inline;
  }

  .verse-extra {
    display: block;
    border-top: 1px solid var(--line);
    font-family: var(--reader-translation-family, var(--font-sans));
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    text-align: start;
  }

  .verse-extra-label {
    color: var(--fg-3);
    font-size: 0.8rem;
    margin-inline-end: 0.4rem;
  }

  .verse-extra--error {
    color: var(--fg-3);
    font-size: 0.95rem;
  }

  .verse-extra--skeleton {
    background: var(--bg-2);
    border-radius: 0.25rem;
    height: 1.2rem;
  }
</style>
