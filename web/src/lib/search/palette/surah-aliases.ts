import { translitKey, type TranslitKey } from "$lib/quran/search/translit";

export { JUZ_KEYWORDS, JUZ_KEYWORD_BY_KEY, juzKeywordFor } from "$lib/search/nav/juz-nicknames";

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

function buildSurahKeywordMap(): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const [alias, surahNum] of SURAH_KEYWORDS) {
    const key = translitKey(alias);
    const existing = map.get(key);
    if (existing !== undefined && existing !== surahNum) {
      throw new Error(
        `SURAH_KEYWORDS alias "${alias}" folds to "${key}", already claimed by ${existing} (wanted ${surahNum})`,
      );
    }
    map.set(key, surahNum);
  }
  return map;
}

/** Surah keyword lookup by folded alias key. */
export const SURAH_KEYWORD_BY_KEY: ReadonlyMap<string, number> = buildSurahKeywordMap();

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
