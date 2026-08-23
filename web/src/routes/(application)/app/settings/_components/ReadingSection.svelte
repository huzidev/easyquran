<script lang="ts">
  import {
    ARABIC_FONTS,
    TRANSLATION_FAMILIES,
    arabicFontStack,
    type ArabicFontId,
    type TranslationFamily,
  } from "$lib/config/reader-fonts";
  import { loadArabicFont } from "$lib/fonts/arabic-fonts";
  import {
    ARABIC_FONT_MAX,
    ARABIC_FONT_MIN,
    TRANSLATION_FONT_MAX,
    TRANSLATION_FONT_MIN,
  } from "$lib/stores/reader-core.svelte";
  import { reader, type ReaderMode } from "$lib/stores/reader.svelte";
  import { cn } from "$lib/utils";
  import type { SettingsCopy } from "$lib/i18n/settings-copy";

  let {
    id,
    heading,
    copy,
  }: {
    id: string;
    heading: string;
    copy: SettingsCopy["reading"];
  } = $props();

  const SAMPLE_ARABIC = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";

  const pill = "rounded-lg border px-3.5 py-2 text-[13.5px] transition-colors duration-150";
  const pillOn = "border-accent bg-accent-soft text-fg";
  const pillOff = "border-line-2 text-fg-2 hover:border-line hover:text-fg";

  function pillClass(active: boolean): string {
    return cn(pill, active ? pillOn : pillOff);
  }

  function fontLabel(fontId: ArabicFontId): string {
    if (fontId === "amiri") return copy.fontNames.amiri;
    if (fontId === "scheherazade-new") return copy.fontNames.scheherazade;
    return copy.fontNames.notoNaskh;
  }

  const modes: ReaderMode[] = ["verse", "reading"];

  function modeLabel(mode: ReaderMode): string {
    return mode === "verse" ? copy.modeNames.verse : copy.modeNames.reading;
  }

  function chooseArabicFont(fontId: ArabicFontId): void {
    reader.setArabicFont(fontId);
    void loadArabicFont(fontId);
  }

  const families: TranslationFamily[] = TRANSLATION_FAMILIES.map((f) => f.id);

  function familyLabel(family: TranslationFamily): string {
    return family === "sans" ? copy.fontFamilies.sans : copy.fontFamilies.serif;
  }

  const stepperButton =
    "flex h-9 w-10 items-center justify-center rounded-lg border border-line-2 text-[13.5px] text-fg-2 transition-colors hover:border-line hover:text-fg disabled:pointer-events-none disabled:opacity-40";
</script>

<div id={id} tabindex="-1" class="scroll-mt-24">
  <h2 class="text-[17px] font-semibold tracking-[-0.02em] text-fg">{heading}</h2>
  <p class="mt-1 max-w-[70ch] text-[14.5px] leading-relaxed text-fg-2">{copy.intro}</p>

  <div class="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-bg-1">
    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{copy.mode}</span>
      <div class="flex shrink-0 gap-1.5">
        {#each modes as mode (mode)}
          <button
            type="button"
            class={pillClass(reader.mode === mode)}
            aria-pressed={reader.mode === mode}
            onclick={() => reader.setMode(mode)}>{modeLabel(mode)}</button
          >
        {/each}
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{copy.arabicFont}</span>
      <div class="flex shrink-0 flex-wrap gap-1.5">
        {#each ARABIC_FONTS as font (font.id)}
          <button
            type="button"
            class={pillClass(reader.arabicFont === font.id)}
            aria-pressed={reader.arabicFont === font.id}
            style:font-family={arabicFontStack(font.id)}
            onclick={() => chooseArabicFont(font.id)}>{fontLabel(font.id)}</button
          >
        {/each}
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{copy.arabicSize}</span>
      <div
        class="flex shrink-0 items-center gap-2.5"
        role="group"
        aria-label={copy.arabicSize}
      >
        <button
          type="button"
          class={stepperButton}
          aria-label="{copy.arabicSize} −"
          disabled={reader.arabicSizePx === `${ARABIC_FONT_MIN}px`}
          onclick={() => reader.smaller()}>−</button
        >
        <span class="min-w-12 text-center text-[13.5px] tabular-nums text-fg-2" aria-live="polite"
          >{reader.arabicSizePx}</span
        >
        <button
          type="button"
          class={stepperButton}
          aria-label="{copy.arabicSize} +"
          disabled={reader.arabicSizePx === `${ARABIC_FONT_MAX}px`}
          onclick={() => reader.bigger()}>+</button
        >
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{copy.translationFont}</span>
      <div class="flex shrink-0 gap-1.5">
        {#each families as family (family)}
          <button
            type="button"
            class={pillClass(reader.translationFamily === family)}
            aria-pressed={reader.translationFamily === family}
            onclick={() => reader.setTranslationFamily(family)}>{familyLabel(family)}</button
          >
        {/each}
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{copy.translationSize}</span>
      <div
        class="flex shrink-0 items-center gap-2.5"
        role="group"
        aria-label={copy.translationSize}
      >
        <button
          type="button"
          class={stepperButton}
          aria-label="{copy.translationSize} −"
          disabled={reader.translationSizePx === `${TRANSLATION_FONT_MIN}px`}
          onclick={() => reader.shrinkTranslation()}>−</button
        >
        <span class="min-w-12 text-center text-[13.5px] tabular-nums text-fg-2" aria-live="polite"
          >{reader.translationSizePx}</span
        >
        <button
          type="button"
          class={stepperButton}
          aria-label="{copy.translationSize} +"
          disabled={reader.translationSizePx === `${TRANSLATION_FONT_MAX}px`}
          onclick={() => reader.growTranslation()}>+</button
        >
      </div>
    </div>

    <div class="px-4 py-3.5 sm:px-5">
      <span class="text-[14.5px] font-medium text-fg">{copy.preview}</span>
      <div class="mt-2.5 overflow-x-auto rounded-xl border border-line bg-bg-2 px-4 py-3.5">
        <p class="preview-arabic" dir="rtl" lang="ar">{SAMPLE_ARABIC}</p>
        <p class="preview-translation" dir="auto">{copy.sample}</p>
      </div>
    </div>
  </div>
</div>

<style>
  .preview-arabic {
    font-family: var(--reader-arabic-family, var(--font-arabic));
    font-size: var(--reader-arabic-size, 33px);
    line-height: 2.15;
    margin: 0;
    text-align: right;
    white-space: nowrap;
  }

  .preview-translation {
    font-family: var(--reader-translation-family, var(--font-sans));
    font-size: var(--reader-translation-size, 17px);
    line-height: 1.85;
    margin: 0.5rem 0 0;
  }
</style>
