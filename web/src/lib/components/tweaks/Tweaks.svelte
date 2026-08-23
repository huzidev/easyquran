<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { consent } from "$lib/stores/consent.svelte";
  import { ACCENTS, SURFACES, type ThemeMode } from "$lib/config/site";
  import type { CustomSeeds } from "$lib/theme/derive";
  import { Notifications } from "$lib/components/notifications";
  import { OfflinePack, OfflinePackBar } from "$lib/components/status";
  import { offline } from "$lib/offline/offline-store.svelte";
  import { cn } from "$lib/utils";
  import { uiDirection, type UiLocale } from "$lib/i18n/locales";
  import type { TweaksResolvedCopy } from "$lib/i18n/marketing-copy";

  let {
    locale,
    triggerLabel,
    loadCopy,
    showReaderTools = true,
  }: {
    /**
     * UI locale of the surrounding chrome. This portal owns its direction so its placement and
     * alignment stay correct even if a parent reader passage has a different content direction.
     */
    locale: UiLocale;
    /** Rendered on the closed trigger, so it is the only appearance string a page eagerly needs. */
    triggerLabel: string;
    /**
     * Resolves the panel copy on first open. Deliberately a loader, not a value: the appearance
     * panel owns ~40 messages that nothing renders until the user asks for it, and eagerly
     * resolving them put every one of those strings in every page's bundle.
     * See docs/quran-system.md (Part 2, Message chunking).
     */
    loadCopy: () => Promise<TweaksResolvedCopy>;
    showReaderTools?: boolean;
  } = $props();

  const direction = $derived(uiDirection(locale));

  let copy = $state<TweaksResolvedCopy>();
  let copyRequest: Promise<void> | undefined;

  function ensureCopy(): void {
    copyRequest ??= loadCopy().then((resolved) => {
      copy = resolved;
    });
  }

  async function toggle(): Promise<void> {
    if (open) {
      open = false;
      return;
    }
    ensureCopy();
    await copyRequest;
    open = true;
  }

  let open = $state(false);
  let triggerButton = $state<HTMLButtonElement>();
  let firstControl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLDivElement>();
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const themes: ThemeMode[] = ["dark", "light"];

  const seeds: { key: keyof CustomSeeds; fallbackVar: string }[] = [
    { key: "bg", fallbackVar: "--bg" },
    { key: "accent", fallbackVar: "--accent" },
    { key: "pop", fallbackVar: "--pop" },
  ];

  const pill = "rounded-md border px-3 py-1 text-xs transition-colors duration-150";
  const on = "border-accent bg-accent-soft text-fg";
  const off = "border-line-2 text-fg-2 hover:text-fg";

  function pillClass(active: boolean): string {
    return cn(pill, active ? on : off);
  }

  function resolveHex(varName: string): string {
    if (!browser) return "#000000";
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (!raw) return "#000000";

    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;color:${raw}`;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();

    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
    if (!m) return "#000000";
    return `#${m
      .slice(1, 4)
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  function seedValue(key: keyof CustomSeeds, fallbackVar: string): string {
    return prefs.custom[key] ?? resolveHex(fallbackVar);
  }

  async function copyCss() {
    try {
      await navigator.clipboard.writeText(prefs.css());
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1600);
    } catch {
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      open = false;
      triggerButton?.focus();
    }
  }

  function onPointerDown(event: PointerEvent) {
    if (!open) return;
    // SAFETY: pointer events always dispatch with an EventTarget that is a DOM Node
    // (element or text node); the null branch below still guards the typed null.
    const target = event.target as Node | null;
    if (!target) return;
    if (panelEl?.contains(target)) return;
    if (triggerButton?.contains(target)) return;
    open = false;
  }

  $effect(() => {
    if (open && firstControl) {
      firstControl.focus();
    }
  });

  $effect(() => {
    if (
      showReaderTools &&
      (offline.status === "downloading" || offline.status === "staging")
    ) {
      ensureCopy();
    }
  });

  onMount(() => () => {
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

<div
  lang={locale}
  dir={direction}
  class="fixed end-5 bottom-5 z-[1000] flex flex-col items-end gap-3"
>
  {#if open && copy}
    <div
      id="tweaks-panel"
      bind:this={panelEl}
      role="dialog"
      aria-modal="false"
      aria-label={copy.settings}
      class="flex max-h-[min(80vh,640px)] w-[288px] flex-col overflow-hidden rounded-xl border border-line-2 bg-bg-1/95 shadow-[0_18px_40px_rgba(0,0,0,0.4)] backdrop-blur"
    >
      <div class="overflow-y-auto overflow-x-hidden p-3.5">
      <div class="mb-3 flex items-center justify-between gap-2">
        <span class="font-mono text-xs uppercase tracking-wide text-fg-3">{copy.theme}</span>
        <button
          type="button"
          class="text-fg-3 transition-colors hover:text-fg"
          onclick={() => (open = false)}
          bind:this={firstControl}
          aria-label={copy.closePanel}>✕</button
        >
      </div>

      <div class="grid grid-cols-1 gap-3.5">
        <div>
          <div class="mb-1.5 text-xs text-fg-3">{copy.mode}</div>
          <div class="flex gap-1.5">
            {#each themes as t (t)}
              <button
                type="button"
                class={pillClass(prefs.theme === t)}
                aria-pressed={prefs.theme === t}
                onclick={() => prefs.setTheme(t)}>{copy.themeNames[t]}</button
              >
            {/each}
          </div>
        </div>

        <div>
          <div class="mb-1.5 text-xs text-fg-3">{copy.surface}</div>
          <div class="flex flex-col gap-1">
            {#each SURFACES as s (s.id)}
              <button
                type="button"
                title={copy.surfaces[s.id].note}
                aria-pressed={prefs.surface === s.id}
                onclick={() => prefs.setSurface(s.id)}
                class={cn(
                  "flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-start transition-colors",
                  prefs.surface === s.id ? "border-accent bg-accent-soft" : "border-line hover:border-line-2",
                )}
              >
                <span
                  class="size-5 flex-none rounded-md border border-line-2"
                  style={`background:${prefs.theme === "light" ? s.lightHex : s.darkHex}`}
                ></span>
                <span class="min-w-0">
                  <span class="block text-xs text-fg">{copy.surfaces[s.id].label}</span>
                  <span class="block truncate text-[11px] text-fg-4"
                    >{copy.surfaces[s.id].note}</span
                  >
                </span>
              </button>
            {/each}
          </div>
        </div>

        <div>
          <div class="mb-1.5 text-xs text-fg-3">{copy.accent}</div>
          <div class="flex flex-wrap gap-2">
            {#each ACCENTS as a (a.id)}
              <button
                title={copy.accents[a.id]}
                aria-label={copy.accentOptionLabel(copy.accents[a.id])}
                class={cn(
                  "size-[30px] rounded-lg border-2 transition-transform",
                  prefs.accent === a.id && !prefs.custom.accent ? "scale-110 border-fg" : "border-line",
                )}
                style={`background:${a.hex}`}
                onclick={() => prefs.setAccent(a.id)}
                aria-pressed={prefs.accent === a.id && !prefs.custom.accent}
              ></button>
            {/each}
          </div>
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <span class="text-xs text-fg-3">{copy.customColours}</span>
            {#if prefs.hasCustom}
              <button
                type="button"
                class="text-[11px] text-fg-3 underline underline-offset-2 transition-colors hover:text-fg"
                onclick={() => prefs.clearCustom()}>{copy.clear}</button
              >
            {/if}
          </div>
          <div class="flex flex-col gap-1.5">
            {#each seeds as s (s.key)}
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={copy.colourInputLabel(copy.seedNames[s.key])}
                  value={seedValue(s.key, s.fallbackVar)}
                  oninput={(e) => prefs.setCustom(s.key, e.currentTarget.value)}
                  class="size-7 flex-none cursor-pointer rounded-md border border-line-2 bg-transparent p-0.5"
                />
                <span class="flex-1 text-xs text-fg-2">{copy.seedNames[s.key]}</span>
                <span class="font-mono text-[11px] text-fg-4">
                  {prefs.custom[s.key] ?? copy.preset}
                </span>
                {#if prefs.custom[s.key]}
                  <button
                    type="button"
                    aria-label={copy.resetToPresetLabel(copy.seedNames[s.key])}
                    class="text-fg-4 transition-colors hover:text-fg"
                    onclick={() => prefs.setCustom(s.key, undefined)}>✕</button
                  >
                {/if}
              </div>
            {/each}
          </div>
          <p class="mt-1.5 text-[11px] leading-snug text-fg-4">
            {copy.derivedColours}
          </p>
        </div>

        <div class="flex gap-1.5">
          <button type="button" class={cn(pill, off, "flex-1")} onclick={copyCss}>
            {copied ? copy.copied : copy.copyCss}
          </button>
          <button type="button" class={cn(pill, off, "flex-1")} onclick={() => prefs.reset()}>
            {copy.reset}
          </button>
        </div>

        {#if showReaderTools}
          <hr class="border-line" />
          {#if copy.notifications}
            <Notifications copy={copy.notifications} />
          {/if}
          <hr class="border-line" />
          {#if copy.offlinePack}
            <OfflinePack copy={copy.offlinePack} />
          {/if}
        {/if}

        <div>
          <div class="mb-1.5 text-xs text-fg-3">{copy.dataPrivacy}</div>
          <div class="flex flex-col gap-1.5">
            <button
              type="button"
              aria-pressed={consent.analytics}
              onclick={() => consent.setAnalytics(!consent.analytics)}
              class={pillClass(consent.analytics)}
            >
              {copy.toggleStatusLabel(
                copy.analytics,
                consent.analytics ? copy.on : copy.off,
              )}
            </button>
            <button
              type="button"
              aria-pressed={consent.performance}
              title={copy.performanceReload}
              onclick={() => {
                consent.setPerformance(!consent.performance);
                location.reload();
              }}
              class={pillClass(consent.performance)}
            >
              {copy.toggleStatusLabel(
                copy.performance,
                consent.performance ? copy.on : copy.off,
              )}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  {/if}

  {#if showReaderTools && copy?.offlinePack}
    <OfflinePackBar copy={copy.offlinePack} />
  {/if}

  <button
    type="button"
    bind:this={triggerButton}
    onclick={toggle}
    aria-label={triggerLabel}
    aria-expanded={open}
    aria-controls="tweaks-panel"
    class="flex size-10 items-center justify-center rounded-full border border-line-2 bg-bg-1/95 text-fg-2 shadow-lg backdrop-blur transition-colors hover:text-fg"
  >
    {#if open}<span class="text-sm">✕</span>{:else}<span class="text-lg leading-none">◐</span>{/if}
  </button>
</div>
