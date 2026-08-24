import { loadQuranData } from "$lib/data/quran-data-client";
import type { QuranData } from "$lib/data/quran-data";
import { TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";
import { isNavCandidate, matchNav, splitPlaceToken } from "$lib/search/nav/match";
import type { NavMatch } from "$lib/search/nav/types";
import { quranSearch } from "$lib/quran/search";
import {
  DEFAULT_LIMIT,
  DEFAULT_OFFSET,
  MAX_OFFSET,
  MIN_QUERY_LEN,
} from "$lib/quran/search/normalize";
import { containsArabicScript } from "$lib/quran/search/normalize-latin";
import {
  searchHitAnchorAyah,
  searchHitSurah,
  searchHitText,
  type SearchHit,
  type TranslationSearchHit,
} from "$lib/quran/search/types";
import { quranWorker } from "$lib/quran/worker-client";
import type { AyahCoordinateValidator } from "$lib/quran/wire";
import { searchSelection } from "$lib/stores/search-selection.svelte";
import { storageReport } from "$lib/stores/storage-report.svelte";

import { batchPlan, partitionSearchable, SEARCH_BATCH_SIZE } from "./selection";
import { MAX_SUGGESTIONS, suggestSurahs } from "./surah-suggest";
import type { SectionHit, SectionState, SurahSuggestion } from "./types";

export type { SectionGate, SectionHit, SectionPhase, SectionState, SurahSuggestion } from "./types";

/** Sections Map key for the Arabic corpus, never a translation id. */
export const ARABIC_SECTION_ID = "arabic";

const SEARCH_DEBOUNCE_MS = 140;
/** Room for the full sajda list plus coordinate matches beside it. */
const NAV_LIMIT = 18;

export interface SearchEngine {
  get inputQuery(): string;
  set inputQuery(value: string);
  readonly committedQuery: string;
  readonly searching: boolean;
  readonly sections: ReadonlyMap<string, SectionState>;
  readonly sectionList: readonly SectionState[];
  readonly surahSuggestions: readonly SurahSuggestion[];
  readonly navSuggestions: readonly NavMatch[];
  run(query: string): void;
  loadMore(sectionId: string): void;
  retry(sectionId: string): void;
  onArtifactsChanged(): void;
  dispose(): void;
}

function makeSection(id: string, kind: "arabic" | "translation"): SectionState {
  return {
    id,
    kind,
    phase: "loading",
    gate: null,
    hits: [],
    total: 0,
    offset: DEFAULT_OFFSET,
    limit: DEFAULT_LIMIT,
  };
}

function arabicHitToSectionHit(hit: SearchHit): SectionHit {
  return {
    surah: searchHitSurah(hit),
    ayah: searchHitAnchorAyah(hit),
    text: searchHitText(hit),
    highlights: hit.highlights,
  };
}

function translationHitToSectionHit(hit: TranslationSearchHit): SectionHit {
  return {
    surah: hit.ayah.surah,
    ayah: hit.ayah.ayah,
    text: hit.ayah.text,
    highlights: hit.highlights,
  };
}

/**
 * Client-side search orchestrator for /app/search: debounced run over the Arabic
 * corpus plus every selected, cached, LTR translation, with per-section state,
 * bounded worker concurrency, stale-run dropping and isolated failure.
 */
class Engine implements SearchEngine {
  inputQuery = $state("");
  committedQuery = $state("");
  searching = $state(false);
  /**
   * Render-facing section snapshot. The internal Map is plain (unreactive);
   * every mutation republishes a fresh array here. A $state Map was tried and
   * its updates never invalidated the page's {#each} fragments (results
   * computed but the UI stayed on skeletons, dev and prod, svelte 5.56.8) —
   * while $state.raw array replaces from async continuations provably render
   * (surahSuggestions does). Keep this shape until the toolchain is retested.
   */
  sectionList = $state.raw<readonly SectionState[]>([]);
  surahSuggestions = $state.raw<SurahSuggestion[]>([]);
  navSuggestions = $state.raw<readonly NavMatch[]>([]);

  #sections = new Map<string, SectionState>();

  #seq = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dataPromise: Promise<QuranData> | null = null;

  #syncSections(): void {
    this.sectionList = [...this.#sections.values()];
  }

  get sections(): ReadonlyMap<string, SectionState> {
    return this.#sections;
  }

  run(query: string): void {
    this.inputQuery = query;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#commit(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  async #commit(rawQuery: string): Promise<void> {
    const query = rawQuery.trim();
    const seq = ++this.#seq;
    this.committedQuery = query;
    this.surahSuggestions = [];
    this.navSuggestions = [];
    if (query.length < MIN_QUERY_LEN) {
      this.#sections = new Map();
      this.#syncSections();
      this.searching = false;
      if (isNavCandidate(query)) void this.#suggest(query, seq);
      return;
    }
    this.searching = true;
    const arabicOnly = containsArabicScript(query);
    const sections = new Map<string, SectionState>();
    sections.set(ARABIC_SECTION_ID, makeSection(ARABIC_SECTION_ID, "arabic"));
    const { searchable } = partitionSearchable(searchSelection.ids, TRANSLATION_CATALOGUE_BY_ID);
    const cachedIds: string[] = [];
    for (const id of searchable) {
      if (!this.#isCached(id)) continue;
      cachedIds.push(id);
      const section = makeSection(id, "translation");
      if (arabicOnly) {
        section.phase = "gated";
        section.gate = "arabic";
      }
      sections.set(id, section);
    }
    this.#sections = sections;
    this.#syncSections();
    void this.#suggest(query, seq);
    await Promise.all([
      this.#fetchInto(ARABIC_SECTION_ID, DEFAULT_OFFSET, seq, query),
      this.#runBatches(query, cachedIds, seq, arabicOnly),
    ]);
    if (seq !== this.#seq) return;
    this.searching = false;
  }

  async #runBatches(
    query: string,
    ids: readonly string[],
    seq: number,
    arabicOnly: boolean,
  ): Promise<void> {
    if (arabicOnly || ids.length === 0) return;
    const validator = await this.#validator();
    if (seq !== this.#seq) return;
    for (const batch of batchPlan(ids, SEARCH_BATCH_SIZE)) {
      if (seq !== this.#seq) return;
      await Promise.allSettled(
        batch.map((id) => this.#fetchInto(id, DEFAULT_OFFSET, seq, query, validator)),
      );
    }
  }

  async #fetchInto(
    sectionId: string,
    offset: number,
    seq: number,
    query: string = this.committedQuery,
    validator?: AyahCoordinateValidator,
  ): Promise<void> {
    try {
      if (sectionId === ARABIC_SECTION_ID) {
        const response = await quranSearch(query, { offset, limit: DEFAULT_LIMIT });
        if (seq !== this.#seq) return;
        this.#applyHits(
          sectionId,
          response.results.map((hit) => arabicHitToSectionHit(hit)),
          response.total,
          offset,
        );
        return;
      }
      const validate = validator ?? (await this.#validator());
      if (seq !== this.#seq) return;
      const response = await quranWorker.searchTranslation(
        sectionId,
        query,
        { offset, limit: DEFAULT_LIMIT },
        validate,
      );
      if (seq !== this.#seq) return;
      this.#applyHits(
        sectionId,
        response.results.map((hit) => translationHitToSectionHit(hit)),
        response.total,
        offset,
      );
    } catch {
      if (seq !== this.#seq) return;
      this.#failSection(sectionId);
    }
  }

  /** Applies an immutable section update and republishes the render snapshot. */
  #patchSection(sectionId: string, patch: Partial<SectionState>): void {
    const section = this.#sections.get(sectionId);
    if (!section) return;
    this.#sections.set(sectionId, { ...section, ...patch });
    this.#syncSections();
  }

  #applyHits(sectionId: string, hits: readonly SectionHit[], total: number, offset: number): void {
    const section = this.#sections.get(sectionId);
    if (!section) return;
    this.#patchSection(sectionId, {
      hits: [...section.hits, ...hits],
      total,
      offset: Math.max(section.offset, offset + hits.length),
      phase: "done",
      gate: null,
    });
  }

  #failSection(sectionId: string): void {
    const section = this.#sections.get(sectionId);
    if (!section || section.phase === "gated") return;
    this.#patchSection(sectionId, { phase: "error" });
  }

  async #suggest(query: string, seq: number): Promise<void> {
    try {
      const data = await this.#ensureData();
      if (seq !== this.#seq) return;
      const { place, text } = splitPlaceToken(query);
      if (place !== null && text.length === 0) {
        this.surahSuggestions = data.surahs
          .filter((entry) => entry.place === place)
          .slice(0, MAX_SUGGESTIONS)
          .map((entry) => ({
            num: entry.num,
            name: entry.name,
            transliteration: entry.transliteration,
            arabic: entry.arabic,
            meaning: entry.meaning,
            score: 0,
          }));
      } else {
        const ranked = suggestSurahs(data.surahs, text);
        this.surahSuggestions =
          place === null ? ranked : ranked.filter((s) => data.surahByNum(s.num)?.place === place);
      }
      this.navSuggestions = matchNav(data, query, NAV_LIMIT);
    } catch {
      this.surahSuggestions = [];
      this.navSuggestions = [];
    }
  }

  async #validator(): Promise<AyahCoordinateValidator> {
    const data = await this.#ensureData();
    return (globalIndex, surah, ayah) => data.globalIndexOf(surah, ayah) === globalIndex;
  }

  #ensureData(): Promise<QuranData> {
    if (this.#dataPromise === null) {
      const promise = loadQuranData();
      void promise.catch(() => {
        if (this.#dataPromise === promise) this.#dataPromise = null;
      });
      this.#dataPromise = promise;
    }
    return this.#dataPromise;
  }

  #isCached(id: string): boolean {
    return storageReport.artifacts.some((artifact) => artifact.id === id);
  }

  loadMore(sectionId: string): void {
    const section = this.#sections.get(sectionId);
    if (!section || section.phase !== "done") return;
    if (section.offset >= MAX_OFFSET) return;
    if (section.offset >= section.total) return;
    const seq = this.#seq;
    const nextOffset = Math.min(section.offset, MAX_OFFSET);
    this.#patchSection(sectionId, { phase: "more" });
    void this.#fetchInto(sectionId, nextOffset, seq);
  }

  retry(sectionId: string): void {
    const section = this.#sections.get(sectionId);
    if (!section || section.phase !== "error") return;
    const seq = this.#seq;
    this.#patchSection(sectionId, {
      phase: section.hits.length > 0 ? "more" : "loading",
    });
    void this.#fetchInto(sectionId, section.offset, seq);
  }

  /** Runs newly-cached selected translations once, without rebuilding existing sections. */
  onArtifactsChanged(): void {
    const query = this.committedQuery;
    if (query.length < MIN_QUERY_LEN || containsArabicScript(query)) return;
    const seq = this.#seq;
    const { searchable } = partitionSearchable(searchSelection.ids, TRANSLATION_CATALOGUE_BY_ID);
    for (const id of searchable) {
      if (this.#sections.has(id)) continue;
      if (!this.#isCached(id)) continue;
      this.#sections.set(id, makeSection(id, "translation"));
      void this.#fetchInto(id, DEFAULT_OFFSET, seq);
    }
    this.#syncSections();
  }

  dispose(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#seq += 1;
    this.searching = false;
  }
}

/** Creates an isolated engine instance; the page owns its lifetime and calls `dispose()` on unmount. */
export function createSearchEngine(): SearchEngine {
  return new Engine();
}
