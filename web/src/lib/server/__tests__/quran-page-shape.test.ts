import type { CatalogEntry, SurahRouteContext } from "$lib/data/quran-types";
import { QURAN_DATA } from "$lib/server/quran-data";
import { surahRouteNav } from "$lib/server/quran-page-shape";
import { describe, expect, it } from "vite-plus/test";

const ARABIC_CTX: SurahRouteContext = { kind: "arabic" };
const TRANSLATION_CTX: SurahRouteContext = {
  kind: "translation",
  lang: "en",
  translator: "sahih",
};

function surahAt(num: number): CatalogEntry {
  const entry = QURAN_DATA.surahByNum(num);
  if (!entry) throw new Error(`missing surah ${num}`);
  return entry;
}

function lastLocalPageHref(num: number): string {
  const count = QURAN_DATA.surahLocalPageCount(num);
  const { slug } = surahAt(num);
  return count > 1 ? `/app/${slug}/page/${count}` : `/app/${slug}`;
}

describe("surahRouteNav reading-order crawl hrefs", () => {
  it("mushaf start has no previous and links forward to the Surah 2 root", () => {
    const nav = surahRouteNav(ARABIC_CTX, surahAt(1), 1, QURAN_DATA.surahLocalPageCount(1));
    expect(nav.readingPreviousHref).toBeNull();
    expect(nav.readingNextHref).toBe("/app/al-baqarah");
  });

  it("page 1 of Surah 2 links back to the last local page of Surah 1", () => {
    const nav = surahRouteNav(ARABIC_CTX, surahAt(2), 1, QURAN_DATA.surahLocalPageCount(2));
    expect(nav.readingPreviousHref).toBe(lastLocalPageHref(1));
  });

  it("mid-surah mid-page links to the adjacent /page/N hrefs", () => {
    const nav = surahRouteNav(ARABIC_CTX, surahAt(2), 3, QURAN_DATA.surahLocalPageCount(2));
    expect(nav.readingPreviousHref).toBe("/app/al-baqarah/page/2");
    expect(nav.readingNextHref).toBe("/app/al-baqarah/page/4");
  });

  it("last page of a multi-page surah links to the next surah root", () => {
    const count = QURAN_DATA.surahLocalPageCount(2);
    const nav = surahRouteNav(ARABIC_CTX, surahAt(2), count, count);
    expect(nav.readingPreviousHref).toBe(`/app/al-baqarah/page/${count - 1}`);
    expect(nav.readingNextHref).toBe("/app/aal-i-imran");
  });

  it("mushaf end has no next and a previous within Surah 114 or from Surah 113", () => {
    const count = QURAN_DATA.surahLocalPageCount(114);
    const nav = surahRouteNav(ARABIC_CTX, surahAt(114), count, count);
    expect(nav.readingNextHref).toBeNull();
    if (count > 1) {
      expect(nav.readingPreviousHref).toBe(`/app/an-nas/page/${count - 1}`);
    } else {
      expect(nav.readingPreviousHref).toBe(lastLocalPageHref(113));
    }
  });

  it("translation ctx hrefs carry the /t/en/sahih segments", () => {
    const first = surahRouteNav(TRANSLATION_CTX, surahAt(1), 1, QURAN_DATA.surahLocalPageCount(1));
    expect(first.readingPreviousHref).toBeNull();
    expect(first.readingNextHref).toBe("/app/al-baqarah/t/en/sahih");
    const mid = surahRouteNav(TRANSLATION_CTX, surahAt(2), 3, QURAN_DATA.surahLocalPageCount(2));
    expect(mid.readingPreviousHref).toBe("/app/al-baqarah/t/en/sahih/page/2");
    expect(mid.readingNextHref).toBe("/app/al-baqarah/t/en/sahih/page/4");
  });

  it("keeps the within-surah and cross-surah nav fields unchanged", () => {
    const nav = surahRouteNav(ARABIC_CTX, surahAt(2), 2, QURAN_DATA.surahLocalPageCount(2));
    expect(nav.previousPage).toEqual({ localPage: 1, href: "/app/al-baqarah" });
    expect(nav.nextPage).toEqual({ localPage: 3, href: "/app/al-baqarah/page/3" });
    expect(nav.previousSurah).toMatchObject({ num: 1, slug: "al-fatihah" });
    expect(nav.nextSurah).toMatchObject({ num: 3, slug: "aal-i-imran" });
  });
});
