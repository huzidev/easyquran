/**
 * Keyword aliases shared by every Quran search surface (palette + the
 * /app/search page), so no consumer imports another just to recognize a
 * keyword, and a new domain declares its own list the same way.
 *
 * Arabic spellings are matched as typed; `parseQuery` lowercases but does not
 * normalize the keyword, so both `سورة` and the ta-marbuta-less `سوره` are
 * listed explicitly.
 */
export const SURAH_ALIASES = ["s", "sura", "surah", "surat", "chapter", "سورة", "سوره"] as const;

export const JUZ_ALIASES = [
  "juz",
  "juzz",
  "juzu",
  "jooz",
  "para",
  "sipara",
  "siparah",
  "جزء",
  "جز",
] as const;

export const PAGE_ALIASES = ["page", "pg", "p", "safha", "safhah", "صفحة", "صفحه"] as const;

export const SAJDA_ALIASES = ["sajda", "sajdah", "sujud", "prostration", "سجدة", "سجده"] as const;

const PLACE_ROWS: readonly (readonly [alias: string, place: "meccan" | "medinan"])[] = [
  ["meccan", "meccan"],
  ["makkan", "meccan"],
  ["mekkan", "meccan"],
  ["مكية", "meccan"],
  ["مكيه", "meccan"],
  ["medinan", "medinan"],
  ["madani", "medinan"],
  ["madanian", "medinan"],
  ["مدنية", "medinan"],
  ["مدنيه", "medinan"],
];

export const PLACE_ALIASES = PLACE_ROWS.map(([alias]) => alias);

export const TRANSLATION_ALIASES = ["translation", "translations"] as const;

/** Every keyword the Quran search surfaces claim — used to find a query's free text. */
export const QURAN_ALIASES = [
  ...SURAH_ALIASES,
  ...JUZ_ALIASES,
  ...PAGE_ALIASES,
  ...SAJDA_ALIASES,
  ...PLACE_ALIASES,
] as const;

/** Every keyword any source claims — full-text sources all sit out bare keywords. */
export const ALL_KEYWORD_ALIASES = [...QURAN_ALIASES, ...TRANSLATION_ALIASES] as const;

const PLACE_BY_ALIAS = new Map<string, "meccan" | "medinan">(PLACE_ROWS);

/** The revelation place a place-alias names, or null for other words. */
export function placeForAlias(alias: string): "meccan" | "medinan" | null {
  return PLACE_BY_ALIAS.get(alias) ?? null;
}
