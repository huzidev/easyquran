import type { Pathname } from "$app/types";

import { PaletteGroups } from "../groups";
import { byScore, scoreFields } from "../scoring";
import type { PaletteEntry, PaletteSource } from "../types";

const SOURCE_ID = "search.routes";
const SEARCH_PATH = "/app/search";

function searchHref(): Pathname {
  // SAFETY: canonical search pathname (localized /{en,ar}/app/search is not
  // a published route); the palette's resolveHref applies the base, so the raw
  // path is what the cast brands it as.
  return SEARCH_PATH as Pathname;
}

/** Search page navigation. Labels stay English — see the palette-label precedent in site-routes.ts. */
export const searchRoutesSource: PaletteSource = {
  id: SOURCE_ID,
  groups: [PaletteGroups.AppPages],
  limit: 1,

  entries({ parsed }) {
    const label = "Search";
    const detail = "Full-text Arabic and translations";
    const score = parsed.isEmpty
      ? 0
      : scoreFields([label, "find", "translations", "lookup", "quran"], parsed.text);
    if (!parsed.isEmpty && score === 0) return [];

    const target = searchHref();
    const entries: PaletteEntry[] = [
      {
        id: `${SOURCE_ID}:search`,
        sourceId: SOURCE_ID,
        groupId: PaletteGroups.AppPages.id,
        label,
        detail,
        icon: "search",
        score,
        href: target,
        dedupeKey: `href:${target}`,
      },
    ];

    return byScore(entries);
  },
};
