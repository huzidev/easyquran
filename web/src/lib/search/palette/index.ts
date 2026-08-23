import { registerPaletteSource } from "./registry";
import { appActionsSource } from "./sources/app-actions";
import { quranRangesSource } from "./sources/quran-ranges";
import { quranReferenceSource } from "./sources/quran-reference";
import { quranSurahsSource } from "./sources/quran-surahs";
import { quranTextSource } from "./sources/quran-text";
import { settingsRoutesSource } from "./sources/settings-routes";
import { siteRoutesSource } from "./sources/site-routes";

/**
 * Built-in sources, in the order they contribute entries — earlier sources win
 * ties during dedupe, so exact references outrank fuzzy and full-text hits.
 *
 * Adding a domain (hadith, tafsir, duas, lessons) means writing a
 * `PaletteSource` and adding it here — or calling `registerPaletteSource` from
 * anywhere that loads before the palette opens. Nothing else needs to change.
 */
export const BUILTIN_PALETTE_SOURCES = [
  quranReferenceSource,
  quranSurahsSource,
  quranTextSource,
  quranRangesSource,
  settingsRoutesSource,
  siteRoutesSource,
  appActionsSource,
] as const;

let registered = false;

/** Idempotent — safe to call from every surface that opens the palette. */
export function registerBuiltinPaletteSources(): void {
  if (registered) return;
  registered = true;
  for (const source of BUILTIN_PALETTE_SOURCES) registerPaletteSource(source);
}

export { PaletteGroups } from "./groups";
export { createPaletteEngine, SEARCH_DEBOUNCE_MS, type PaletteEngine } from "./engine.svelte";
export {
  DEFAULT_SOURCE_LIMIT,
  collectAsyncEntries,
  collectSyncEntries,
  dedupeEntries,
  paletteGroups,
  paletteSources,
  registerPaletteSource,
  sectionsFor,
  unregisterPaletteSource,
  type PaletteSection,
} from "./registry";
export { parseQuery, residualText } from "./query";
export { resolveHref } from "./href";
export type { PaletteEntry, PaletteGroup, PaletteQuery, PaletteSource, ParsedQuery } from "./types";
