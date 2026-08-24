import type { CanonicalQuranRow } from "$lib/quran/sql";
import {
  buildTranslationSearchCorpus,
  searchTranslationCorpus,
  type TranslationSearchOpts,
  type TranslationSearchUnit,
} from "$lib/quran/search/translation-corpus";
import { describe, expect, it } from "vite-plus/test";

function row(globalIndex: number, text: string, surah = 1, ayah = globalIndex): CanonicalQuranRow {
  return { globalIndex, surah, ayah, text };
}

function optsFor(rows: readonly CanonicalQuranRow[], sourceId = "en.sahih"): TranslationSearchOpts {
  const texts = new Map(rows.map((r) => [r.globalIndex, r.text]));
  return { sourceId, textFor: (globalIndex) => texts.get(globalIndex) ?? "" };
}

const CORPUS_ROWS: readonly CanonicalQuranRow[] = [
  row(1, "In the name of Allah, full of Mercy."),
  row(2, "Give thanks — mercy and mercy for all people."),
  row(3, "An entirely different verse."),
  row(4, "The mercy of the Lord endures forever."),
];

describe("buildTranslationSearchCorpus", () => {
  it("normalizes row text into match surfaces", () => {
    const units = buildTranslationSearchCorpus(CORPUS_ROWS);
    expect(units.map((unit) => unit.norm)).toEqual([
      "in the name of allah, full of mercy.",
      "give thanks - mercy and mercy for all people.",
      "an entirely different verse.",
      "the mercy of the lord endures forever.",
    ]);
    expect(units[1]!.starts.length).toBe(units[1]!.norm.length);
  });

  it("throws on a gap in globalIndex", () => {
    expect(() =>
      buildTranslationSearchCorpus([row(1, "a verse"), row(2, "another"), row(4, "gapped")]),
    ).toThrow(/contiguous globalIndex 3/);
  });

  it("throws when globalIndex does not start at 1", () => {
    expect(() => buildTranslationSearchCorpus([row(2, "starts late")])).toThrow(
      /contiguous globalIndex 1/,
    );
  });

  it("throws on a duplicate globalIndex", () => {
    expect(() => buildTranslationSearchCorpus([row(1, "first"), row(1, "dupe")])).toThrow(
      /contiguous globalIndex 2/,
    );
  });
});

describe("searchTranslationCorpus", () => {
  const units = buildTranslationSearchCorpus(CORPUS_ROWS);

  it("matches case-folded substrings in globalIndex order", () => {
    const { total, results } = searchTranslationCorpus(units, "MERCY", optsFor(CORPUS_ROWS));
    expect(total).toBe(3);
    expect(results.map((hit) => hit.ayah.globalIndex)).toEqual([1, 2, 4]);
    expect(results.map((hit) => hit.ayah.key)).toEqual(["1:1", "1:2", "1:4"]);
  });

  it("matches multi-word phrase queries as contiguous substrings", () => {
    const phrase = searchTranslationCorpus(units, "in the name", optsFor(CORPUS_ROWS));
    expect(phrase.results.map((hit) => hit.ayah.globalIndex)).toEqual([1]);

    const nonContiguous = searchTranslationCorpus(units, "name allah", optsFor(CORPUS_ROWS));
    expect(nonContiguous.total).toBe(0);
  });

  it("folds the query the same way as the corpus", () => {
    const curly = searchTranslationCorpus(units, "thanks — mercy", optsFor(CORPUS_ROWS));
    expect(curly.results.map((hit) => hit.ayah.globalIndex)).toEqual([2]);

    const collapsed = searchTranslationCorpus(units, "of   allah", optsFor(CORPUS_ROWS));
    expect(collapsed.results.map((hit) => hit.ayah.globalIndex)).toEqual([1]);
  });

  it("emits one highlight span per occurrence", () => {
    const { results } = searchTranslationCorpus(units, "mercy", optsFor(CORPUS_ROWS));
    const doubled = results.find((hit) => hit.ayah.globalIndex === 2)!;
    expect(doubled.highlights).toHaveLength(2);
    for (const span of doubled.highlights) {
      expect(doubled.ayah.text.slice(span.start, span.end)).toBe("mercy");
    }
  });

  it("stamps provenance on every hit", () => {
    const { results } = searchTranslationCorpus(units, "mercy", optsFor(CORPUS_ROWS, "en.pickthall"));
    for (const hit of results) {
      expect(hit.kind).toBe("ayah");
      expect(hit.sourceId).toBe("en.pickthall");
      expect(hit.ayah.text).toBe(CORPUS_ROWS[hit.ayah.globalIndex - 1]!.text);
    }
  });

  it("clamps limit and offset to the shared bounds", () => {
    const clampedLimit = searchTranslationCorpus(units, "mercy", {
      ...optsFor(CORPUS_ROWS),
      limit: 999,
    });
    expect(clampedLimit.limit).toBe(50);
    expect(clampedLimit.results).toHaveLength(3);

    const clampedOffset = searchTranslationCorpus(units, "mercy", {
      ...optsFor(CORPUS_ROWS),
      offset: 999,
    });
    expect(clampedOffset.offset).toBe(500);
    expect(clampedOffset.total).toBe(3);
    expect(clampedOffset.results).toHaveLength(0);
  });

  it("slices the mushaf-ordered matches at limit and offset", () => {
    const page = searchTranslationCorpus(units, "mercy", { ...optsFor(CORPUS_ROWS), limit: 2 });
    expect(page.total).toBe(3);
    expect(page.results.map((hit) => hit.ayah.globalIndex)).toEqual([1, 2]);

    const next = searchTranslationCorpus(units, "mercy", {
      ...optsFor(CORPUS_ROWS),
      limit: 2,
      offset: 2,
    });
    expect(next.results.map((hit) => hit.ayah.globalIndex)).toEqual([4]);
  });

  it("returns empty for ineligible queries", () => {
    expect(searchTranslationCorpus(units, "me", optsFor(CORPUS_ROWS)).total).toBe(0);
    expect(searchTranslationCorpus(units, "a".repeat(65), optsFor(CORPUS_ROWS)).total).toBe(0);
  });
});

describe("corpus memory budget (spec 4.4)", () => {
  const UNIT_COUNT = 6236;
  const MB = 1024 * 1024;

  function syntheticRows(charsPerRow: number, seed: string): CanonicalQuranRow[] {
    const filler = seed.repeat(Math.ceil(charsPerRow / seed.length)).slice(0, charsPerRow);
    const rows: CanonicalQuranRow[] = [];
    for (let i = 1; i <= UNIT_COUNT; i++) rows.push(row(i, filler));
    return rows;
  }

  function payloadBytes(corpus: readonly TranslationSearchUnit[]): number {
    let bytes = 0;
    for (const unit of corpus) {
      bytes += unit.norm.length * 2 + unit.starts.byteLength + unit.ends.byteLength + 128;
    }
    return bytes;
  }

  it("stores packed uint16 offset maps", () => {
    const corpus = buildTranslationSearchCorpus(syntheticRows(24, "mercy and grace "));
    expect(corpus[0]!.starts).toBeInstanceOf(Uint16Array);
    expect(corpus[0]!.ends).toBeInstanceOf(Uint16Array);
    for (const unit of corpus) {
      expect(unit.starts.byteLength).toBe(unit.starts.length * 2);
      expect(unit.ends.byteLength).toBe(unit.ends.length * 2);
    }
  });

  it("keeps a median-size translation (1.25M chars) under 9 MB", () => {
    const corpus = buildTranslationSearchCorpus(
      syntheticRows(200, "misericordia et mercy ratione "),
    );
    expect(payloadBytes(corpus)).toBeLessThan(9 * MB);
  }, 60_000);

  it("keeps the max-size translation shape (6.2M Cyrillic chars) under 42 MB", () => {
    const corpus = buildTranslationSearchCorpus(
      syntheticRows(995, "милосердие и милость господа "),
    );
    expect(payloadBytes(corpus)).toBeLessThan(42 * MB);
  }, 120_000);
});
