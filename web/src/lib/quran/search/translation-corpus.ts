import { clamp } from "es-toolkit";

import type { CanonicalQuranRow } from "../sql.ts";
import { isEligibleLatinQuery, normalizeLatin, normalizeLatinWithMap } from "./normalize-latin.ts";
import { DEFAULT_LIMIT, DEFAULT_OFFSET, MAX_LIMIT, MAX_OFFSET } from "./normalize.ts";
import { SearchHitKind, type Highlight, type SearchOpts, type TranslationSearchHit } from "./types.ts";

export interface TranslationSearchUnit {
  surah: number;
  ayah: number;
  globalIndex: number;
  norm: string;
  starts: Uint16Array;
  ends: Uint16Array;
}

export interface TranslationSearchOpts extends SearchOpts {
  sourceId: string;
  textFor: (globalIndex: number) => string;
}

export function buildTranslationSearchCorpus(
  rows: readonly CanonicalQuranRow[],
): TranslationSearchUnit[] {
  const units: TranslationSearchUnit[] = [];
  let expected = 1;
  for (const row of rows) {
    if (row.globalIndex !== expected) {
      throw new Error(
        `[translation-search] expected contiguous globalIndex ${expected}, received ${row.globalIndex}`,
      );
    }
    expected += 1;
    const map = normalizeLatinWithMap(row.text);
    units.push({
      surah: row.surah,
      ayah: row.ayah,
      globalIndex: row.globalIndex,
      norm: map.normalized,
      starts: map.starts,
      ends: map.ends,
    });
  }
  return units;
}

function highlightsFor(unit: TranslationSearchUnit, normalizedQuery: string): Highlight[] {
  const highlights: Highlight[] = [];
  let from = 0;
  while (from <= unit.norm.length - normalizedQuery.length) {
    const start = unit.norm.indexOf(normalizedQuery, from);
    if (start < 0) break;
    const last = start + normalizedQuery.length - 1;
    const rawStart = unit.starts[start];
    const rawEnd = unit.ends[last];
    if (rawStart !== undefined && rawEnd !== undefined && rawStart < rawEnd) {
      highlights.push({ start: rawStart, end: rawEnd });
    }
    from = start + Math.max(1, normalizedQuery.length);
  }
  return highlights;
}

export interface TranslationCorpusSearchResult {
  total: number;
  limit: number;
  offset: number;
  results: TranslationSearchHit[];
}

export function searchTranslationCorpus(
  units: readonly TranslationSearchUnit[],
  query: string,
  opts: TranslationSearchOpts,
): TranslationCorpusSearchResult {
  const normalized = normalizeLatin(query);
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 0, MAX_LIMIT);
  const offset = clamp(opts.offset ?? DEFAULT_OFFSET, 0, MAX_OFFSET);
  if (!isEligibleLatinQuery(normalized)) return { total: 0, limit, offset, results: [] };

  const matching = units.filter((unit) => unit.norm.includes(normalized));
  return {
    total: matching.length,
    limit,
    offset,
    results: matching.slice(offset, offset + limit).map((unit) => ({
      kind: SearchHitKind.Ayah,
      sourceId: opts.sourceId,
      ayah: {
        key: `${unit.surah}:${unit.ayah}`,
        surah: unit.surah,
        ayah: unit.ayah,
        globalIndex: unit.globalIndex,
        text: opts.textFor(unit.globalIndex),
      },
      highlights: highlightsFor(unit, normalized),
    })),
  };
}
