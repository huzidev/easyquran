<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { ACCENTS, SURFACES, type ThemeMode } from "$lib/config/site";
  import type { CustomSeeds } from "$lib/theme/derive";
  import { cn } from "$lib/utils";
  import type { SettingsCopy } from "$lib/i18n/settings-copy";

  let {
    id,
    heading,
    copy,
  }: { id: string; heading: string; copy: SettingsCopy["appearance"] } = $props();

  const panel = $derived(copy.panel);
  const themes: ThemeMode[] = ["dark", "light"];
  const seeds: { key: keyof CustomSeeds; fallbackVar: string }[] = [
    { key: "bg", fallbackVar: "--bg" },
    { key: "accent", fallbackVar: "--accent" },
    { key: "pop", fallbackVar: "--pop" },
  ];

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const pill = "rounded-lg border px-3.5 py-2 text-[13.5px] transition-colors duration-150";
  const pillOn = "border-accent bg-accent-soft text-fg";
  const pillOff = "border-line-2 text-fg-2 hover:border-line hover:text-fg";
  const quiet =
    "rounded-lg border border-line-2 px-3.5 py-2.5 text-[13.5px] text-fg-2 transition-colors duration-150 hover:border-line hover:text-fg";

  function pillClass(active: boolean): string {
    return cn(pill, active ? pillOn : pillOff);
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

  onMount(() => () => {
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

<div id={id} tabindex="-1" class="scroll-mt-24">
  <h2 class="text-[17px] font-semibold tracking-[-0.02em] text-fg">{heading}</h2>
  <p class="mt-1 max-w-[70ch] text-[14.5px] leading-relaxed text-fg-2">{copy.intro}</p>

  <div class="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-bg-1">
    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{panel.theme}</span>
      <div class="flex shrink-0 gap-1.5">
        {#each themes as t (t)}
          <button
            type="button"
            class={pillClass(prefs.theme === t)}
            aria-pressed={prefs.theme === t}
            onclick={() => prefs.setTheme(t)}>{panel.themeNames[t]}</button
          >
        {/each}
      </div>
    </div>

    <div class="px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{panel.surface}</span>
      <div class="mt-2.5 grid gap-2 sm:grid-cols-2">
        {#each SURFACES as s (s.id)}
          <button
            type="button"
            title={panel.surfaces[s.id].note}
            aria-pressed={prefs.surface === s.id}
            onclick={() => prefs.setSurface(s.id)}
            class={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors",
              prefs.surface === s.id
                ? "border-accent bg-accent-soft"
                : "border-line-2 bg-bg-1 hover:border-line hover:text-fg",
            )}
          >
            <span
              class="size-6 flex-none rounded-md border border-line-2"
              style={`background:${prefs.theme === "light" ? s.lightHex : s.darkHex}`}
            ></span>
            <span class="min-w-0">
              <span class="block text-[13.5px] text-fg">{panel.surfaces[s.id].label}</span>
              <span class="block truncate text-[13.5px] text-fg-3"
                >{panel.surfaces[s.id].note}</span
              >
            </span>
          </button>
        {/each}
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{panel.accent}</span>
      <div class="flex shrink-0 flex-wrap gap-2">
        {#each ACCENTS as a (a.id)}
          <button
            type="button"
            title={panel.accents[a.id]}
            aria-label={panel.accentOptionLabel(panel.accents[a.id])}
            aria-pressed={prefs.accent === a.id && !prefs.custom.accent}
            class={cn(
              "size-[30px] rounded-lg border-2 transition-transform",
              prefs.accent === a.id && !prefs.custom.accent ? "scale-110 border-fg" : "border-line",
            )}
            style={`background:${a.hex}`}
            onclick={() => prefs.setAccent(a.id)}
          ></button>
        {/each}
      </div>
    </div>

    <div class="px-4 py-3.5 sm:px-5">
      <div class="flex items-center justify-between gap-4">
        <span class="text-[14.5px] font-medium text-fg">{panel.customColours}</span>
        {#if prefs.hasCustom}
          <button
            type="button"
            class="text-[13.5px] text-fg-3 underline underline-offset-2 transition-colors hover:text-fg"
            onclick={() => prefs.clearCustom()}>{panel.clear}</button
          >
        {/if}
      </div>
      <div class="mt-2.5 flex flex-col gap-2">
        {#each seeds as s (s.key)}
          <div class="flex items-center gap-3">
            <input
              type="color"
              aria-label={panel.colourInputLabel(panel.seedNames[s.key])}
              value={seedValue(s.key, s.fallbackVar)}
              oninput={(e) => prefs.setCustom(s.key, e.currentTarget.value)}
              class="size-8 flex-none cursor-pointer rounded-md border border-line-2 bg-transparent p-0.5"
            />
            <span class="flex-1 text-[13.5px] text-fg-2">{panel.seedNames[s.key]}</span>
            <span class="font-mono text-[13.5px] tabular-nums text-fg-3">
              {prefs.custom[s.key] ?? panel.preset}
            </span>
            {#if prefs.custom[s.key]}
              <button
                type="button"
                aria-label={panel.resetToPresetLabel(panel.seedNames[s.key])}
                class="text-fg-3 transition-colors hover:text-fg"
                onclick={() => prefs.setCustom(s.key, undefined)}>✕</button
              >
            {/if}
          </div>
        {/each}
      </div>
      <p class="mt-2.5 text-[13.5px] leading-snug text-fg-3">
        {panel.derivedColours}
      </p>
    </div>
  </div>

  <div class="mt-4 flex flex-wrap gap-2">
    <button type="button" class={cn(quiet, "flex-1")} onclick={copyCss}>
      {copied ? panel.copied : panel.copyCss}
    </button>
    <button type="button" class={cn(quiet, "flex-1")} onclick={() => prefs.reset()}>
      {panel.reset}
    </button>
    <span class="sr-only" aria-live="polite">{copied ? panel.copied : ""}</span>
  </div>
</div>
