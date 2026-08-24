import { translitKey } from "$lib/quran/search/translit";

/**
 * Juz nicknames in circulation — the divisions people actually name by their
 * opening word. `tabarak` deliberately also names surah 67 in the palette's
 * surah aliases: different tables, both surface.
 */
export const JUZ_KEYWORDS: readonly (readonly [alias: string, juzNum: number])[] = [
  ["qad sama", 28],
  ["qadsama", 28],
  ["tabarak", 29],
  ["amma", 30],
  ["ama", 30],
  ["mubarak", 29],
];

function buildJuzKeywordMap(): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const [alias, juzNum] of JUZ_KEYWORDS) {
    const key = translitKey(alias);
    const existing = map.get(key);
    if (existing !== undefined && existing !== juzNum) {
      throw new Error(
        `JUZ_KEYWORDS alias "${alias}" folds to "${key}", already claimed by ${existing} (wanted ${juzNum})`,
      );
    }
    map.set(key, juzNum);
  }
  return map;
}

/** Juz keyword lookup by folded alias key. */
export const JUZ_KEYWORD_BY_KEY: ReadonlyMap<string, number> = buildJuzKeywordMap();

/**
 * The first juz keyword row whose folded key equals `raw`'s — the alias as
 * typed (for display) alongside its juz, or null when nothing matches.
 */
export function juzKeywordFor(raw: string): readonly [alias: string, juzNum: number] | null {
  const key = translitKey(raw);
  if (!JUZ_KEYWORD_BY_KEY.has(key)) return null;
  return JUZ_KEYWORDS.find(([candidate]) => translitKey(candidate) === key) ?? null;
}
