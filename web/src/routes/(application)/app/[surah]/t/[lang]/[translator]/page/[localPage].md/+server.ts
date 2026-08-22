import { readerHrefFor } from "$lib/i18n/reader";
import { translationSurahPath } from "$lib/data/quran";
import { loadTranslationSurahRouteData } from "$lib/server/quran-translation-page";
import {
  requireLocalPageBeyondFirst,
  requireSurah,
} from "$lib/server/reader-route-guards";
import { renderSurahPageMarkdown } from "$lib/server/reader-markdown";
import { error } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

export const prerender = false;

export const GET: RequestHandler = async ({ params, fetch }) => {
  const surah = requireSurah(params.surah);
  const localPage = requireLocalPageBeyondFirst(
    params.localPage,
    translationSurahPath(surah.slug, params.lang, params.translator, 1),
  );
  const data = await loadTranslationSurahRouteData(
    surah,
    localPage,
    params.lang,
    params.translator,
    fetch,
  );
  if (!data) throw error(404, `Unknown Surah page: ${params.localPage}`);
  const canonical = translationSurahPath(surah.slug, params.lang, params.translator, localPage);
  const body = renderSurahPageMarkdown(data.pageData, readerHrefFor("en", canonical));
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
