import { uniq } from "es-toolkit";
import { TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";

export interface SearchUrlState {
  q: string;
  t: string[];
}

function searchableTranslationIds(rawIds: readonly string[]): string[] {
  return uniq(
    rawIds
      .map((id) => id.trim())
      .filter((id) => TRANSLATION_CATALOGUE_BY_ID.get(id)?.direction === "ltr"),
  );
}

/**
 * Reads the shareable search state from a URL. `q` is trimmed as typed; `t` is a
 * comma-split translation list filtered to known, LTR catalogue entries — deep
 * links with stale, RTL or junk ids degrade to the ids that remain.
 */
export function parseSearchUrl(url: { search: string } | URL): SearchUrlState {
  const params = new URLSearchParams(url.search);
  return {
    q: (params.get("q") ?? "").trim(),
    t: searchableTranslationIds((params.get("t") ?? "").split(",")),
  };
}

/**
 * Serializes search state to a query string with empty parts omitted: both empty
 * yields "", so the page can `replaceState` without leaving a bare `?` behind.
 */
export function serializeSearchState(q: string, ids: readonly string[]): string {
  const parts: string[] = [];
  const query = q.trim();
  if (query) parts.push(`q=${encodeURIComponent(query)}`);
  const t = ids.filter((id) => id.length > 0).join(",");
  if (t) parts.push(`t=${encodeURIComponent(t)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
