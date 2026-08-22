import type { SurahRouteData } from "$lib/data/quran-types";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$app/environment", () => ({ dev: false }));
vi.mock("$env/dynamic/public", () => ({ env: {} }));

import { GET as translationSurahMd } from "../[surah]/t/[lang]/[translator].md/+server";
import { GET as surahMd, entries as surahEntries } from "../[surah].md/+server";
import { GET as localPageMd } from "../[surah]/page/[localPage].md/+server";
import { GET as juzMd } from "../juz/[n].md/+server";
import { GET as pageMd } from "../page/[n].md/+server";

vi.mock("$lib/server/quran-translation-page", () => ({
  loadTranslationSurahRouteData: vi.fn(),
}));

import { loadTranslationSurahRouteData } from "$lib/server/quran-translation-page";

const loadTranslationSurahRoute = vi.mocked(loadTranslationSurahRouteData);

function mdEvent(params: Record<string, string>): never {
  // SAFETY: every reader md GET handler reads only `params` (plus `fetch` on the
  // translation family, which the loader mock bypasses); this inert double is
  // asserted to `never` so it is assignable to each handler's RequestEvent type.
  return { params, fetch: vi.fn(async () => new Response("{}")) } as never;
}

const TRANSLATION_PAGE: SurahRouteData = {
  pageData: {
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
      {
        key: "1:1",
        surah: 1,
        ayah: 1,
        globalIndex: 0,
        text: "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
      },
    ],
    normalization: {
      surah: 1,
      sourceId: "en.sahih",
      script: "translation",
      sourceProfile: "wire-v1",
      packaging: "absent",
      openerKind: "none",
      openerText: null,
      openerEndScalar: 0,
      bodyStartScalar: 0,
    },
  },
  previousPage: null,
  nextPage: null,
  previousSurah: null,
  nextSurah: { num: 2, slug: "al-baqarah", name: "Al-Baqarah", arabic: "البقرة" },
  readingPreviousHref: null,
  readingNextHref: "/app/al-baqarah/t/en/sahih",
};

describe("prerendered Arabic reader md routes", () => {
  it("enumerates every surah slug", async () => {
    const entries = await Promise.resolve(surahEntries());
    expect(entries).toHaveLength(114);
    expect(entries.at(0)).toEqual({ surah: "al-fatihah" });
  });

  it("renders Al-Fatihah from the real Uthmani DB", async () => {
    const response = await surahMd(mdEvent({ surah: "al-fatihah" }));
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body.startsWith("# Al-Fatihah (1)\n")).toBe(true);
    expect(body).toContain("Meccan · 7 verses · page 1 of 1 · source: uthmani");
    expect(body).toContain("HTML: https://easyquran.fyi/en/app/al-fatihah");
    expect(body).toContain("Source: Tanzil — https://tanzil.net");
  });

  it("404s an unknown surah slug", async () => {
    await expect(async () => surahMd(mdEvent({ surah: "not-a-surah" }))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("renders a multi-surah juz with surah subheadings", async () => {
    const response = await juzMd(mdEvent({ n: "1" }));
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body.startsWith("# Juz 1\n")).toBe(true);
    expect(body).toContain("## ");
  });

  it("404s an out-of-range juz index", async () => {
    await expect(async () => juzMd(mdEvent({ n: "31" }))).rejects.toMatchObject({ status: 404 });
  });

  it("renders a mushaf page by index", async () => {
    const response = await pageMd(mdEvent({ n: "42" }));
    const body = await response.text();
    expect(body.startsWith("# Page 42\n")).toBe(true);
  });

  it("redirects the noncanonical local page 1 spelling", async () => {
    await expect(
      async () => localPageMd(mdEvent({ surah: "al-baqarah", localPage: "1" })),
    ).rejects.toMatchObject({ status: 308 });
  });
});

describe("SSR translation md route", () => {
  it("renders translated ayahs with translation attribution", async () => {
    loadTranslationSurahRoute.mockResolvedValueOnce(TRANSLATION_PAGE);
    const response = await translationSurahMd(
      mdEvent({ surah: "al-fatihah", lang: "en", translator: "sahih" }),
    );
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("# Al-Fatihah (1)");
    expect(body).toContain("1. In the name of Allah, the Entirely Merciful");
    expect(body).toContain("Translation: Saheeh International (English) — en.sahih");
    expect(body).toContain("HTML: https://easyquran.fyi/en/app/al-fatihah/t/en/sahih");
  });

  it("404s an unknown surah slug without loading a translation", async () => {
    loadTranslationSurahRoute.mockClear();
    await expect(
      async () => translationSurahMd(mdEvent({ surah: "not-a-surah", lang: "en", translator: "sahih" })),
    ).rejects.toMatchObject({ status: 404 });
    expect(loadTranslationSurahRoute).not.toHaveBeenCalled();
  });
});
