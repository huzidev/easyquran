import {
  surahAyahPathFor,
  surahPathFor,
  surahRouteContext,
  type SurahRouteContext,
} from "$lib/data/quran";
import type { QuranData } from "$lib/data/quran-data";
import { reader } from "$lib/stores/reader.svelte";

function contextFor(sectionId: string): SurahRouteContext {
  if (sectionId === "arabic") return { kind: "arabic" };
  return surahRouteContext(sectionId);
}

/**
 * The search page's only Quran-coordinate-to-URL path: results open in the
 * source they were found in, via the ctx-preserving helpers.
 */
export function ayahHrefFor(
  sectionId: string,
  quranData: QuranData,
  surah: number,
  ayah: number,
): string | null {
  const entry = quranData.surahByNum(surah);
  if (!entry) return null;
  const localPage = quranData.surahLocalPageForAyah(surah, ayah);
  return localPage ? surahAyahPathFor(contextFor(sectionId), entry, localPage.localPage, ayah) : null;
}

/** Surah jump href for the suggestions list; null when the coordinate is unknown. */
export function surahHrefFor(
  sectionId: string,
  quranData: QuranData,
  surah: number,
): string | null {
  const entry = quranData.surahByNum(surah);
  return entry ? surahPathFor(contextFor(sectionId), entry) : null;
}

/**
 * Side effect pairing an ayah href: records the opened verse for continue-reading
 * and row reveal. Pass a sourceId only for translated sections.
 */
export const openVerse =
  (surah: number, ayah: number, sourceId?: string): (() => void) =>
  () =>
    reader.openVerse(surah, ayah, sourceId);
