/**
 * Keyword aliases shared by the Quran sources. Kept here rather than on one
 * source so no source has to import another just to recognize a keyword, and so
 * a new domain can declare its own list the same way.
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

export const TRANSLATION_ALIASES = ["translation", "translations"] as const;

/** Every keyword the Quran sources claim — used to find a query's free text. */
export const QURAN_ALIASES = [...SURAH_ALIASES, ...JUZ_ALIASES, ...PAGE_ALIASES] as const;

/** Every keyword any source claims — full-text sources all sit out bare keywords. */
export const ALL_KEYWORD_ALIASES = [...QURAN_ALIASES, ...TRANSLATION_ALIASES] as const;
