import type { CatalogEntry } from "$lib/data/quran-types";
import { normalizeArabic } from "$lib/quran/search/normalize";
import {
  makeTranslitScorer,
  surahTranslitKeys,
  translitKey,
  type TranslitKey,
} from "$lib/quran/search/translit";

import type { SurahSuggestion } from "./types";

export const MAX_SUGGESTIONS = 5;

/** Circulation nicknames translit folding cannot derive from catalogue fields. */
const SURAH_KEYWORDS: readonly (readonly [alias: string, surahNum: number])[] = [
  ["tabarak", 67],
  ["tbarak", 67],
  ["yaroiatak", 75],
];

const aliasKeysByNum = new Map<number, TranslitKey[]>();
for (const [alias, surahNum] of SURAH_KEYWORDS) {
  const keys = aliasKeysByNum.get(surahNum) ?? [];
  keys.push({ key: translitKey(alias), kind: "alias" });
  aliasKeysByNum.set(surahNum, keys);
}

function scoreText(haystack: string, needle: string): number {
  const hay = haystack.trim().toLowerCase();
  const q = needle.trim().toLowerCase();
  if (hay.length === 0 || q.length === 0) return 0;
  if (hay === q) return 1;
  if (hay.startsWith(q)) return 0.9;
  const at = hay.indexOf(q);
  if (at > 0) return /[\s\-'’.]/u.test(hay[at - 1]!) ? 0.8 : 0.6;
  return hay.includes(q) ? 0.6 : 0;
}

function scoreArabic(haystack: string, normalizedNeedle: string): number {
  if (normalizedNeedle.length === 0) return 0;
  const hay = normalizeArabic(haystack);
  if (hay.length === 0) return 0;
  if (hay === normalizedNeedle) return 1;
  if (hay.startsWith(normalizedNeedle)) return 0.9;
  return hay.includes(normalizedNeedle) ? 0.6 : 0;
}

/**
 * Ranks surahs for the committed query by translit fold, raw Latin fields and
 * normalized Arabic name; only score > 0 matches are returned, best first, capped.
 */
export function suggestSurahs(
  surahs: readonly CatalogEntry[],
  rawQuery: string,
  limit = MAX_SUGGESTIONS,
): SurahSuggestion[] {
  const query = rawQuery.trim();
  if (query.length === 0) return [];
  const scorer = makeTranslitScorer(query);
  const arabicNeedle = normalizeArabic(query);
  const keyTable = surahTranslitKeys(surahs);
  const scored: SurahSuggestion[] = [];
  for (const surah of surahs) {
    const fieldKeys = keyTable[surah.num - 1] ?? [];
    const aliases = aliasKeysByNum.get(surah.num) ?? [];
    const keys = aliases.length === 0 ? fieldKeys : [...fieldKeys, ...aliases];
    const translit = scorer ? scorer(keys) : 0;
    const score = Math.max(
      scoreText(surah.name, query),
      scoreText(surah.transliteration, query),
      scoreText(surah.meaning, query),
      scoreText(surah.slug, query),
      scoreArabic(surah.arabic, arabicNeedle),
      translit,
    );
    if (score > 0) {
      scored.push({
        num: surah.num,
        name: surah.name,
        transliteration: surah.transliteration,
        arabic: surah.arabic,
        meaning: surah.meaning,
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.num - b.num);
  return scored.slice(0, limit);
}
