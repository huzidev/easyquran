import type { QuranData } from "$lib/data/quran-data";

import {
  JUZ_ALIASES,
  PAGE_ALIASES,
  QURAN_ALIASES,
  SAJDA_ALIASES,
  SURAH_ALIASES,
  placeForAlias,
} from "./aliases";
import { juzKeywordFor } from "./juz-nicknames";
import {
  hasKeyword,
  isBareNumber,
  parseQuery,
  referenceNumbers,
  residualText,
  type ParsedQuery,
} from "./parse";
import type { NavMatch } from "./types";

const JUZ_COUNT = 30;
const MUSHAF_PAGE_COUNT = 604;

function pushAyah(out: NavMatch[], data: QuranData, surah: number, ayah: number): void {
  const entry = data.surahByNum(surah);
  if (!entry || ayah < 1 || ayah > entry.ayahCount) return;
  out.push({ id: `ayah:${surah}:${ayah}`, score: 1, target: { kind: "ayah", surah, ayah } });
}

function pushSurah(out: NavMatch[], data: QuranData, surah: number, score: number): void {
  if (!data.surahByNum(surah)) return;
  out.push({ id: `surah:${surah}`, score, target: { kind: "surah", surah } });
}

function pushJuz(out: NavMatch[], juz: number, score: number): void {
  if (juz < 1 || juz > JUZ_COUNT) return;
  out.push({ id: `juz:${juz}`, score, target: { kind: "juz", juz } });
}

function pushPage(out: NavMatch[], page: number, score: number): void {
  if (page < 1 || page > MUSHAF_PAGE_COUNT) return;
  out.push({ id: `page:${page}`, score, target: { kind: "page", page } });
}

/**
 * Sajda matches for a query carrying the sajda keyword: the whole table
 * (score 0.5, index order), one surah's sajda(s) when a single number is
 * present (score 1), or the exact ayah for an `S:A` ref (score 1).
 */
export function matchSajdas(data: QuranData, parsed: ParsedQuery): NavMatch[] {
  const ref = referenceNumbers(parsed);
  const all = data.sajdas();
  const out: NavMatch[] = [];
  for (const sajda of all) {
    let score: number | null = 0.5;
    if (ref?.secondary !== undefined) {
      score = sajda.surah === ref.primary && sajda.ayah === ref.secondary ? 1 : null;
    } else if (ref?.primary !== undefined) {
      score = sajda.surah === ref.primary ? 1 : null;
    }
    if (score === null) continue;
    out.push({
      id: `sajda:${sajda.surah}:${sajda.ayah}`,
      score,
      target: {
        kind: "sajda",
        surah: sajda.surah,
        ayah: sajda.ayah,
        index: sajda.index,
        sajdaKind: sajda.kind,
      },
    });
  }
  return out;
}

/**
 * Splits a place filter token out of a raw query wherever the word sits:
 * `"meccan kahf"` → `{ place: "meccan", text: "kahf" }`, `"مكية"` →
 * `{ place: "meccan", text: "" }`. Only the first place word is honored.
 */
export interface SplitPlace {
  readonly place: "meccan" | "medinan" | null;
  readonly text: string;
}

export function splitPlaceToken(raw: string): SplitPlace {
  const words = raw.trim().split(/\s+/).filter((word) => word.length > 0);
  let place: "meccan" | "medinan" | null = null;
  const kept: string[] = [];
  for (const word of words) {
    let candidate: "meccan" | "medinan" | null = null;
    if (place === null) candidate = placeForAlias(word.toLowerCase());
    if (candidate !== null) place = candidate;
    else kept.push(word);
  }
  return { place, text: kept.join(" ") };
}

/**
 * True when a query too short for full-text still deserves nav chips — at
 * least two characters AND a trailing number or a recognized Quran keyword.
 */
export function isNavCandidate(raw: string): boolean {
  const parsed = parseQuery(raw);
  if (parsed.text.length < 2) return false;
  return parsed.numbers.length > 0 || hasKeyword(parsed, QURAN_ALIASES);
}

function rankAndCap(matches: readonly NavMatch[], limit: number): NavMatch[] {
  const indexed = matches.map((match, index) => ({ match, index }));
  indexed.sort((a, b) => b.match.score - a.match.score || a.index - b.index);
  return indexed.slice(0, limit).map(({ match }) => match);
}

/**
 * Structured-coordinate matcher shared by the palette and the /app/search
 * page: ayah refs (`2:255`, Arabic-Indic digits included), keyword-guarded
 * juz/page/surah/sajda targets, juz nicknames, bare-number surah/juz/page
 * ambiguity and the revelation-place facet. Out-of-range coordinates emit
 * nothing; a keyword that owns the query (juz/page/sajda) consumes its number
 * so domains never fight over the same digits.
 */
export function matchNav(data: QuranData, rawQuery: string, limit = 12): NavMatch[] {
  const parsed = parseQuery(rawQuery);
  if (parsed.isEmpty) return [];
  const ref = referenceNumbers(parsed);
  const out: NavMatch[] = [];

  if (hasKeyword(parsed, SAJDA_ALIASES)) {
    out.push(...matchSajdas(data, parsed));
    return rankAndCap(out, limit);
  }

  if (hasKeyword(parsed, JUZ_ALIASES)) {
    const juz = ref?.primary;
    if (juz !== undefined) pushJuz(out, juz, 1);
    const nickname = juzKeywordFor(residualText(parsed, QURAN_ALIASES));
    if (nickname) pushJuz(out, nickname[1], 0.8);
    return rankAndCap(out, limit);
  }

  if (hasKeyword(parsed, PAGE_ALIASES)) {
    const page = ref?.primary;
    if (page !== undefined) pushPage(out, page, 1);
    return rankAndCap(out, limit);
  }

  if (hasKeyword(parsed, SURAH_ALIASES)) {
    if (ref?.secondary !== undefined) pushAyah(out, data, ref.primary, ref.secondary);
    else if (ref?.primary !== undefined) pushSurah(out, data, ref.primary, 1);
    return rankAndCap(out, limit);
  }

  if (ref?.secondary !== undefined) {
    pushAyah(out, data, ref.primary, ref.secondary);
    return rankAndCap(out, limit);
  }

  if (ref?.primary !== undefined && isBareNumber(parsed)) {
    pushSurah(out, data, ref.primary, 1);
    pushJuz(out, ref.primary, 0.9);
    pushPage(out, ref.primary, 0.8);
    return rankAndCap(out, limit);
  }

  const nickname = juzKeywordFor(residualText(parsed, QURAN_ALIASES));
  if (nickname) pushJuz(out, nickname[1], 0.8);

  const { place } = splitPlaceToken(parsed.text);
  if (place !== null) {
    const surahCount = data.surahs.filter((surah) => surah.place === place).length;
    out.push({ id: `place:${place}`, score: 0.85, target: { kind: "place", place, surahCount } });
  }

  return rankAndCap(out, limit);
}
