import { translitKey, type TranslitKey } from "$lib/quran/search/translit";

/**
 * Curated surah nicknames that `translitKey` cannot derive from the catalogue's
 * name/transliteration/slug fields — circulation names like *tabarak* (Al-Mulk)
 * or *yaroiatak* (Al-Qiyamah). An alias earns a row only when folding cannot
 * produce it; everything fold-derivable stays out.
 */
export const SURAH_KEYWORDS: readonly (readonly [alias: string, surahNum: number])[] = [
  ["tabarak", 67],
  ["tbarak", 67],
  ["yaroiatak", 75],
];

/**
 * Juz nicknames in circulation — the divisions people actually name by their
 * opening word. `tabarak` deliberately also names surah 67 in `SURAH_KEYWORDS`:
 * different tables, both surface.
 */
export const JUZ_KEYWORDS: readonly (readonly [alias: string, juzNum: number])[] = [
  ["qad sama", 28],
  ["qadsama", 28],
  ["tabarak", 29],
  ["amma", 30],
  ["ama", 30],
  ["mubarak", 29],
];

function buildKeywordMap(
  rows: readonly (readonly [alias: string, target: number])[],
  label: string,
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const [alias, target] of rows) {
    const key = translitKey(alias);
    const existing = map.get(key);
    if (existing !== undefined && existing !== target) {
      throw new Error(
        `${label} alias "${alias}" folds to "${key}", already claimed by ${existing} (wanted ${target})`,
      );
    }
    map.set(key, target);
  }
  return map;
}

/** Surah keyword lookup by folded alias key. */
export const SURAH_KEYWORD_BY_KEY: ReadonlyMap<string, number> = buildKeywordMap(
  SURAH_KEYWORDS,
  "SURAH_KEYWORDS",
);

/** Juz keyword lookup by folded alias key. */
export const JUZ_KEYWORD_BY_KEY: ReadonlyMap<string, number> = buildKeywordMap(
  JUZ_KEYWORDS,
  "JUZ_KEYWORDS",
);

const NO_KEYS: readonly TranslitKey[] = [];
const surahAliasesByNum = new Map<number, TranslitKey[]>();
for (const [alias, surahNum] of SURAH_KEYWORDS) {
  const keys = surahAliasesByNum.get(surahNum) ?? [];
  keys.push({ key: translitKey(alias), kind: "alias" });
  surahAliasesByNum.set(surahNum, keys);
}
for (const keys of surahAliasesByNum.values()) Object.freeze(keys);

/** Alias fold keys to append to a surah's field keys when scoring. */
export function surahAliasKeys(surahNum: number): readonly TranslitKey[] {
  return surahAliasesByNum.get(surahNum) ?? NO_KEYS;
}

/**
 * The first juz keyword row whose folded key equals `raw`'s — the alias as
 * typed (for display) alongside its juz, or null when nothing matches.
 */
export function juzKeywordFor(raw: string): readonly [alias: string, juzNum: number] | null {
  const key = translitKey(raw);
  if (!JUZ_KEYWORD_BY_KEY.has(key)) return null;
  return JUZ_KEYWORDS.find(([candidate]) => translitKey(candidate) === key) ?? null;
}
