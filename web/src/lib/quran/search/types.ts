import type { Ayah } from "$lib/data/quran-types";

export interface SearchOpts {
  limit?: number;
  offset?: number;
}

export interface Highlight {
  start: number;
  end: number;
}

export const SearchHitKind = {
  Ayah: "ayah",
  Opener: "opener",
} as const;
export type SearchHitKind = (typeof SearchHitKind)[keyof typeof SearchHitKind];

export const SearchProvider = {
  Worker: "worker",
  Api: "api",
  Names: "names",
} as const;
export type SearchProvider = (typeof SearchProvider)[keyof typeof SearchProvider];

export interface AyahSearchHit {
  kind: typeof SearchHitKind.Ayah;
  ayah: Ayah;
  highlights: Highlight[];
}

export interface OpenerSearchHit {
  kind: typeof SearchHitKind.Opener;
  key: `opener:${number}`;
  surah: number;
  anchorAyah: 1;
  text: string;
  highlights: Highlight[];
}

export type SearchHit = AyahSearchHit | OpenerSearchHit;

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  results: SearchHit[];
  source: SearchProvider;
}

export interface TranslationSearchHit {
  kind: typeof SearchHitKind.Ayah;
  sourceId: string;
  ayah: Ayah;
  highlights: Highlight[];
}

export interface TranslationSearchResponse {
  query: string;
  sourceId: string;
  total: number;
  limit: number;
  offset: number;
  results: TranslationSearchHit[];
  source: typeof SearchProvider.Worker;
}

export function searchHitKey(hit: SearchHit): string {
  return hit.kind === SearchHitKind.Opener ? hit.key : hit.ayah.key;
}

export function searchHitSurah(hit: SearchHit): number {
  return hit.kind === SearchHitKind.Opener ? hit.surah : hit.ayah.surah;
}

export function searchHitAnchorAyah(hit: SearchHit): number {
  return hit.kind === SearchHitKind.Opener ? hit.anchorAyah : hit.ayah.ayah;
}

export function searchHitText(hit: SearchHit): string {
  return hit.kind === SearchHitKind.Opener ? hit.text : hit.ayah.text;
}
