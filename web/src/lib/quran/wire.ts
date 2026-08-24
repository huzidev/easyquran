import {
  isOpenerKind,
  isOpenerPackaging,
  isQuranScript,
  isQuranSourceId,
  OpenerKind,
  OpenerPackaging,
  QuranScript,
  type Ayah,
  type QuranRangeText,
  type QuranSurahText,
  type SurahNormalization,
} from "$lib/data/quran-types";
import { isNumber, isString } from "es-toolkit";

import { SearchHitKind, type SearchHit, type TranslationSearchHit } from "./search/types";
import { sourceProfile } from "./view/source-profiles";

export type AyahCoordinateValidator = (globalIndex: number, surah: number, ayah: number) => boolean;

// eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- decoded JSON object bag: every field read below is followed by a per-field decode check
type WireRecord = Record<string, unknown>;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- wire-boundary parser: raw is arbitrary fetch/Worker JSON; this fn establishes the record contract
function asRecord(raw: unknown): WireRecord | null {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- boundary discrimination of JSON objects from primitives; arrays pass through and fail later field checks
  if (!raw || typeof raw !== "object") return null;
  // SAFETY: truthy + typeof "object" excludes null, undefined, and primitives; JSON never yields functions, so raw is a string-keyed record.
  return raw as WireRecord;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- wire-boundary unwrap: raw is arbitrary fetch/Worker JSON
export function unwrapEnvelope(raw: unknown) {
  const rec = asRecord(raw);
  if (!rec) return raw;
  return rec.data ?? raw;
}

export function decodeSearchHit(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified search API JSON; this fn is the parser
  raw: unknown,
  validateCoordinate?: AyahCoordinateValidator,
): SearchHit | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  if (rec.kind === SearchHitKind.Opener) {
    const surah = positiveInteger(rec.surah, 114);
    const text = isString(rec.text) ? rec.text : null;
    if (surah === null || text === null || rec.key !== `opener:${surah}`) return null;
    const highlights = decodeHighlights(rec.highlights, text.length);
    if (!highlights) return null;
    if (rec.anchorAyah !== 1) return null;
    return {
      kind: SearchHitKind.Opener,
      key: `opener:${surah}`,
      surah,
      anchorAyah: 1,
      text,
      highlights,
    };
  }
  if (rec.kind !== SearchHitKind.Ayah) return null;
  const ayah = decodeAyah(rec.ayah, validateCoordinate);
  if (!ayah) return null;
  const highlights = decodeHighlights(rec.highlights, ayah.text.length);
  if (!highlights) return null;
  return {
    kind: SearchHitKind.Ayah,
    ayah,
    highlights,
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- field decoder: value is an unvalidated JSON field; the number check below is the parse
function positiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= max
    ? value
    : null;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- field decoder: value is an unvalidated JSON field; the number check below is the parse
function nonNegativeInteger(value: unknown): number | null {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
function decodeAyah(raw: unknown, validateCoordinate?: AyahCoordinateValidator): Ayah | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const surah = positiveInteger(rec.surah, 114);
  const ayah = positiveInteger(rec.ayah);
  const globalIndex = positiveInteger(rec.globalIndex, 6236);
  const text = isString(rec.text) ? rec.text : null;
  if (
    surah === null ||
    ayah === null ||
    globalIndex === null ||
    text === null ||
    rec.key !== `${surah}:${ayah}` ||
    (validateCoordinate && !validateCoordinate(globalIndex, surah, ayah))
  ) {
    return null;
  }
  return { key: `${surah}:${ayah}`, surah, ayah, globalIndex, text };
}

function decodeRangeText(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
  raw: unknown,
  validateCoordinate: AyahCoordinateValidator | undefined,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- decodeNorm consumes an unvalidated normalizations[] JSON element
  decodeNorm: (raw: unknown) => SurahNormalization | null,
): QuranRangeText | null {
  const rec = asRecord(raw);
  if (!rec || !Array.isArray(rec.ayahs) || !Array.isArray(rec.normalizations)) return null;
  const ayahs: Ayah[] = [];
  for (const item of rec.ayahs) {
    const ayah = decodeAyah(item, validateCoordinate);
    if (!ayah) return null;
    const previous = ayahs.at(-1);
    if (previous && ayah.globalIndex !== previous.globalIndex + 1) return null;
    ayahs.push(ayah);
  }
  const normalizations: SurahNormalization[] = [];
  for (const item of rec.normalizations) {
    const normalization = decodeNorm(item);
    if (!normalization) return null;
    normalizations.push(normalization);
  }
  const represented = new Set(ayahs.map((ayah) => ayah.surah));
  if (
    represented.size !== normalizations.length ||
    normalizations.some((normalization) => !represented.has(normalization.surah))
  ) {
    return null;
  }
  return { ayahs, normalizations };
}

export function decodeQuranRangeText(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
  raw: unknown,
  validateCoordinate?: AyahCoordinateValidator,
): QuranRangeText | null {
  return decodeRangeText(raw, validateCoordinate, decodeSurahNormalization);
}

function decodeHighlights(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- field decoder: raw is the unvalidated highlights JSON array
  raw: unknown,
  textLength: number,
): { start: number; end: number }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { start: number; end: number }[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) return null;
    const start = nonNegativeInteger(rec.start);
    const end = nonNegativeInteger(rec.end);
    if (start === null || end === null || end <= start || end > textLength) return null;
    out.push({ start, end });
  }
  return out;
}

/**
 * `null` = legitimately absent, `undefined` = malformed for this opener kind, which makes the
 * whole record invalid. An opener-less Surah must carry an explicitly null openerText.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- field decoder: value is the unvalidated openerText JSON field
function decodeOpenerText(openerKind: OpenerKind, value: unknown): string | null | undefined {
  if (openerKind === OpenerKind.None) return value === null ? null : undefined;
  return isString(value) ? value : undefined;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
function decodeSurahNormalization(raw: unknown): SurahNormalization | null {
  const rec = asRecord(raw);
  if (
    !rec ||
    !isString(rec.sourceId) ||
    !isQuranSourceId(rec.sourceId) ||
    !isString(rec.script) ||
    !isQuranScript(rec.script)
  ) {
    return null;
  }
  if (
    !isString(rec.sourceProfile) ||
    !isString(rec.packaging) ||
    !isOpenerPackaging(rec.packaging)
  ) {
    return null;
  }
  const profile = sourceProfile(rec.sourceId);
  if (profile.id !== rec.sourceProfile || profile.script !== rec.script) return null;
  if (!isString(rec.openerKind) || !isOpenerKind(rec.openerKind)) return null;
  const openerEndScalar = nonNegativeInteger(rec.openerEndScalar);
  const bodyStartScalar = nonNegativeInteger(rec.bodyStartScalar);
  const surah = positiveInteger(rec.surah, 114);
  if (
    surah === null ||
    openerEndScalar === null ||
    bodyStartScalar === null ||
    openerEndScalar > bodyStartScalar
  ) {
    return null;
  }
  const openerText = decodeOpenerText(rec.openerKind, rec.openerText);
  if (openerText === undefined) return null;
  return {
    surah,
    sourceId: rec.sourceId,
    script: rec.script,
    sourceProfile: rec.sourceProfile,
    packaging: rec.packaging,
    openerKind: rec.openerKind,
    openerText,
    openerEndScalar,
    bodyStartScalar,
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
export function decodeQuranSurahText(raw: unknown): QuranSurahText | null {
  const rec = asRecord(raw);
  if (
    !rec ||
    !isString(rec.sourceId) ||
    !isQuranSourceId(rec.sourceId) ||
    !isString(rec.script) ||
    !isQuranScript(rec.script)
  ) {
    return null;
  }
  if (
    !Array.isArray(rec.verses) ||
    !rec.verses.every((verse): verse is string => isString(verse))
  ) {
    return null;
  }
  const normalization = decodeSurahNormalization(rec.normalization);
  if (
    !normalization ||
    normalization.sourceId !== rec.sourceId ||
    normalization.script !== rec.script
  ) {
    return null;
  }
  return {
    sourceId: rec.sourceId,
    script: rec.script,
    verses: rec.verses.slice(),
    normalization,
  };
}

export interface DecodedSearchPayload {
  query: string | null;
  total: number | null;
  limit: number | null;
  offset: number | null;
  results: SearchHit[];
}

export function decodeSearchResponse(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified search API JSON; this fn is the parser
  raw: unknown,
  validateCoordinate?: AyahCoordinateValidator,
): DecodedSearchPayload | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  if (!Array.isArray(rec.results)) return null;
  const results: SearchHit[] = [];
  for (const item of rec.results) {
    const hit = decodeSearchHit(item, validateCoordinate);
    if (!hit) return null;
    results.push(hit);
  }
  return {
    query: isString(rec.query) ? rec.query : null,
    total: nonNegativeInteger(rec.total),
    limit: nonNegativeInteger(rec.limit),
    offset: nonNegativeInteger(rec.offset),
    results,
  };
}

function decodeOrderedHighlights(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- field decoder: raw is the unvalidated highlights JSON array
  raw: unknown,
  textLength: number,
): { start: number; end: number }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { start: number; end: number }[] = [];
  let previousEnd = 0;
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) return null;
    const start = nonNegativeInteger(rec.start);
    const end = nonNegativeInteger(rec.end);
    if (start === null || end === null || end <= start || end > textLength) return null;
    if (start < previousEnd) return null;
    previousEnd = end;
    out.push({ start, end });
  }
  return out;
}

function decodeTranslationSearchHit(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
  raw: unknown,
  sourceId: string,
  validateCoordinate?: AyahCoordinateValidator,
): TranslationSearchHit | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  if (rec.kind !== SearchHitKind.Ayah) return null;
  if (rec.sourceId !== sourceId) return null;
  const ayah = decodeAyah(rec.ayah, validateCoordinate);
  if (!ayah) return null;
  const highlights = decodeOrderedHighlights(rec.highlights, ayah.text.length);
  if (!highlights) return null;
  return { kind: SearchHitKind.Ayah, sourceId, ayah, highlights };
}

export interface DecodedTranslationSearchPayload {
  query: string | null;
  sourceId: string | null;
  total: number | null;
  limit: number | null;
  offset: number | null;
  results: TranslationSearchHit[];
}

export function decodeTranslationSearchResponse(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
  raw: unknown,
  validateCoordinate?: AyahCoordinateValidator,
): DecodedTranslationSearchPayload | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const sourceId = isString(rec.sourceId) && rec.sourceId.length > 0 ? rec.sourceId : null;
  if (!sourceId) return null;
  if (!Array.isArray(rec.results)) return null;
  const results: TranslationSearchHit[] = [];
  let previousGlobalIndex = 0;
  for (const item of rec.results) {
    const hit = decodeTranslationSearchHit(item, sourceId, validateCoordinate);
    if (!hit) return null;
    if (hit.ayah.globalIndex <= previousGlobalIndex) return null;
    previousGlobalIndex = hit.ayah.globalIndex;
    results.push(hit);
  }
  return {
    query: isString(rec.query) ? rec.query : null,
    sourceId,
    total: nonNegativeInteger(rec.total),
    limit: nonNegativeInteger(rec.limit),
    offset: nonNegativeInteger(rec.offset),
    results,
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
function decodeTranslationNormalization(raw: unknown): SurahNormalization | null {
  const rec = asRecord(raw);
  if (!rec || rec.script !== QuranScript.Translation) return null;
  if (!isString(rec.sourceId) || rec.sourceId.length === 0) return null;
  if (!isString(rec.sourceProfile)) return null;
  if (rec.packaging !== OpenerPackaging.Absent) return null;
  if (rec.openerKind !== OpenerKind.None) return null;
  if (rec.openerText !== null) return null;
  const surah = positiveInteger(rec.surah, 114);
  const openerEndScalar = nonNegativeInteger(rec.openerEndScalar);
  const bodyStartScalar = nonNegativeInteger(rec.bodyStartScalar);
  if (surah === null || openerEndScalar !== 0 || bodyStartScalar !== 0) return null;
  return {
    surah,
    sourceId: rec.sourceId,
    script: QuranScript.Translation,
    sourceProfile: rec.sourceProfile,
    packaging: OpenerPackaging.Absent,
    openerKind: OpenerKind.None,
    openerText: null,
    openerEndScalar: 0,
    bodyStartScalar: 0,
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
export function decodeTranslationSurahText(raw: unknown): QuranSurahText | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const sourceId = isString(rec.sourceId) && rec.sourceId.length > 0 ? rec.sourceId : null;
  if (!sourceId || rec.script !== QuranScript.Translation) return null;
  if (
    !Array.isArray(rec.verses) ||
    !rec.verses.every((verse): verse is string => isString(verse))
  ) {
    return null;
  }
  const normalization = decodeTranslationNormalization(rec.normalization);
  if (!normalization || normalization.sourceId !== sourceId) return null;
  return {
    sourceId,
    script: QuranScript.Translation,
    verses: rec.verses.slice(),
    normalization,
  };
}

export function decodeTranslationRangeText(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- wire decoder boundary: raw is unverified Worker JSON; this fn is the parser
  raw: unknown,
  validateCoordinate?: AyahCoordinateValidator,
): QuranRangeText | null {
  return decodeRangeText(raw, validateCoordinate, decodeTranslationNormalization);
}
