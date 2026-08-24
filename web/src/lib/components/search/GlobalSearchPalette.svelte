<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { routeContextFromParams, type SurahRouteContext } from "$lib/data/quran";
  import { uiDirection, type UiLocale } from "$lib/i18n/locales";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { authState } from "$lib/auth/auth-state.svelte";
  import { commandPalette } from "$lib/stores/command-palette.svelte";
  import { reader } from "$lib/stores/reader.svelte";
  import {
    createPaletteEngine,
    registerBuiltinPaletteSources,
    resolveHref,
    type PaletteEntry,
  } from "$lib/search/palette";
  import * as Cmd from "$lib/components/ui/command";
  import { Icon } from "$lib/components/icon";
  import { HighlightedArabic } from "$lib/components/text";
  import HighlightedText from "$lib/components/text/HighlightedText.svelte";

  registerBuiltinPaletteSources();

  // SAFETY: paraglide is compiled for exactly the UI locales (en/ar in messages/), so getLocale() only ever returns a UiLocale at runtime.
  const locale = getLocale() as UiLocale;
  const direction = uiDirection(locale);
  const routeContext = $derived<SurahRouteContext>(routeContextFromParams(page.params));

  const engine = createPaletteEngine({
    query: () => commandPalette.query,
    open: () => commandPalette.open,
    routeContext: () => routeContext,
  });

  let selected = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);

  onMount(() => {
    // Both feed palette entries ("Continue reading", Account vs Sign in) and are
    // idempotent, so hydrating here covers marketing pages too.
    reader.hydrate();
    authState.hydrate();
  });

  afterNavigate(() => commandPalette.hide());

  // The global shortcuts live in GlobalSearch.svelte, which stays mounted and
  // loads this component on demand; handling them here too would double-fire.

  /**
   * Keep the caret in the palette for as long as it is open. Focusing once is
   * not enough: the page underneath can focus its own controls after mount, and
   * keystrokes would then land in a box the user cannot see.
   */
  $effect(() => {
    const el = inputEl;
    if (!commandPalette.open || !el) return;
    el.focus();
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target;
      if (target instanceof Node && el.closest("[data-slot=command-dialog]")?.contains(target)) {
        return;
      }
      el.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  });

  // Sources re-rank on every keystroke, so keep the highlight on a row that
  // still exists — otherwise Enter would fire on a stale value.
  $effect(() => {
    const ids = engine.entries.map((entry) => entry.id);
    if (ids.includes(untrack(() => selected))) return;
    selected = ids[0] ?? "";
  });

  const query = $derived(commandPalette.query.trim());
  const showEmpty = $derived(
    engine.ready && !engine.searching && query.length > 0 && engine.entries.length === 0,
  );

  /**
   * Navigable entries render as anchors, so the browser (and SvelteKit's router)
   * performs the navigation for both clicks and Enter — doing it here as well
   * would navigate twice. Those rows are closed by `afterNavigate` instead,
   * which also keeps the anchor mounted until its navigation has committed.
   */
  function activate(entry: PaletteEntry): void {
    entry.run?.();
    if (!entry.href) commandPalette.hide();
  }
</script>

<Cmd.Dialog
  bind:open={commandPalette.open}
  bind:value={selected}
  shouldFilter={false}
  lang={locale}
  dir={direction}
  label="Global search"
  loop
>
  <Cmd.Input
    bind:ref={inputEl}
    bind:value={() => commandPalette.query, (v) => commandPalette.setQuery(v)}
    placeholder="Search verses, surahs, juz, pages…"
    aria-label="Search the Quran and the site"
  />

  <Cmd.List>
    {#if engine.catalogueFailed}
      <Cmd.Empty forceMount>
        The Quran catalogue could not be loaded. Check your connection and reopen search.
      </Cmd.Empty>
    {:else if !engine.ready}
      <Cmd.Loading>Loading the Quran catalogue…</Cmd.Loading>
    {:else if engine.searching}
      <Cmd.Loading>Searching the Quran text…</Cmd.Loading>
    {/if}

    {#if showEmpty}
      <Cmd.Empty forceMount>
        No matches for “{query}”.
        {#if engine.failedSources.length > 0}
          Some sources are unavailable right now.
        {/if}
      </Cmd.Empty>
    {/if}

    {#each engine.sections as section (section.group.id)}
      <Cmd.Group heading={section.group.label} value={section.group.id}>
        {#each section.entries as entry (entry.id)}
          {#snippet body()}
            <Icon name={entry.icon} size={15} class="shrink-0 text-fg-4" />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate text-fg">{entry.label}</span>
              {#if entry.preview?.dir}
                <HighlightedText
                  text={entry.preview.text}
                  highlights={entry.preview.highlights}
                  dir={entry.preview.dir}
                  class="line-clamp-2 text-[13px] leading-normal"
                />
              {:else if entry.preview}
                <HighlightedArabic
                  text={entry.preview.text}
                  highlights={entry.preview.highlights}
                  class="line-clamp-2 text-[19px] leading-[1.9]"
                />
              {:else if entry.detail}
                <span class="truncate text-[11.5px] text-fg-3">{entry.detail}</span>
              {/if}
            </span>
            {#if entry.arabic}
              <span dir="rtl" class="ml-auto flex-none font-arabic text-[16px] leading-none">
                {entry.arabic}
              </span>
            {/if}
          {/snippet}

          {#if entry.href}
            <Cmd.LinkItem
              value={entry.id}
              href={resolveHref(entry.href)}
              onSelect={() => activate(entry)}
            >
              {@render body()}
            </Cmd.LinkItem>
          {:else}
            <Cmd.Item value={entry.id} onSelect={() => activate(entry)}>
              {@render body()}
            </Cmd.Item>
          {/if}
        {/each}
      </Cmd.Group>
    {/each}
  </Cmd.List>

  <div
    class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-fg-4"
  >
    <span class="truncate">
      Try <code class="text-fg-3">2:255</code>, <code class="text-fg-3">juz 5</code>,
      <code class="text-fg-3">page 100</code>
    </span>
    <span class="flex flex-none items-center gap-1.5">
      <Cmd.Shortcut>↵</Cmd.Shortcut>
      <Cmd.Shortcut>esc</Cmd.Shortcut>
    </span>
  </div>
</Cmd.Dialog>
