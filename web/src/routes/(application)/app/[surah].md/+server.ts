import { readerHrefFor } from "$lib/i18n/reader";
import { surahLocalPagePathFor, type SurahRouteContext } from "$lib/data/quran";
import { QURAN_DATA } from "$lib/server/quran-data";
import { readSurahLocalPageData } from "$lib/server/quran-surah-page";
import { requireSurah } from "$lib/server/reader-route-guards";
import { renderSurahPageMarkdown } from "$lib/server/reader-markdown";
import { error } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

export const prerender = true;

const ARABIC: SurahRouteContext = { kind: "arabic" };

export function entries() {
  return QURAN_DATA.surahs.map((s) => ({ surah: s.slug }));
}

export const GET: RequestHandler = ({ params }) => {
  const surah = requireSurah(params.surah);
  const pageData = readSurahLocalPageData(surah, 1);
  if (!pageData) throw error(404, `Unknown surah: ${params.surah}`);
  const body = renderSurahPageMarkdown(
    pageData,
    readerHrefFor("en", surahLocalPagePathFor(ARABIC, surah, 1)),
  );
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
