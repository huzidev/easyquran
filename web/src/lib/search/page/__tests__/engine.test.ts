import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CatalogEntry } from "$lib/data/quran-types";
import type { SearchResponse, TranslationSearchResponse } from "$lib/quran/search/types";
import { SearchHitKind, SearchProvider } from "$lib/quran/search/types";

interface EngineSeedState {
  artifacts: { id: string }[];
  selectionIds: string[];
}

interface ReleaseGate {
  release: ((value: SearchResponse) => void) | null;
}

const h = vi.hoisted(() => {
  const state: EngineSeedState = { artifacts: [], selectionIds: [] };
  return {
    state,
    quranSearch: vi.fn(),
    searchTranslation: vi.fn(),
    loadQuranData: vi.fn(),
  };
});

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$lib/quran/worker-client", () => ({
  quranWorker: {
    searchTranslation: h.searchTranslation,
  },
}));
vi.mock("$lib/quran/search", () => ({
  quranSearch: h.quranSearch,
}));
vi.mock("$lib/data/quran-data-client", () => ({
  loadQuranData: h.loadQuranData,
}));
vi.mock("$lib/stores/storage-report.svelte", () => ({
  storageReport: {
    get artifacts() {
      return h.state.artifacts;
    },
  },
}));
vi.mock("$lib/stores/search-selection.svelte", () => ({
  searchSelection: {
    get ids() {
      return h.state.selectionIds;
    },
  },
}));

import { createSearchEngine, type SearchEngine } from "../engine.svelte";

const LTR = "en.sahih";
const LTR_2 = "fr.hamidullah";
const LTR_3 = "nl.keyzer";
const LTR_4 = "en.pickthall";
const LTR_5 = "en.itani";
const LTR_6 = "de.khoury";
const LTR_7 = "es.cortes";
const RTL = "ar.jalalayn";
const DEBOUNCE = 140;

const surahs: CatalogEntry[] = [
  {
    num: 1,
    slug: "al-fatihah",
    name: "Al-Fatihah",
    arabic: "الفاتحة",
    transliteration: "Al-Fatihah",
    meaning: "The Opener",
    place: "meccan",
    ayahCount: 7,
    revelationOrder: 5,
    rukus: 1,
    openerKind: "verse",
    bismillah: "none",
    startGlobal: 0,
  },
  {
    num: 2,
    slug: "al-baqarah",
    name: "Al-Baqarah",
    arabic: "البقرة",
    transliteration: "Al-Baqarah",
    meaning: "The Cow",
    place: "medinan",
    ayahCount: 286,
    revelationOrder: 87,
    rukus: 40,
    openerKind: "verse",
    bismillah: "first-ayah",
    startGlobal: 7,
  },
];

function fakeQuranData() {
  return {
    surahs,
    globalIndexOf: (surah: number, ayah: number) => surah * 1000 + ayah,
  };
}

function arabicResponse(query: string, total: number, offset: number, limit: number): SearchResponse {
  const results: SearchResponse["results"] = [];
  const end = Math.min(offset + limit, total);
  for (let i = offset; i < end; i++) {
    results.push({
      kind: SearchHitKind.Ayah,
      ayah: { key: `1:${i + 1}`, surah: 1, ayah: i + 1, globalIndex: i, text: `${query} ${i + 1}` },
      highlights: [],
    });
  }
  return { query, total, limit, offset, results, source: SearchProvider.Worker };
}

function translationResponse(
  id: string,
  query: string,
  total: number,
  offset: number,
  limit: number,
): TranslationSearchResponse {
  const results: TranslationSearchResponse["results"] = [];
  const end = Math.min(offset + limit, total);
  for (let i = offset; i < end; i++) {
    results.push({
      kind: SearchHitKind.Ayah,
      sourceId: id,
      ayah: { key: `1:${i + 1}`, surah: 1, ayah: i + 1, globalIndex: i, text: `${query} ${i + 1}` },
      highlights: [],
    });
  }
  return {
    query,
    sourceId: id,
    total,
    limit,
    offset,
    results,
    source: SearchProvider.Worker,
  };
}

async function flush(turns = 30): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

async function commit(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DEBOUNCE + 5);
  await flush();
}

function seedCached(ids: readonly string[]): void {
  h.state.artifacts = ids.map((id) => ({ id }));
}

let engine: SearchEngine;

beforeEach(() => {
  vi.useFakeTimers();
  h.state.artifacts = [];
  h.state.selectionIds = [];
  h.quranSearch.mockReset();
  h.searchTranslation.mockReset();
  h.loadQuranData.mockReset().mockResolvedValue(fakeQuranData());
  h.quranSearch.mockImplementation(
    (query: string, opts: { offset?: number; limit?: number } | undefined) =>
      arabicResponse(query, 0, opts?.offset ?? 0, opts?.limit ?? 20),
  );
  engine = createSearchEngine();
});

afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

describe("createSearchEngine", () => {
  it("clears sections and idles on a too-short query", async () => {
    seedCached([LTR]);
    h.state.selectionIds = [LTR];
    engine.run("mercy");
    await commit();
    expect(engine.sections.size).toBe(2);

    engine.run("ab");
    await commit();
    expect(engine.committedQuery).toBe("ab");
    expect(engine.searching).toBe(false);
    expect(engine.sections.size).toBe(0);
    expect(h.quranSearch).toHaveBeenCalledTimes(1);
  });

  it("gates translation sections behind an Arabic-only note and never calls searchTranslation", async () => {
    seedCached([LTR]);
    h.state.selectionIds = [LTR];
    engine.run("الرحمن");
    await commit();

    const arabic = engine.sections.get("arabic");
    const translation = engine.sections.get(LTR);
    expect(arabic?.phase).toBe("done");
    expect(translation?.phase).toBe("gated");
    expect(engine.sections.get(LTR)?.gate).toBe("arabic");
    expect(h.searchTranslation).not.toHaveBeenCalled();
    expect(h.quranSearch).toHaveBeenCalledTimes(1);
  });

  it("isolates a rejected translation into its own error section while others finish", async () => {
    seedCached([LTR, LTR_2]);
    h.state.selectionIds = [LTR, LTR_2];
    h.searchTranslation.mockImplementation((id: string) => {
      if (id === LTR) return Promise.reject(new Error("corrupt db"));
      return Promise.resolve(translationResponse(id, "mercy", 4, 0, 20));
    });

    engine.run("mercy");
    await commit();

    expect(engine.sections.get(LTR)?.phase).toBe("error");
    expect(engine.sections.get(LTR_2)?.phase).toBe("done");
    expect(engine.sections.get(LTR_2)?.hits.length).toBe(4);
    expect(engine.sections.get("arabic")?.phase).toBe("done");
    expect(engine.searching).toBe(false);
  });

  it("runs translation batches sequentially with at most SEARCH_BATCH_SIZE in flight", async () => {
    const ids = [LTR, LTR_2, LTR_3, LTR_4, LTR_5, LTR_6, LTR_7];
    seedCached(ids);
    h.state.selectionIds = ids;
    let active = 0;
    let peak = 0;
    h.searchTranslation.mockImplementation(async (id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return translationResponse(id, "mercy", 1, 0, 20);
    });

    engine.run("mercy");
    await commit();

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
    for (const id of ids) expect(engine.sections.get(id)?.phase).toBe("done");
    expect(h.searchTranslation).toHaveBeenCalledTimes(7);
  });

  it("drops a slow stale run that resolves after a newer commit", async () => {
    const firstGate: ReleaseGate = { release: null };
    h.quranSearch.mockImplementationOnce(
      () =>
        new Promise<SearchResponse>((resolve) => {
          firstGate.release = resolve;
        }),
    );

    engine.run("first");
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 5);
    await flush();
    expect(firstGate.release).not.toBeNull();

    engine.run("second");
    await commit();
    expect(engine.sections.get("arabic")?.phase).toBe("done");

    firstGate.release?.(arabicResponse("first", 999, 0, 20));
    await flush();

    expect(engine.sections.get("arabic")?.total).toBe(0);
    expect(engine.sections.get("arabic")?.hits.length).toBe(0);
    expect(engine.committedQuery).toBe("second");
  });

  it("pages loadMore forward, hides at total, and stops at MAX_OFFSET", async () => {
    h.quranSearch.mockImplementation(
      (query: string, opts: { offset?: number; limit?: number } | undefined) =>
        arabicResponse(query, 25, opts?.offset ?? 0, opts?.limit ?? 20),
    );

    engine.run("mercy");
    await commit();
    let arabic = engine.sections.get("arabic");
    expect(arabic?.hits.length).toBe(20);
    expect(arabic?.offset).toBe(20);

    engine.loadMore("arabic");
    await flush();
    arabic = engine.sections.get("arabic");
    expect(arabic?.hits.length).toBe(25);
    expect(arabic?.offset).toBe(25);
    expect(arabic?.phase).toBe("done");

    engine.loadMore("arabic");
    await flush();
    expect(h.quranSearch).toHaveBeenCalledTimes(2);
    expect(engine.sections.get("arabic")?.hits.length).toBe(25);
  });

  it("clamps loadMore pagination at MAX_OFFSET (500)", async () => {
    h.quranSearch.mockImplementation(
      (query: string, opts: { offset?: number; limit?: number } | undefined) =>
        arabicResponse(query, 10_000, opts?.offset ?? 0, opts?.limit ?? 20),
    );

    engine.run("mercy");
    await commit();
    for (;;) {
      const section = engine.sections.get("arabic");
      if (!section || section.phase !== "done" || section.offset >= 500) break;
      engine.loadMore("arabic");
      await flush();
    }
    const section = engine.sections.get("arabic");
    expect(section?.offset).toBe(500);
    expect(section?.hits.length).toBe(500);

    const calls = h.quranSearch.mock.calls.length;
    engine.loadMore("arabic");
    await flush();
    expect(h.quranSearch.mock.calls.length).toBe(calls);
  });

  it("never searches an RTL-selected translation id", async () => {
    seedCached([RTL, LTR]);
    h.state.selectionIds = [RTL, LTR];
    h.searchTranslation.mockImplementation((id: string) =>
      translationResponse(id, "mercy", 1, 0, 20),
    );

    engine.run("mercy");
    await commit();

    expect(engine.sections.has(RTL)).toBe(false);
    expect(h.searchTranslation).toHaveBeenCalledTimes(1);
    expect(h.searchTranslation.mock.calls[0]?.[0]).toBe(LTR);
  });

  it("skips a selected translation with no cached artifact", async () => {
    h.state.selectionIds = [LTR];
    engine.run("mercy");
    await commit();
    expect(engine.sections.has(LTR)).toBe(false);
    expect(h.searchTranslation).not.toHaveBeenCalled();
  });

  it("auto-runs a newly cached section once without rebuilding the others", async () => {
    seedCached([LTR]);
    h.state.selectionIds = [LTR, LTR_2];
    h.searchTranslation.mockImplementation((id: string) =>
      translationResponse(id, "mercy", 2, 0, 20),
    );

    engine.run("mercy");
    await commit();
    expect(engine.sections.get(LTR)?.phase).toBe("done");
    expect(engine.sections.has(LTR_2)).toBe(false);

    seedCached([LTR, LTR_2]);
    engine.onArtifactsChanged();
    await flush();

    expect(engine.sections.get(LTR_2)?.phase).toBe("done");
    expect(engine.sections.get(LTR_2)?.hits.length).toBe(2);
    expect(engine.sections.get(LTR)?.hits.length).toBe(2);
    expect(h.searchTranslation).toHaveBeenCalledTimes(2);
  });

  it("retry re-runs a failed section at its current offset", async () => {
    seedCached([LTR]);
    h.state.selectionIds = [LTR];
    h.searchTranslation
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(translationResponse(LTR, "mercy", 3, 0, 20));

    engine.run("mercy");
    await commit();
    expect(engine.sections.get(LTR)?.phase).toBe("error");

    engine.retry(LTR);
    await flush();
    const section = engine.sections.get(LTR);
    expect(section?.phase).toBe("done");
    expect(section?.hits.length).toBe(3);
  });
});
