import { SITE } from "$lib/config/site";
import { surahMeta, QuranScript } from "$lib/data/quran";
import type {
  RangePageData,
  SurahLocalPageData,
  SurahLink,
  SurahNormalization,
} from "$lib/data/quran-types";
import { TRANSLATION_BY_ID } from "$lib/data/translations";
import { groupRangeAyahs, headerText } from "$lib/quran/view/presentation";
import { bodyText } from "$lib/quran/view/source-view";

function attributionLines(sourceId: string): string[] {
  const lines = [`Source: Tanzil — ${SITE.tanzilUrl}`];
  if (sourceId !== "uthmani") {
    const metadata = TRANSLATION_BY_ID.get(sourceId);
    if (metadata) lines.unshift(`Translation: ${metadata.name} (${metadata.language}) — ${sourceId}`);
  }
  return lines;
}

function footer(canonicalPublicPath: string, sourceId: string): string[] {
  return ["---", "", `HTML: ${SITE.url}${canonicalPublicPath}`, ...attributionLines(sourceId)];
}

function pendingTranslation(normalization: SurahNormalization): boolean {
  return normalization.script === QuranScript.Translation && normalization.sourceProfile === "";
}

export function renderSurahPageMarkdown(
  pageData: SurahLocalPageData,
  canonicalPublicPath: string,
): string {
  const { surah, page, pageCount, ayahs, normalization } = pageData;
  const lines: string[] = [
    `# ${surah.name} (${surah.num})`,
    "",
    `${surahMeta(surah)} · page ${page.localPage} of ${pageCount} · source: ${normalization.sourceId}`,
    "",
  ];
  const opener = headerText(normalization);
  if (opener && page.startAyah === 1) lines.push(`> ${opener}`, "");
  if (pendingTranslation(normalization)) {
    lines.push("(translation temporarily unavailable)", "");
  }
  for (const ayah of ayahs) {
    lines.push(`${ayah.ayah}. ${bodyText(ayah.text, ayah.ayah, normalization)}`);
  }
  if (ayahs.length > 0) lines.push("");
  lines.push(...footer(canonicalPublicPath, normalization.sourceId));
  return `${lines.join("\n")}\n`;
}

export function renderRangePageMarkdown(
  range: RangePageData,
  canonicalPublicPath: string,
  fallbackSourceId?: string,
): string {
  const sourceId = range.normalizations[0]?.sourceId ?? fallbackSourceId ?? "uthmani";
  const lines: string[] = [
    `# ${range.kind === "juz" ? "Juz" : "Page"} ${range.index}`,
    "",
    `${range.label} · verses ${range.first} – ${range.last} · source: ${sourceId}`,
    "",
  ];
  const surahByNum = new Map<number, SurahLink>(range.surahs.map((surah) => [surah.num, surah]));
  const sourceProfilePending = range.normalizations.length === 0 || pendingTranslation(
    range.normalizations[0]!,
  );
  if (range.ayahs.length === 0) {
    lines.push(sourceProfilePending ? "(translation temporarily unavailable)" : "(no verses)", "");
  }
  for (const group of groupRangeAyahs(range.ayahs, range.normalizations)) {
    const surah = surahByNum.get(group.surah);
    const heading = surah ? `${surah.name} (${surah.num})` : `Surah ${group.surah}`;
    lines.push(`## ${heading}`, "");
    if (group.opener) lines.push(`> ${group.opener}`, "");
    for (const ayah of group.ayahs) {
      lines.push(`${ayah.ayah}. ${bodyText(ayah.text, ayah.ayah, group.normalization)}`);
    }
    lines.push("");
  }
  lines.push(...footer(canonicalPublicPath, sourceId));
  return `${lines.join("\n")}\n`;
}
