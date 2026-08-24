import type { CatalogEntry } from "$lib/data/quran-types";
import {
  makeTranslitScorer,
  surahTranslitKeys,
  type TranslitKey,
} from "$lib/quran/search/translit";

import { SURAH_ALIASES } from "../aliases";
import { PaletteGroups } from "../groups";
import { arabicTermsFor, referenceNumbers, stripTrailingRef, termsFor } from "../query";
import { ayahHref, openVerse, surahDetail, surahHref } from "../quran-nav";
import { byScore, scoreArabic, scoreFields } from "../scoring";
import { surahAliasKeys } from "../surah-aliases";
import type { PaletteEntry, PaletteQuery, PaletteSource } from "../types";

const SOURCE_ID = "quran.surahs";

/** How many surahs to offer when the palette opens with an empty query. */
const IDLE_SUGGESTIONS = 5;

function keysFor(
  keyTable: readonly (readonly TranslitKey[])[],
  surahNum: number,
): readonly TranslitKey[] {
  const fieldKeys = keyTable[surahNum - 1]!;
  const aliases = surahAliasKeys(surahNum);
  return aliases.length === 0 ? fieldKeys : [...fieldKeys, ...aliases];
}

function rank(
  surahs: readonly CatalogEntry[],
  needle: string,
  arabicNeedle: string,
): { surah: CatalogEntry; score: number }[] {
  const scorer = makeTranslitScorer(needle);
  const keyTable = surahTranslitKeys(surahs);
  const scored: { surah: CatalogEntry; score: number }[] = [];
  for (const surah of surahs) {
    const translit = scorer ? scorer(keysFor(keyTable, surah.num)) : 0;
    const score = Math.max(
      scoreFields([surah.name, surah.transliteration, surah.meaning, surah.slug], needle),
      scoreArabic(surah.arabic, arabicNeedle),
      translit,
    );
    if (score > 0) scored.push({ surah, score });
  }
  return byScore(scored, (a, b) => a.surah.num - b.surah.num);
}

function surahEntry(query: PaletteQuery, surah: CatalogEntry, score: number): PaletteEntry | null {
  const href = surahHref(query.routeContext, query.quranData, surah.num);
  if (!href) return null;
  return {
    id: `${SOURCE_ID}:surah:${surah.num}`,
    sourceId: SOURCE_ID,
    groupId: PaletteGroups.Surahs.id,
    label: `${surah.num}. ${surah.name}`,
    detail: surahDetail(surah),
    arabic: surah.arabic,
    icon: "book",
    score,
    href,
    dedupeKey: `surah:${surah.num}`,
  };
}

/**
 * A named surah plus a trailing verse number — `baqarah 255`, `البقرة ٢٥٥` once
 * transliterated, `sura kahf 10`. Promoted into "Jump to" because a name and a
 * number together is an unambiguous coordinate.
 */
function namedAyahEntry(
  query: PaletteQuery,
  surah: CatalogEntry,
  ayah: number,
): PaletteEntry | null {
  if (ayah > surah.ayahCount) return null;
  const href = ayahHref(query.routeContext, query.quranData, surah.num, ayah);
  if (!href) return null;
  return {
    id: `${SOURCE_ID}:ayah:${surah.num}:${ayah}`,
    sourceId: SOURCE_ID,
    groupId: PaletteGroups.JumpTo.id,
    label: `${surah.name} ${surah.num}:${ayah}`,
    detail: "Verse",
    arabic: surah.arabic,
    icon: "book",
    score: 1,
    href,
    run: openVerse(surah.num, ayah),
    dedupeKey: `ayah:${surah.num}:${ayah}`,
  };
}

/**
 * Surah lookup by English name, transliteration, meaning, slug or Arabic name.
 * Arabic goes through the same normalization as the Quran text search, so
 * harakat, alef forms and tatweel do not matter.
 */
export const quranSurahsSource: PaletteSource = {
  id: SOURCE_ID,
  groups: [PaletteGroups.Surahs, PaletteGroups.JumpTo],
  limit: 7,

  entries(query) {
    const { parsed, quranData } = query;

    if (parsed.isEmpty) {
      return quranData.surahs
        .slice(0, IDLE_SUGGESTIONS)
        .map((surah) => surahEntry(query, surah, 0))
        .filter((entry): entry is PaletteEntry => entry !== null);
    }

    const base = termsFor(parsed, SURAH_ALIASES);
    const needle = stripTrailingRef(base);
    if (needle.length === 0) return [];

    const arabicBase = arabicTermsFor(parsed, SURAH_ALIASES);
    const arabicNeedle = stripTrailingRef(arabicBase);
    const ranked = rank(quranData.surahs, needle, arabicNeedle);
    if (ranked.length === 0) return [];

    const entries: (PaletteEntry | null)[] = [];

    // A name plus one trailing number pins an exact verse in the best match.
    const ref = base === needle ? null : referenceNumbers(parsed);
    if (ref && ref.secondary === undefined) {
      entries.push(namedAyahEntry(query, ranked[0]!.surah, ref.primary));
    }

    for (const { surah, score } of ranked) entries.push(surahEntry(query, surah, score));
    return entries.filter((entry): entry is PaletteEntry => entry !== null);
  },
};
