import { surahLocalPagePathFor, surahPathFor } from "$lib/data/quran";
import { RangeKind, SURAH_COUNT } from "$lib/data/quran-data";
import type {
  Ayah,
  CatalogEntry,
  RangeEntry,
  RangePageData,
  SurahLink,
  SurahLocalPageLink,
  SurahNormalization,
  SurahRouteContext,
} from "$lib/data/quran-types";
import { QURAN_DATA, toSurahLink } from "$lib/server/quran-data";
// Shared shape builders for the four SSR loaders (Arabic/translation × surah-page/range). They
// differ only in where the ayah text comes from; the navigation and range envelope around it are
// identical, so they live here once. Route hrefs go through the ctx-aware `*For` helpers, which
// keeps translation context on every generated link.
import { error } from "@sveltejs/kit";

export interface SurahRouteNav {
  previousPage: SurahLocalPageLink | null;
  nextPage: SurahLocalPageLink | null;
  previousSurah: SurahLink | null;
  nextSurah: SurahLink | null;
  readingPreviousHref: `/app/${string}` | null;
  readingNextHref: `/app/${string}` | null;
}

/** Neighbouring Surah, or null past either end of the mushaf. */
function surahLinkAt(num: number): SurahLink | null {
  if (num < 1 || num > SURAH_COUNT) return null;
  const entry = QURAN_DATA.surahByNum(num);
  return entry ? toSurahLink(entry) : null;
}

function pageLink(
  ctx: SurahRouteContext,
  surah: CatalogEntry,
  localPage: number,
  pageCount: number,
): SurahLocalPageLink | null {
  if (localPage < 1 || localPage > pageCount) return null;
  return { localPage, href: surahLocalPagePathFor(ctx, surah, localPage) };
}

function readingPreviousHref(
  ctx: SurahRouteContext,
  surah: CatalogEntry,
  localPage: number,
): `/app/${string}` | null {
  if (localPage > 1) return surahLocalPagePathFor(ctx, surah, localPage - 1);
  const previous = surahLinkAt(surah.num - 1);
  if (!previous) return null;
  return surahLocalPagePathFor(ctx, previous, QURAN_DATA.surahLocalPageCount(previous.num));
}

function readingNextHref(
  ctx: SurahRouteContext,
  surah: CatalogEntry,
  localPage: number,
  pageCount: number,
): `/app/${string}` | null {
  if (localPage < pageCount) return surahLocalPagePathFor(ctx, surah, localPage + 1);
  const next = surahLinkAt(surah.num + 1);
  return next ? surahPathFor(ctx, next) : null;
}

export function surahRouteNav(
  ctx: SurahRouteContext,
  surah: CatalogEntry,
  localPage: number,
  pageCount: number,
): SurahRouteNav {
  return {
    previousPage: pageLink(ctx, surah, localPage - 1, pageCount),
    nextPage: pageLink(ctx, surah, localPage + 1, pageCount),
    previousSurah: surahLinkAt(surah.num - 1),
    nextSurah: surahLinkAt(surah.num + 1),
    readingPreviousHref: readingPreviousHref(ctx, surah, localPage),
    readingNextHref: readingNextHref(ctx, surah, localPage, pageCount),
  };
}

/** Resolves the Juz/Page entry a range route asks for, 404-ing on an out-of-range index. */
export function requireRangeEntry(kind: "juz" | "page", index: number): RangeEntry {
  const entry = QURAN_DATA.rangeByIndex(kind === "juz" ? RangeKind.Juz : RangeKind.Page, index);
  if (!entry) throw error(404, `Unknown ${kind}: ${index}`);
  return entry;
}

export function toRangePageData(
  kind: "juz" | "page",
  index: number,
  entry: RangeEntry,
  ayahs: Ayah[],
  normalizations: SurahNormalization[],
): RangePageData {
  const surahNums = new Set(ayahs.map((ayah) => ayah.surah));
  return {
    kind,
    index,
    label: `${kind === "juz" ? "Juz" : "Page"} ${index}`,
    startGlobal: entry.startGlobal,
    endGlobal: entry.endGlobal,
    first: entry.first,
    last: entry.last,
    ayahs,
    normalizations,
    surahs: [...surahNums].flatMap((num) => surahLinkAt(num) ?? []),
  };
}
