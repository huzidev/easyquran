import type { Pathname } from "$app/types";
import type { IconName } from "$lib/components/icon/icons";
import type { SurahRouteContext } from "$lib/data/quran";
import type { TranslationDirection } from "$lib/data/quran-types";
import type { QuranData } from "$lib/data/quran-data";
import type { Highlight } from "$lib/quran/search/types";

/**
 * A row heading in the palette. Domains own their groups: the Quran sources
 * ship `verses`/`surahs`/`ranges`, and a hadith or tafsir source registers its
 * own with an `order` that slots it between the existing ones.
 */
export interface PaletteGroup {
  id: string;
  label: string;
  /** Ascending. Lower sorts nearer the top of the list. */
  order: number;
}

export interface PaletteEntry {
  /** Unique across the whole result list — also the `Command.Item` value. */
  id: string;
  sourceId: string;
  groupId: string;
  label: string;
  detail?: string;
  /** Right-aligned Arabic label, e.g. a surah's Arabic name. */
  arabic?: string;
  /**
   * Body preview with match offsets, for full-text hits. Arabic unless `dir`
   * says otherwise — translation hits carry the catalogue direction so the
   * palette renders them LTR instead of through the Arabic renderer.
   */
  preview?: { text: string; highlights: readonly Highlight[]; dir?: TranslationDirection };
  icon: IconName;
  /** Relevance in `[0, 1]`. Sources rank within themselves; groups keep order. */
  score: number;
  /** Where selecting this entry navigates. Omit for pure actions. */
  href?: Pathname;
  /** Side effect to run on select — before navigation, if there is any. */
  run?: () => void;
  /**
   * Identity for cross-source dedupe. Two sources that surface the same verse
   * should agree on this so only the better-placed one renders.
   */
  dedupeKey?: string;
}

/**
 * A query, parsed once and shared by every source, so each source does pattern
 * matching instead of re-tokenizing. `keyword` is the leading word as typed
 * (`juz`, `page`, `bukhari`, …) — a source claims it if it recognizes it, and
 * ignores it otherwise, since it is also just the first word of free text.
 */
import type { ParsedQuery as ParsedQueryType } from "$lib/search/nav/parse";

export type ParsedQuery = ParsedQueryType;

export interface PaletteQuery {
  parsed: ParsedQuery;
  /** Active reader route context — keeps translation segments across jumps. */
  routeContext: SurahRouteContext;
  /** Canonical catalogue. Sources needing it are gated until it loads. */
  quranData: QuranData;
  /** Max entries this source should return. */
  limit: number;
}

/**
 * One searchable domain. `entries` answers from data already in memory and runs
 * on every keystroke; `search` is for anything that has to go over a wire or
 * into a worker, and is debounced and cancelled by the engine.
 */
export interface PaletteSource {
  /** Stable, namespaced: `quran.surahs`, `hadith.bukhari`, `tafsir.ibn-kathir`. */
  id: string;
  /** Groups this source can emit into. Registered with the source. */
  groups: readonly PaletteGroup[];
  /** Default cap on this source's entries per query. */
  limit?: number;
  /** Cheap gate — skip the source entirely when it cannot match. */
  enabled?(query: PaletteQuery): boolean;
  entries?(query: PaletteQuery): PaletteEntry[];
  search?(query: PaletteQuery, signal: AbortSignal): Promise<PaletteEntry[]>;
}
