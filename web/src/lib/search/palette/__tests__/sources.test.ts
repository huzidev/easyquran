import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("$env/dynamic/public", () => ({ env: {} }));

const { ensureTranslationMock, hasTranslationMock, searchTranslationMock } = vi.hoisted(() => ({
  ensureTranslationMock: vi.fn(),
  hasTranslationMock: vi.fn(),
  searchTranslationMock: vi.fn(),
}));

vi.mock("$lib/quran/worker-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/quran/worker-client")>()),
  quranWorker: {
    hasTranslation: (...args: unknown[]) => hasTranslationMock(...args),
    ensureTranslation: (...args: unknown[]) => ensureTranslationMock(...args),
    searchTranslation: (...args: unknown[]) => searchTranslationMock(...args),
  },
}));

import { surahRouteContext, type SurahRouteContext } from "$lib/data/quran";
import { createQuranData, type QuranData } from "$lib/data/quran-data";
import type { TranslationSearchResponse } from "$lib/quran/search/types";
import { reader } from "$lib/stores/reader.svelte";

import { PaletteGroups } from "../groups";
import { BUILTIN_PALETTE_SOURCES } from "../index";
import { parseQuery } from "../query";
import {
  DEFAULT_SOURCE_LIMIT,
  collectSyncEntries,
  dedupeEntries,
  paletteGroups,
  registerPaletteSource,
  sectionsFor,
  unregisterPaletteSource,
} from "../registry";
import { quranRangesSource } from "../sources/quran-ranges";
import { quranReferenceSource } from "../sources/quran-reference";
import { quranSurahsSource } from "../sources/quran-surahs";
import { quranTextSource } from "../sources/quran-text";
import { settingsRoutesSource } from "../sources/settings-routes";
import { siteRoutesSource } from "../sources/site-routes";
import { translationTextSource } from "../sources/translation-text";
import type { PaletteEntry, PaletteQuery, PaletteSource } from "../types";

const DATA_PATH = [
  path.resolve(process.cwd(), "static/quran-meta/quran-data.json"),
  path.resolve(process.cwd(), "web/static/quran-meta/quran-data.json"),
].find((candidate) => existsSync(candidate));
if (!DATA_PATH) throw new Error("missing quran-data.json fixture");
const QURAN: QuranData = createQuranData(JSON.parse(readFileSync(DATA_PATH, "utf8")));

const ARABIC = surahRouteContext("uthmani");
const TRANSLATED = surahRouteContext("ms.basmeih");

function query(text: string, ctx: SurahRouteContext = ARABIC, limit?: number): PaletteQuery {
  return {
    parsed: parseQuery(text),
    routeContext: ctx,
    quranData: QURAN,
    limit: limit ?? DEFAULT_SOURCE_LIMIT,
  };
}

function run(source: PaletteSource, text: string, ctx: SurahRouteContext = ARABIC): PaletteEntry[] {
  const scoped = query(text, ctx, source.limit ?? DEFAULT_SOURCE_LIMIT);
  if (!(source.enabled?.(scoped) ?? true)) return [];
  return (source.entries?.(scoped) ?? []).slice(0, scoped.limit);
}

async function runAsync(
  source: PaletteSource,
  text: string,
  ctx: SurahRouteContext = ARABIC,
): Promise<PaletteEntry[]> {
  const scoped = query(text, ctx, source.limit ?? DEFAULT_SOURCE_LIMIT);
  if (!(source.enabled?.(scoped) ?? true)) return [];
  return source.search?.(scoped, new AbortController().signal) ?? [];
}

const labels = (entries: readonly PaletteEntry[]): string[] => entries.map((e) => e.label);
const hrefs = (entries: readonly PaletteEntry[]): (string | undefined)[] =>
  entries.map((e) => e.href);

describe("quran.reference source", () => {
  it("resolves a surah:ayah reference to the page holding that verse", () => {
    const [entry] = run(quranReferenceSource, "2:255");
    expect(entry?.label).toBe("Al-Baqarah 2:255");
    expect(entry?.href).toBe("/app/al-baqarah/page/41#ayah-2-255");
    expect(entry?.groupId).toBe(PaletteGroups.JumpTo.id);
  });

  it("accepts the separators people actually type", () => {
    for (const raw of ["2:255", "2.255", "2 255", "2-255", "surah 2:255", "s 2:255"]) {
      expect(labels(run(quranReferenceSource, raw)), raw).toContain("Al-Baqarah 2:255");
    }
  });

  it("drops an ayah past the end of the surah", () => {
    expect(run(quranReferenceSource, "1:7")).toHaveLength(1);
    expect(run(quranReferenceSource, "1:8")).toHaveLength(0);
  });

  it("keeps a bare number ambiguous across surah, juz and page", () => {
    expect(labels(run(quranReferenceSource, "5"))).toEqual(["5. Al-Ma'idah", "Juz 5", "Page 5"]);
  });

  it("narrows a bare number by range: 40 is no longer a juz, 200 no longer a surah", () => {
    expect(labels(run(quranReferenceSource, "40"))).toEqual(["40. Ghafir", "Page 40"]);
    expect(labels(run(quranReferenceSource, "200"))).toEqual(["Page 200"]);
    expect(run(quranReferenceSource, "999")).toHaveLength(0);
  });

  it("honours an explicit keyword over the ambiguous reading", () => {
    expect(labels(run(quranReferenceSource, "juz 5"))).toEqual(["Juz 5"]);
    expect(labels(run(quranReferenceSource, "para 5"))).toEqual(["Juz 5"]);
    expect(labels(run(quranReferenceSource, "page 5"))).toEqual(["Page 5"]);
    expect(labels(run(quranReferenceSource, "p 5"))).toEqual(["Page 5"]);
    expect(labels(run(quranReferenceSource, "surah 5"))).toEqual(["5. Al-Ma'idah"]);
  });

  it("rejects out-of-range keyword references instead of linking nowhere", () => {
    expect(run(quranReferenceSource, "juz 31")).toHaveLength(0);
    expect(run(quranReferenceSource, "page 605")).toHaveLength(0);
    expect(run(quranReferenceSource, "surah 115")).toHaveLength(0);
  });

  it("stays disabled for queries without a number", () => {
    expect(quranReferenceSource.enabled?.(query("kahf"))).toBe(false);
    expect(quranReferenceSource.enabled?.(query("juz 5"))).toBe(true);
  });

  it("keeps the active translation in every reference href", () => {
    for (const raw of ["2:255", "juz 5", "page 100", "surah 18"]) {
      for (const href of hrefs(run(quranReferenceSource, raw, TRANSLATED))) {
        expect(href, raw).toContain("/t/ms/basmeih");
      }
    }
  });
});

describe("quran.surahs source", () => {
  it("matches on name, transliteration, meaning and slug", () => {
    for (const raw of ["kahf", "Al-Kahf", "al-kahf", "The Cave"]) {
      expect(labels(run(quranSurahsSource, raw))[0], raw).toBe("18. Al-Kahf");
    }
  });

  it("matches the Arabic name regardless of harakat or alef form", () => {
    for (const raw of ["البقرة", "ٱلْبَقَرَة", "البقره"]) {
      expect(labels(run(quranSurahsSource, raw))[0], raw).toBe("2. Al-Baqarah");
    }
  });

  it("ignores a claimed surah keyword when matching the name", () => {
    expect(labels(run(quranSurahsSource, "sura kahf"))[0]).toBe("18. Al-Kahf");
    expect(labels(run(quranSurahsSource, "surah البقرة"))[0]).toBe("2. Al-Baqarah");
  });

  it("promotes a name plus verse number to an exact verse jump", () => {
    const entries = run(quranSurahsSource, "baqarah 255");
    expect(entries[0]?.groupId).toBe(PaletteGroups.JumpTo.id);
    expect(entries[0]?.label).toBe("Al-Baqarah 2:255");
    expect(entries[0]?.href).toBe("/app/al-baqarah/page/41#ayah-2-255");
    // and still offers the surah itself
    expect(labels(entries)).toContain("2. Al-Baqarah");
  });

  it("drops the verse jump when the number is past the end of the surah", () => {
    const entries = run(quranSurahsSource, "fatihah 8");
    expect(entries.every((entry) => entry.groupId === PaletteGroups.Surahs.id)).toBe(true);
  });

  it("suggests a few surahs when the palette opens empty", () => {
    const entries = run(quranSurahsSource, "");
    expect(entries).toHaveLength(5);
    expect(entries[0]?.label).toBe("1. Al-Fatihah");
    expect(entries.every((entry) => entry.score === 0)).toBe(true);
  });

  it("returns nothing when nothing matches", () => {
    expect(run(quranSurahsSource, "zzzzqx")).toHaveLength(0);
  });

  it("keeps the active translation in surah hrefs", () => {
    expect(hrefs(run(quranSurahsSource, "kahf", TRANSLATED))[0]).toBe("/app/al-kahf/t/ms/basmeih");
  });
});

describe("quran.surahs typo tolerance", () => {
  it("rescues a mistyped name to the fold key-exact tier", () => {
    const entries = run(quranSurahsSource, "bakarah");
    expect(entries[0]?.label).toBe("2. Al-Baqarah");
    expect(entries[0]?.score).toBe(0.7);
  });

  it("promotes a mistyped name plus verse to the exact verse jump", () => {
    for (const raw of ["bakarah 255", "surah bakarah 255"]) {
      const entries = run(quranSurahsSource, raw);
      expect(entries[0]?.groupId, raw).toBe(PaletteGroups.JumpTo.id);
      expect(entries[0]?.label, raw).toBe("Al-Baqarah 2:255");
      expect(entries[0]?.dedupeKey, raw).toBe("ayah:2:255");
      expect(labels(entries), raw).toContain("2. Al-Baqarah");
    }
  });

  it("pins Ya-Sin for the fold-derived spelling and the catalogue spelling", () => {
    const yasin = run(quranSurahsSource, "yasin");
    expect(yasin[0]?.label).toBe("36. Ya-Sin");
    expect(yasin[0]?.score).toBe(0.7);
    const yaseen = run(quranSurahsSource, "yaseen");
    expect(yaseen[0]?.label).toBe("36. Ya-Sin");
    expect(yaseen[0]?.score).toBe(1);
  });

  it("catches one- and two-edit spellings of Maryam", () => {
    const mariam = run(quranSurahsSource, "mariam");
    expect(mariam[0]?.label).toBe("19. Maryam");
    expect(mariam[0]?.score).toBe(0.5);
    const meryem = run(quranSurahsSource, "meryem");
    expect(meryem[0]?.label).toBe("19. Maryam");
    expect(meryem[0]?.score).toBe(0.4);
  });

  it("matches the Tanzil long-vowel spellings rahmaan and teen", () => {
    const rahmaan = run(quranSurahsSource, "rahmaan");
    expect(rahmaan[0]?.label).toBe("55. Ar-Rahman");
    expect(rahmaan[0]?.score).toBe(0.8);
    const teen = run(quranSurahsSource, "teen");
    expect(teen[0]?.label).toBe("95. At-Tin");
    expect(teen[0]?.score).toBe(0.7);
  });

  it("resolves the bare and doubled spellings of Qaf", () => {
    const qaf = run(quranSurahsSource, "qaf");
    expect(qaf[0]?.label).toBe("50. Qaf");
    expect(qaf[0]?.score).toBe(1);
    const kaaf = run(quranSurahsSource, "kaaf");
    expect(kaaf[0]?.label).toBe("109. Al-Kafirun");
    expect(kaaf[0]?.score).toBe(0.8);
    const qafByFold = kaaf.find((entry) => entry.label === "50. Qaf");
    expect(qafByFold?.score).toBe(0.7);
  });

  it("keeps Al-Fatihah findable by its dropped-h spelling", () => {
    const fatiha = run(quranSurahsSource, "fatiha");
    expect(fatiha[0]?.label).toBe("1. Al-Fatihah");
    expect(fatiha[0]?.score).toBe(0.8);
    expect(fatiha.some((entry) => entry.label === "48. Al-Fath")).toBe(false);
  });

  it("keeps a two-edit spelling one letter apart in length on the distance tier", () => {
    const zilzal = run(quranSurahsSource, "zilzal");
    expect(zilzal[0]?.label).toBe("99. Az-Zalzalah");
    expect(zilzal[0]?.score).toBe(0.4);
  });

  it("rescues a mistyped keyword through per-word needles", () => {
    expect(labels(run(quranSurahsSource, "surh baqarah"))).toContain("2. Al-Baqarah");
  });

  it("keeps correctly-typed queries on their raw scores", () => {
    const baqarah = run(quranSurahsSource, "baqarah");
    expect(baqarah[0]?.label).toBe("2. Al-Baqarah");
    expect(baqarah[0]?.score).toBe(0.8);
    const cow = run(quranSurahsSource, "cow");
    expect(cow[0]?.label).toBe("2. Al-Baqarah");
    expect(cow[0]?.score).toBe(0.8);
    const mulk = run(quranSurahsSource, "mulk");
    expect(mulk[0]?.label).toBe("67. Al-Mulk");
    expect(mulk[0]?.score).toBe(0.8);
  });
});

describe("Arabic-Indic and Persian digits", () => {
  it("reads a verse reference written in Arabic-Indic digits", () => {
    const [entry] = run(quranReferenceSource, "٢:٢٥٥");
    expect(entry?.label).toBe("Al-Baqarah 2:255");
    expect(entry?.href).toBe("/app/al-baqarah/page/41#ayah-2-255");
  });

  it("reads keyword references in Arabic-Indic and Persian digits", () => {
    expect(labels(run(quranReferenceSource, "juz ٥"))).toEqual(["Juz 5"]);
    expect(labels(run(quranReferenceSource, "juz ۵"))).toEqual(["Juz 5"]);
    expect(labels(run(quranReferenceSource, "page ١٠٠"))).toEqual(["Page 100"]);
  });

  it("treats a bare Arabic-Indic number as ambiguous, like an ASCII one", () => {
    expect(labels(run(quranReferenceSource, "٥"))).toEqual(labels(run(quranReferenceSource, "5")));
  });

  it("accepts the Arabic keyword spellings", () => {
    expect(labels(run(quranReferenceSource, "سورة ١٨"))).toEqual(["18. Al-Kahf"]);
    expect(labels(run(quranReferenceSource, "جزء ٥"))).toEqual(["Juz 5"]);
    expect(labels(run(quranReferenceSource, "صفحة ١٠٠"))).toEqual(["Page 100"]);
  });

  it("strips an Arabic-Indic verse number when matching a surah name", () => {
    const entries = run(quranSurahsSource, "baqarah ٢٥٥");
    expect(entries[0]?.label).toBe("Al-Baqarah 2:255");
  });
});

describe("quran.text source gating", () => {
  it("sits out queries that are nothing but a coordinate", () => {
    for (const raw of ["2:255", "juz 5", "page 100", "surah 18", "112", "٢:٢٥٥"]) {
      expect(quranTextSource.enabled?.(query(raw)), raw).toBe(false);
    }
  });

  it("runs for real free text, with or without a keyword", () => {
    for (const raw of ["الرحمن", "kahf", "baqarah 255"]) {
      expect(quranTextSource.enabled?.(query(raw)), raw).toBe(true);
    }
  });

  it("stays out of queries too short to be meaningful", () => {
    expect(quranTextSource.enabled?.(query("ال"))).toBe(false);
    expect(quranTextSource.enabled?.(query(""))).toBe(false);
  });
});

describe("translation.text source", () => {
  const translationHit = (): TranslationSearchResponse => ({
    query: "mercy",
    sourceId: "ms.basmeih",
    total: 1,
    limit: 8,
    offset: 0,
    results: [
      {
        kind: "ayah",
        sourceId: "ms.basmeih",
        ayah: { key: "2:255", surah: 2, ayah: 255, globalIndex: 262, text: "full of mercy" },
        highlights: [{ start: 8, end: 14 }],
      },
    ],
    source: "worker",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hasTranslationMock.mockResolvedValue(true);
    ensureTranslationMock.mockResolvedValue(undefined);
    searchTranslationMock.mockResolvedValue(translationHit());
  });

  it("enables only for Latin free text of three or more letters with a scope", () => {
    expect(translationTextSource.enabled?.(query("mercy", TRANSLATED))).toBe(true);
    expect(translationTextSource.enabled?.(query("translation mercy", TRANSLATED))).toBe(true);
    expect(translationTextSource.enabled?.(query("me", TRANSLATED))).toBe(false);
    expect(translationTextSource.enabled?.(query("", TRANSLATED))).toBe(false);
    expect(translationTextSource.enabled?.(query("الرحمن", TRANSLATED))).toBe(false);
    expect(translationTextSource.enabled?.(query("mercy", ARABIC))).toBe(false);
  });

  it("strips the translation keyword before searching", async () => {
    await runAsync(translationTextSource, "translation mercy", TRANSLATED);
    expect(searchTranslationMock).toHaveBeenCalledWith(
      "ms.basmeih",
      "mercy",
      { limit: 8 },
      expect.any(Function),
    );
  });

  it("sits out queries that are nothing but a keyword or coordinate", () => {
    for (const raw of ["surah", "surah 2", "juz 5", "page 3", "translation"]) {
      expect(translationTextSource.enabled?.(query(raw, TRANSLATED)), raw).toBe(false);
    }
  });

  it("returns empty and only kicks a background download when the scope is not cached", async () => {
    hasTranslationMock.mockResolvedValue(false);
    const entries = await runAsync(translationTextSource, "mercy", TRANSLATED);
    expect(entries).toEqual([]);
    expect(ensureTranslationMock).toHaveBeenCalledTimes(1);
    expect(ensureTranslationMock).toHaveBeenCalledWith("ms.basmeih");
    expect(searchTranslationMock).not.toHaveBeenCalled();
  });

  it("answers from the cached translation with tayah identity and a ctx-correct href", async () => {
    const [entry] = await runAsync(translationTextSource, "mercy", TRANSLATED);
    expect(entry?.label).toBe("Al-Baqarah 2:255");
    expect(entry?.detail).toBe("Basmeih");
    expect(entry?.href).toBe("/app/al-baqarah/t/ms/basmeih/page/41#ayah-2-255");
    expect(entry?.dedupeKey).toBe("tayah:ms.basmeih:2:255");
    expect(entry?.groupId).toBe(PaletteGroups.TranslationText.id);
    expect(entry?.score).toBe(0.7);
    expect(entry?.preview).toEqual({
      text: "full of mercy",
      highlights: [{ start: 8, end: 14 }],
      dir: "ltr",
    });
  });

  it("opens fallback-scope hits in that translation's route", async () => {
    reader.markRead(2, 200, "en.sahih");
    try {
      const [entry] = await runAsync(translationTextSource, "mercy", ARABIC);
      expect(entry?.href).toBe("/app/al-baqarah/t/en/sahih/page/41#ayah-2-255");
      expect(entry?.dedupeKey).toBe("tayah:en.sahih:2:255");
    } finally {
      reader.clearReadingPosition();
    }
  });

  it("slots the translation group between Quran text and Surahs", () => {
    expect(PaletteGroups.TranslationText.order).toBeGreaterThan(PaletteGroups.QuranText.order);
    expect(PaletteGroups.TranslationText.order).toBeLessThan(PaletteGroups.Surahs.order);
    registerPaletteSource(quranTextSource);
    registerPaletteSource(translationTextSource);
    registerPaletteSource(quranSurahsSource);
    const order = paletteGroups().map((group) => group.id);
    expect(order.indexOf(PaletteGroups.TranslationText.id)).toBeGreaterThan(
      order.indexOf(PaletteGroups.QuranText.id),
    );
    expect(order.indexOf(PaletteGroups.TranslationText.id)).toBeLessThan(
      order.indexOf(PaletteGroups.Surahs.id),
    );
  });

  it("keeps the Arabic and translation hits on the same verse through cross-source dedupe", () => {
    const entry = (id: string, dedupeKey: string): PaletteEntry => ({
      id,
      sourceId: "x",
      groupId: PaletteGroups.JumpTo.id,
      label: id,
      icon: "book",
      score: 1,
      dedupeKey,
    });
    const deduped = dedupeEntries([
      entry("arabic", "ayah:2:255"),
      entry("translation", "tayah:en.sahih:2:255"),
    ]);
    expect(deduped).toHaveLength(2);
  });
});

describe("quran.ranges source", () => {
  it("offers a browsable list for a bare juz or page keyword", () => {
    expect(labels(run(quranRangesSource, "juz"))).toEqual([
      "Juz 1",
      "Juz 2",
      "Juz 3",
      "Juz 4",
      "Juz 5",
      "Juz 6",
    ]);
    expect(labels(run(quranRangesSource, "page"))[0]).toBe("Page 1");
  });

  it("steps aside once a number is typed", () => {
    expect(quranRangesSource.enabled?.(query("juz 5"))).toBe(false);
    expect(quranRangesSource.enabled?.(query("juz"))).toBe(true);
    expect(quranRangesSource.enabled?.(query("kahf"))).toBe(false);
  });

  it("keeps the active translation in range hrefs", () => {
    expect(hrefs(run(quranRangesSource, "juz", TRANSLATED))[0]).toBe("/app/t/ms/basmeih/juz/1");
    expect(hrefs(run(quranRangesSource, "page", TRANSLATED))[0]).toBe("/app/t/ms/basmeih/page/1");
  });
});

describe("surah and juz nicknames", () => {
  it("maps tabarak to both Al-Mulk and the Juz 29 ranges entry", () => {
    const surah = run(quranSurahsSource, "tabarak").find(
      (entry) => entry.label === "67. Al-Mulk",
    );
    expect(surah?.score).toBe(0.75);
    const [juz] = run(quranRangesSource, "tabarak");
    expect(juz?.label).toBe("Juz 29 (Tabarak)");
    expect(juz?.score).toBe(0.8);
    expect(juz?.dedupeKey).toBe("juz:29");
  });

  it("maps bare amma and juz amma to the Juz 30 nickname entry", () => {
    for (const raw of ["amma", "juz amma"]) {
      const [entry] = run(quranRangesSource, raw);
      expect(entry?.label, raw).toBe("Juz 30 (Amma)");
      expect(entry?.dedupeKey, raw).toBe("juz:30");
      expect(entry?.score, raw).toBe(0.8);
    }
  });

  it("still resolves juz 30 through the reference source and wins dedupe over the nickname", () => {
    expect(labels(run(quranReferenceSource, "juz 30"))).toEqual(["Juz 30"]);
    expect(quranRangesSource.enabled?.(query("juz 30"))).toBe(false);
    const merged = dedupeEntries([
      ...run(quranReferenceSource, "juz 30"),
      ...run(quranRangesSource, "amma"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceId).toBe(quranReferenceSource.id);
    expect(merged[0]?.label).toBe("Juz 30");
  });
});

describe("site.routes source", () => {
  it("matches site pages by label, href and keyword", () => {
    expect(hrefs(run(siteRoutesSource, "faq"))).toContain("/faq");
    expect(hrefs(run(siteRoutesSource, "privacy"))).toContain("/privacy");
    expect(hrefs(run(siteRoutesSource, "reader"))).toContain("/app");
  });

  it("lists routes unscored on an empty query", () => {
    const entries = run(siteRoutesSource, "");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.score === 0)).toBe(true);
  });
});

describe("settings.routes source", () => {
  it("matches the settings entry by keyword and links the canonical route", () => {
    for (const raw of ["settings", "storage", "theme", "privacy"]) {
      expect(hrefs(run(settingsRoutesSource, raw)), raw).toContain("/app/settings");
    }
  });

  it("offers the entry unscored on an empty query", () => {
    const entries = run(settingsRoutesSource, "");
    expect(labels(entries)).toContain("Settings");
    expect(entries.every((entry) => entry.score === 0)).toBe(true);
  });

  it("returns nothing when nothing matches", () => {
    expect(run(settingsRoutesSource, "zzzzqx")).toHaveLength(0);
  });

  it("stays registered in the built-in source list", () => {
    expect(BUILTIN_PALETTE_SOURCES).toContain(settingsRoutesSource);
  });
});

describe("registry", () => {
  const HADITH_GROUP = { id: "test-hadith", label: "Hadith", order: 50 };

  const bukhari: PaletteSource = {
    id: "test.hadith.bukhari",
    groups: [HADITH_GROUP],
    limit: 2,
    enabled: ({ parsed }) => parsed.keyword === "bukhari",
    entries: ({ parsed }) =>
      [1, 2, 3].map((n) => ({
        id: `test.hadith.bukhari:${n}`,
        sourceId: "test.hadith.bukhari",
        groupId: HADITH_GROUP.id,
        label: `Bukhari ${parsed.numbers[0] ?? n}`,
        icon: "book" as const,
        score: 1,
        href: "/about" as const,
      })),
  };

  beforeEach(() => {
    unregisterPaletteSource(bukhari.id);
  });

  it("accepts a new domain and slots its group between the built-in ones", () => {
    registerPaletteSource(quranSurahsSource);
    registerPaletteSource(siteRoutesSource);
    registerPaletteSource(bukhari);
    const order = paletteGroups().map((group) => group.id);
    expect(order.indexOf(HADITH_GROUP.id)).toBeGreaterThan(order.indexOf(PaletteGroups.Surahs.id));
    expect(order.indexOf(HADITH_GROUP.id)).toBeLessThan(order.indexOf(PaletteGroups.Site.id));
  });

  it("rejects a group re-registered with a conflicting order", () => {
    registerPaletteSource(bukhari);
    expect(() =>
      registerPaletteSource({ ...bukhari, groups: [{ ...HADITH_GROUP, order: 5 }] }),
    ).toThrow(/conflicting order/);
  });

  it("skips disabled sources and caps each source at its own limit", () => {
    registerPaletteSource(bukhari);
    expect(labels(collectSyncEntries(query("kahf"))).some((l) => l.startsWith("Bukhari"))).toBe(
      false,
    );
    const hits = collectSyncEntries(query("bukhari 12")).filter(
      (entry) => entry.sourceId === bukhari.id,
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]?.label).toBe("Bukhari 12");
  });

  it("keeps a failing source from sinking the rest of the results", () => {
    registerPaletteSource({
      ...bukhari,
      enabled: () => true,
      entries: () => {
        throw new Error("boom");
      },
    });
    expect(collectSyncEntries(query("kahf")).length).toBeGreaterThan(0);
  });

  it("drops a duplicate id even when the entries claim different targets", () => {
    const entry = (dedupeKey: string): PaletteEntry => ({
      id: "same-id",
      sourceId: "x",
      groupId: PaletteGroups.JumpTo.id,
      label: dedupeKey,
      icon: "book",
      score: 1,
      dedupeKey,
    });
    expect(dedupeEntries([entry("ayah:2:255"), entry("ayah:2:256")])).toHaveLength(1);
  });

  it("drops later entries that point where an earlier one already goes", () => {
    const entry = (id: string, dedupeKey: string): PaletteEntry => ({
      id,
      sourceId: "x",
      groupId: PaletteGroups.JumpTo.id,
      label: id,
      icon: "book",
      score: 1,
      dedupeKey,
    });
    const deduped = dedupeEntries([
      entry("reference", "ayah:2:255"),
      entry("text-hit", "ayah:2:255"),
      entry("other", "ayah:2:256"),
    ]);
    expect(deduped.map((e) => e.id)).toEqual(["reference", "other"]);
  });

  it("buckets entries into non-empty sections", () => {
    registerPaletteSource(quranSurahsSource);
    const entries = collectSyncEntries(query("2:255")).concat(collectSyncEntries(query("kahf")));
    const sections = sectionsFor(dedupeEntries(entries));
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((section) => section.entries.length > 0)).toBe(true);
  });

  it("lays sections out in their designed order when nothing is scored", () => {
    registerPaletteSource(quranSurahsSource);
    registerPaletteSource(siteRoutesSource);
    const sections = sectionsFor(dedupeEntries(collectSyncEntries(query(""))));
    const orders = sections.map((section) => section.group.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("floats the group holding the strongest match above weaker ones", () => {
    const section = (groupId: string, order: number, score: number): PaletteEntry => {
      registerPaletteSource({
        id: `test.${groupId}`,
        groups: [{ id: groupId, label: groupId, order }],
        entries: () => [],
      });
      return {
        id: `${groupId}:1`,
        sourceId: `test.${groupId}`,
        groupId,
        label: groupId,
        icon: "book",
        score,
      };
    };
    // "weak" sits earlier by design, but only matched fuzzily.
    const weak = section("test-weak", 30, 0.3);
    const strong = section("test-strong", 90, 1);
    const ids = sectionsFor([weak, strong]).map((s) => s.group.id);
    expect(ids).toEqual(["test-strong", "test-weak"]);
    unregisterPaletteSource("test.test-weak");
    unregisterPaletteSource("test.test-strong");
  });
});
