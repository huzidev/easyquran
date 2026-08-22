import { readerHrefFor } from "$lib/i18n/reader";
import { surahLocalPagePathFor, type SurahRouteContext } from "$lib/data/quran";
import { QURAN_DATA } from "$lib/server/quran-data";
import { readSurahLocalPageData } from "$lib/server/quran-surah-page";
import {
  requireLocalPageBeyondFirst,
  requireSurah,
} from "$lib/server/reader-route-guards";
import { renderSurahPageMarkdown } from "$lib/server/reader-markdown";
import { error } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

export const prerender = true;

const ARABIC: SurahRouteContext = { kind: "arabic" };

export function entries() {
  return QURAN_DATA.surahs.flatMap((surah) =>
    Array.from({ length: QURAN_DATA.surahLocalPageCount(surah.num) - 1 }, (_, index) => ({
      surah: surah.slug,
      localPage: String(index + 2),
    })),
  );
}

export const GET: RequestHandler = ({ params }) => {
  const surah = requireSurah(params.surah);
  const localPage = requireLocalPageBeyondFirst(
    params.localPage,
    surahLocalPagePathFor(ARABIC, surah, 1),
  );
  const pageData = readSurahLocalPageData(surah, localPage);
  if (!pageData) throw error(404, `Unknown Surah page: ${params.localPage}`);
  const body = renderSurahPageMarkdown(
    pageData,
    readerHrefFor("en", surahLocalPagePathFor(ARABIC, surah, localPage)),
  );
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
