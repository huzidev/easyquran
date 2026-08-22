import { readerHrefFor } from "$lib/i18n/reader";
import { translationGlobalPagePath, translationIdFromSegments } from "$lib/data/quran";
import { loadTranslationRangeData } from "$lib/server/quran-translation-page";
import { requireRangeIndex } from "$lib/server/reader-route-guards";
import { renderRangePageMarkdown } from "$lib/server/reader-markdown";

import type { RequestHandler } from "./$types";

export const prerender = false;

export const GET: RequestHandler = async ({ params, fetch }) => {
  const index = requireRangeIndex("page", params.n);
  const data = await loadTranslationRangeData("page", index, params.lang, params.translator, fetch);
  const canonical = translationGlobalPagePath(params.lang, params.translator, index);
  const body = renderRangePageMarkdown(
    data,
    readerHrefFor("en", canonical),
    translationIdFromSegments(params.lang, params.translator),
  );
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
