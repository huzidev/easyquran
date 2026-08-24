import { SAJDA_ALIASES } from "../aliases";
import { PaletteGroups } from "../groups";
import { matchSajdas } from "$lib/search/nav/match";
import { hasKeyword } from "../query";
import { ayahHref, openVerse } from "../quran-nav";
import type { PaletteEntry, PaletteQuery, PaletteSource } from "../types";

const SOURCE_ID = "quran.sajdas";

function sajdaDetail(sajdaKind: "recommended" | "obligatory"): string {
  if (sajdaKind === "obligatory") return "Obligatory prostration";
  return "Recommended prostration";
}

/**
 * The fifteen prostration verses, gated behind the sajda keyword (`sajda`,
 * `سجدة`, `sujud`…). Bare keyword lists them all; `sajda 7` narrows to surah
 * 7's, `sajda 7:206` to the exact verse. Own group so the list never floods
 * "Juz & pages".
 */
export const quranSajdasSource: PaletteSource = {
  id: SOURCE_ID,
  groups: [PaletteGroups.Sajdas],
  limit: 15,

  enabled(query) {
    return hasKeyword(query.parsed, SAJDA_ALIASES);
  },

  entries(query: PaletteQuery): PaletteEntry[] {
    const matches = matchSajdas(query.quranData, query.parsed);
    const entries: PaletteEntry[] = [];
    for (const match of matches) {
      if (match.target.kind !== "sajda") continue;
      const surah = query.quranData.surahByNum(match.target.surah);
      const href = ayahHref(query.routeContext, query.quranData, match.target.surah, match.target.ayah);
      if (!surah || !href) continue;
      entries.push({
        id: `${SOURCE_ID}:${match.target.surah}:${match.target.ayah}`,
        sourceId: SOURCE_ID,
        groupId: PaletteGroups.Sajdas.id,
        label: `${surah.name} ${match.target.surah}:${match.target.ayah}`,
        detail: sajdaDetail(match.target.sajdaKind),
        arabic: surah.arabic,
        icon: "bookmark",
        score: match.score,
        href,
        run: openVerse(match.target.surah, match.target.ayah),
        dedupeKey: `sajda:${match.target.surah}:${match.target.ayah}`,
      });
    }
    return entries;
  },
};
