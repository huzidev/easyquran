import type { Highlight } from "$lib/quran/search/types";

/** Search result row normalized across the Arabic corpus and translation FTS indexes. */
export interface SectionHit {
  readonly surah: number;
  readonly ayah: number;
  readonly text: string;
  readonly highlights: readonly Highlight[];
}

/** `idle` = waiting, `loading`/`more` = fetch in flight, `gated` = skipped with a reason shown. */
export type SectionPhase = "idle" | "loading" | "more" | "done" | "error" | "gated";

/** Why a section was skipped instead of searched. */
export type SectionGate = "arabic" | "rtl";

/** Per-source results: keyed `"arabic"` or a translation id; `offset` is the fetched-through cursor. */
export interface SectionState {
  readonly id: string;
  readonly kind: "arabic" | "translation";
  phase: SectionPhase;
  gate: SectionGate | null;
  hits: SectionHit[];
  total: number;
  offset: number;
  limit: number;
}

/** Pure surah jump-list entry scored from the committed query. */
export interface SurahSuggestion {
  readonly num: number;
  readonly name: string;
  readonly transliteration: string;
  readonly arabic: string;
  readonly meaning: string;
  readonly score: number;
}
