import {
  OpenerKind,
  OpenerPackaging,
  QuranScript,
  type Ayah,
  type RangePageData,
  type SurahLocalPageData,
  type SurahNormalization,
} from "$lib/data/quran-types";
import { renderRangePageMarkdown, renderSurahPageMarkdown } from "$lib/server/reader-markdown";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$app/environment", () => ({ dev: false }));
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const UTHMANI: SurahNormalization = {
  surah: 1,
  sourceId: "uthmani",
  script: QuranScript.Uthmani,
  sourceProfile: "tanzil-quran-text-v1",
  packaging: OpenerPackaging.Absent,
  openerKind: OpenerKind.None,
  openerText: null,
  openerEndScalar: 0,
  bodyStartScalar: 0,
};

function ayah(surah: number, n: number, text: string): Ayah {
  return { key: `${surah}:${n}`, surah, ayah: n, globalIndex: n - 1, text };
}

const FATIHAH_PAGE: SurahLocalPageData = {
  surah: {
    num: 1,
    slug: "al-fatihah",
    name: "Al-Fatihah",
    arabic: "الفاتحة",
    place: "meccan",
    ayahCount: 7,
  },
  page: {
    surah: 1,
    localPage: 1,
    globalPage: 1,
    startGlobal: 0,
    endGlobal: 6,
    startAyah: 1,
    endAyah: 7,
    first: "1:1",
    last: "1:7",
  },
  pageCount: 1,
  ayahs: [
    ayah(1, 1, "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ"),
    ayah(1, 2, "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ"),
  ],
  normalization: UTHMANI,
};

describe("renderSurahPageMarkdown", () => {
  it("renders the exact heading, meta, and ayah line shape for Al-Fatihah", () => {
    const md = renderSurahPageMarkdown(FATIHAH_PAGE, "/en/app/al-fatihah");
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Al-Fatihah (1)");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("Meccan · 7 verses · page 1 of 1 · source: uthmani");
    expect(lines[3]).toBe("");
    expect(md).toContain("1. بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ");
    expect(md).toContain("2. ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ");
  });

  it("strips an embedded opener from ayah 1 and emits it as a blockquote, matching HTML bodyText", () => {
    const withOpener: SurahNormalization = {
      ...UTHMANI,
      surah: 2,
      packaging: OpenerPackaging.EmbeddedPrefix,
      openerKind: OpenerKind.Header,
      openerText: "BISMILLAH",
      openerEndScalar: 9,
      bodyStartScalar: 10,
    };
    const page: SurahLocalPageData = {
      surah: { ...FATIHAH_PAGE.surah, num: 2, slug: "al-baqarah", name: "Al-Baqarah" },
      page: { ...FATIHAH_PAGE.page, surah: 2 },
      pageCount: 2,
      ayahs: [ayah(2, 1, "BISMILLAH Alif Lam Meem")],
      normalization: withOpener,
    };
    const md = renderSurahPageMarkdown(page, "/en/app/al-baqarah");
    expect(md).toContain("> BISMILLAH");
    expect(md).toContain("1. Alif Lam Meem");
    expect(md).not.toContain("BISMILLAH Alif");
  });

  it("omits the opener on surah-local pages beyond the first, matching the HTML gate", () => {
    const withOpener: SurahNormalization = {
      ...UTHMANI,
      surah: 2,
      packaging: OpenerPackaging.EmbeddedPrefix,
      openerKind: OpenerKind.Header,
      openerText: "BISMILLAH",
      openerEndScalar: 9,
      bodyStartScalar: 10,
    };
    const page: SurahLocalPageData = {
      ...FATIHAH_PAGE,
      surah: { ...FATIHAH_PAGE.surah, num: 2, slug: "al-baqarah", name: "Al-Baqarah" },
      page: { ...FATIHAH_PAGE.page, surah: 2, localPage: 2, startAyah: 6, endAyah: 12 },
      pageCount: 2,
      ayahs: [ayah(2, 6, "sixth ayah text")],
      normalization: withOpener,
    };
    const md = renderSurahPageMarkdown(page, "/en/app/al-baqarah/page/2");
    expect(md).not.toContain("> BISMILLAH");
    expect(md).toContain("6. sixth ayah text");
  });

  it("carries the canonical HTML URL and Tanzil attribution in the footer", () => {
    const md = renderSurahPageMarkdown(FATIHAH_PAGE, "/en/app/al-fatihah");
    expect(md).toContain("HTML: https://easyquran.fyi/en/app/al-fatihah");
    expect(md).toContain("Source: Tanzil — https://tanzil.net");
    expect(md).not.toContain("Translation:");
  });

  it("attributes a translation by name, language, and source id", () => {
    const translation: SurahNormalization = {
      ...UTHMANI,
      sourceId: "en.sahih",
      script: QuranScript.Translation,
      sourceProfile: "wire-v1",
    };
    const page: SurahLocalPageData = {
      ...FATIHAH_PAGE,
      ayahs: [ayah(1, 1, "In the name of Allah, the Entirely Merciful.")],
      normalization: translation,
    };
    const md = renderSurahPageMarkdown(page, "/en/app/al-fatihah/t/en/sahih");
    expect(md).toContain("source: en.sahih");
    expect(md).toContain("1. In the name of Allah, the Entirely Merciful.");
    expect(md).toContain("Translation: Saheeh International (English) — en.sahih");
    expect(md).toContain("HTML: https://easyquran.fyi/en/app/al-fatihah/t/en/sahih");
  });

  it("marks a degraded translation page honestly", () => {
    const degraded: SurahNormalization = {
      ...UTHMANI,
      sourceId: "en.sahih",
      script: QuranScript.Translation,
      sourceProfile: "",
    };
    const md = renderSurahPageMarkdown(
      { ...FATIHAH_PAGE, ayahs: [], normalization: degraded },
      "/en/app/al-fatihah/t/en/sahih",
    );
    expect(md).toContain("(translation temporarily unavailable)");
  });
});

describe("renderRangePageMarkdown", () => {
  const SECOND_SURAH_NORMALIZATION: SurahNormalization = { ...UTHMANI, surah: 2 };

  const JUZ_RANGE: RangePageData = {
    kind: "juz",
    index: 1,
    label: "Juz 1",
    startGlobal: 0,
    endGlobal: 140,
    first: "1:1",
    last: "2:6",
    ayahs: [ayah(1, 1, "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ"), ayah(2, 1, "الم ذَٰلِكَ ٱلْكِتَـٰبُ")],
    normalizations: [UTHMANI, SECOND_SURAH_NORMALIZATION],
    surahs: [
      { num: 1, slug: "al-fatihah", name: "Al-Fatihah", arabic: "الفاتحة" },
      { num: 2, slug: "al-baqarah", name: "Al-Baqarah", arabic: "البقرة" },
    ],
  };

  it("groups a multi-surah juz under surah subheadings", () => {
    const md = renderRangePageMarkdown(JUZ_RANGE, "/en/app/juz/1");
    expect(md.split("\n")[0]).toBe("# Juz 1");
    expect(md).toContain("Juz 1 · verses 1:1 – 2:6 · source: uthmani");
    expect(md.indexOf("## Al-Fatihah (1)")).toBeGreaterThan(-1);
    expect(md.indexOf("## Al-Baqarah (2)")).toBeGreaterThan(md.indexOf("## Al-Fatihah (1)"));
    expect(md).toContain("HTML: https://easyquran.fyi/en/app/juz/1");
    expect(md).toContain("Source: Tanzil — https://tanzil.net");
  });

  it("titles a mushaf page by its index", () => {
    const md = renderRangePageMarkdown(
      { ...JUZ_RANGE, kind: "page", index: 42, label: "Page 42" },
      "/en/app/page/42",
    );
    expect(md.split("\n")[0]).toBe("# Page 42");
    expect(md).toContain("Page 42 · verses 1:1 – 2:6 · source: uthmani");
  });

  it("attributes a degraded translation range from its route source id, never as uthmani", () => {
    const degraded: RangePageData = { ...JUZ_RANGE, ayahs: [], normalizations: [] };
    const md = renderRangePageMarkdown(degraded, "/en/app/t/en/sahih/juz/1", "en.sahih");
    expect(md).toContain("source: en.sahih");
    expect(md).toContain("(translation temporarily unavailable)");
    expect(md).toContain("Translation: Saheeh International (English) — en.sahih");
    expect(md).not.toContain("source: uthmani");
  });

  it("keeps the uthmani default for Arabic ranges with no explicit fallback", () => {
    const md = renderRangePageMarkdown(
      { ...JUZ_RANGE, ayahs: [], normalizations: [] },
      "/en/app/juz/1",
    );
    expect(md).toContain("source: uthmani");
  });
});
