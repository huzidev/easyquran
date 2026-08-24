import { surahRouteContext, translationIdFromSegments } from "$lib/data/quran";
import type { TranslationCatalogueEntry } from "$lib/data/quran-types";
import { peekTranslationName, TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";
import { MIN_QUERY_LEN } from "$lib/quran/search/normalize";
import { containsArabicScript } from "$lib/quran/search/normalize-latin";
import type { AyahCoordinateValidator } from "$lib/quran/wire";
import { quranWorker } from "$lib/quran/worker-client";
import { reader } from "$lib/stores/reader.svelte";
import { stackedTranslations } from "$lib/stores/stacked-translations.svelte";

import { ALL_KEYWORD_ALIASES } from "../aliases";
import { PaletteGroups } from "../groups";
import { residualText } from "../query";
import { ayahHref, openVerse } from "../quran-nav";
import type { PaletteEntry, PaletteQuery, PaletteSource } from "../types";

const SOURCE_ID = "translation.text";
const LIMIT = 8;

/**
 * Which translation this query searches: the translated route the reader is on,
 * else the last-read source when it is a translation, else the first stacked
 * translation. UiLocale never participates — language of the interface says
 * nothing about which translation the reader reads.
 */
function scopeFor(query: PaletteQuery): TranslationCatalogueEntry | null {
  const ctx = query.routeContext;
  if (ctx.kind === "translation") {
    return (
      TRANSLATION_CATALOGUE_BY_ID.get(translationIdFromSegments(ctx.lang, ctx.translator)) ?? null
    );
  }
  const lastReadSource = reader.lastRead?.sourceId;
  if (lastReadSource) {
    const entry = TRANSLATION_CATALOGUE_BY_ID.get(lastReadSource);
    if (entry) return entry;
  }
  const pinned = stackedTranslations.ids[0];
  return pinned ? (TRANSLATION_CATALOGUE_BY_ID.get(pinned) ?? null) : null;
}

/** Latin free text this source may search — keyword stripped, coordinates dropped. */
function searchableText(query: PaletteQuery): string {
  return residualText(query.parsed, ALL_KEYWORD_ALIASES);
}

/**
 * Full-text search over the reader's cached offline translation. Async because
 * the corpus lives in the OPFS worker; v1 is LTR translations only — Arabic
 * queries belong to `quran.text`, and RTL-script tafsir needs its own normalizer.
 */
export const translationTextSource: PaletteSource = {
  id: SOURCE_ID,
  groups: [PaletteGroups.TranslationText],
  limit: LIMIT,

  enabled: (query) => {
    const text = searchableText(query);
    if (text.length < MIN_QUERY_LEN) return false;
    if (containsArabicScript(text)) return false;
    return scopeFor(query)?.direction === "ltr";
  },

  async search(query, signal) {
    const scope = scopeFor(query);
    if (!scope || scope.direction !== "ltr") return [];
    const text = searchableText(query);
    if (text.length < MIN_QUERY_LEN || containsArabicScript(text)) return [];

    const cached = await quranWorker.hasTranslation(scope.id);
    if (signal.aborted) return [];
    if (!cached) {
      void quranWorker.ensureTranslation(scope.id).catch(() => {});
      return [];
    }

    const validateCoordinate: AyahCoordinateValidator = (globalIndex, surah, ayah) =>
      query.quranData.globalIndexOf(surah, ayah) === globalIndex;
    const response = await quranWorker.searchTranslation(
      scope.id,
      text,
      { limit: query.limit },
      validateCoordinate,
    );
    if (signal.aborted) return [];

    const detail = peekTranslationName(scope.id) ?? undefined;
    const entries: PaletteEntry[] = [];
    for (const hit of response.results) {
      const num = hit.ayah.surah;
      const ayah = hit.ayah.ayah;
      const surah = query.quranData.surahByNum(num);
      if (!surah) continue;
      const href = ayahHref(surahRouteContext(scope.id), query.quranData, num, ayah);
      if (!href) continue;
      entries.push({
        id: `${SOURCE_ID}:tayah:${scope.id}:${num}:${ayah}`,
        sourceId: SOURCE_ID,
        groupId: PaletteGroups.TranslationText.id,
        label: `${surah.name} ${num}:${ayah}`,
        detail,
        preview: hit.ayah.text
          ? { text: hit.ayah.text, highlights: hit.highlights, dir: scope.direction }
          : undefined,
        icon: "search",
        score: 0.7,
        href,
        run: openVerse(num, ayah, scope.id),
        dedupeKey: `tayah:${scope.id}:${num}:${ayah}`,
      });
    }
    return entries;
  },
};
