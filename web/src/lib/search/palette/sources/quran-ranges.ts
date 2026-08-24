import { JUZ_ALIASES, PAGE_ALIASES, QURAN_ALIASES } from "../aliases";
import { PaletteGroups } from "../groups";
import { hasKeyword, residualText } from "../query";
import { JUZ_COUNT, MUSHAF_PAGE_COUNT, juzHref, pageHref } from "../quran-nav";
import { juzKeywordFor } from "../surah-aliases";
import type { PaletteEntry, PaletteQuery, PaletteSource } from "../types";

const SOURCE_ID = "quran.ranges";

const NICKNAME_SCORE = 0.8;

function titleCaseAlias(alias: string): string {
  return alias
    .split(" ")
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function juzNicknameEntry(query: PaletteQuery, alias: string, juzNum: number): PaletteEntry {
  return {
    id: `${SOURCE_ID}:juz:nickname:${juzNum}`,
    sourceId: SOURCE_ID,
    groupId: PaletteGroups.Ranges.id,
    label: `Juz ${juzNum} (${titleCaseAlias(alias)})`,
    detail: "Juz",
    icon: "rows",
    score: NICKNAME_SCORE,
    href: juzHref(query.routeContext, juzNum),
    dedupeKey: `juz:${juzNum}`,
  };
}

/**
 * Browsable juz and page lists for a bare `juz` / `page` keyword with no number
 * yet — the palette should be explorable, not only answerable. Once a number is
 * typed, `quran.reference` takes over with the exact hit. A folded juz nickname
 * (`amma`, `tabarak`, `qad sama`…) prepends its juz ahead of everything else,
 * with or without a keyword.
 */
export const quranRangesSource: PaletteSource = {
  id: SOURCE_ID,
  groups: [PaletteGroups.Ranges],
  limit: 6,

  enabled: ({ parsed }) =>
    parsed.numbers.length === 0 &&
    (hasKeyword(parsed, JUZ_ALIASES) ||
      hasKeyword(parsed, PAGE_ALIASES) ||
      juzKeywordFor(residualText(parsed, QURAN_ALIASES)) !== null),

  entries(query) {
    const { parsed, limit } = query;
    const wantsJuz = hasKeyword(parsed, JUZ_ALIASES);
    const wantsPages = hasKeyword(parsed, PAGE_ALIASES);
    const entries: PaletteEntry[] = [];

    const nickname = juzKeywordFor(residualText(parsed, QURAN_ALIASES));
    if (nickname) {
      const [alias, juzNum] = nickname;
      entries.push(juzNicknameEntry(query, alias, juzNum));
    }

    if (wantsJuz || wantsPages) {
      const count = Math.max(
        1,
        wantsJuz ? Math.min(limit, JUZ_COUNT) : Math.min(limit, MUSHAF_PAGE_COUNT),
      );
      for (let n = 1; n <= count; n += 1) {
        entries.push(
          wantsJuz
            ? {
                id: `${SOURCE_ID}:juz:${n}`,
                sourceId: SOURCE_ID,
                groupId: PaletteGroups.Ranges.id,
                label: `Juz ${n}`,
                detail: "Juz",
                icon: "rows",
                score: 0.5,
                href: juzHref(query.routeContext, n),
                dedupeKey: `juz:${n}`,
              }
            : {
                id: `${SOURCE_ID}:page:${n}`,
                sourceId: SOURCE_ID,
                groupId: PaletteGroups.Ranges.id,
                label: `Page ${n}`,
                detail: "Mushaf page",
                icon: "rows",
                score: 0.5,
                href: pageHref(query.routeContext, n),
                dedupeKey: `page:${n}`,
              },
        );
      }
    }

    return entries;
  },
};
