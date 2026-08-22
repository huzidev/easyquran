import { translationIdFromSegments } from "$lib/data/quran";
import { RangeKind } from "$lib/data/quran-data";
import { TRANSLATION_BY_ID, type BakedTranslationMetadata } from "$lib/data/translations";
import { isUiLocale, type UiDirection, type UiLocale } from "$lib/i18n/locales";
import { QURAN_DATA } from "$lib/server/quran-data";

interface ReaderIndexRoute {
  readonly type: "index";
  readonly page: "home" | "juz";
}

interface ArabicReaderRoute {
  readonly type: "arabic";
  readonly cacheKind: "surah" | "page" | "juz";
  readonly index: number;
  readonly localPage?: number;
}

interface TranslationReaderRoute {
  readonly type: "translation";
  readonly sourceId: string;
  readonly contentLanguage: string;
  readonly contentDirection: UiDirection;
  readonly cacheKind: "surah" | "page" | "juz";
  readonly index: number;
  readonly localPage?: number;
}

export type ParsedReaderRoute = ReaderIndexRoute | ArabicReaderRoute | TranslationReaderRoute;

const SURAH_SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CONTENT_LANGUAGE_SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TRANSLATOR_SEGMENT = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;

export function localizedReaderLocale(pathname: string): UiLocale | null {
  const match = /^\/(en|ar)\/app(?:\/|$)/u.exec(pathname);
  return match && isUiLocale(match[1]) ? match[1] : null;
}

function positiveInteger(value: string): number | null {
  if (!POSITIVE_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function translation(
  lang: string,
  translator: string,
): { sourceId: string; metadata: BakedTranslationMetadata } | null {
  if (!CONTENT_LANGUAGE_SEGMENT.test(lang) || !TRANSLATOR_SEGMENT.test(translator)) return null;
  const sourceId = translationIdFromSegments(lang, translator);
  const metadata = TRANSLATION_BY_ID.get(sourceId);
  return metadata ? { sourceId, metadata } : null;
}

function surahRoute(slug: string, localPage: number): ArabicReaderRoute | null {
  const surah = QURAN_DATA.surahBySlug(slug);
  if (!surah || !QURAN_DATA.surahLocalPage(surah.num, localPage)) return null;
  if (localPage > 1) {
    return { type: "arabic", cacheKind: "surah", index: surah.num, localPage };
  }
  return {
    type: "arabic",
    cacheKind: "surah",
    index: surah.num,
  };
}

function translationSurahRoute(
  slug: string,
  lang: string,
  translator: string,
  localPage: number,
): TranslationReaderRoute | null {
  const surah = QURAN_DATA.surahBySlug(slug);
  const source = translation(lang, translator);
  if (!surah || !source || !QURAN_DATA.surahLocalPage(surah.num, localPage)) return null;
  if (localPage > 1) {
    return {
      type: "translation",
      sourceId: source.sourceId,
      contentLanguage: source.metadata.languageCode,
      contentDirection: source.metadata.direction,
      cacheKind: "surah",
      index: surah.num,
      localPage,
    };
  }
  return {
    type: "translation",
    sourceId: source.sourceId,
    contentLanguage: source.metadata.languageCode,
    contentDirection: source.metadata.direction,
    cacheKind: "surah",
    index: surah.num,
  };
}

function rangeRoute(kind: "page" | "juz", value: string): ArabicReaderRoute | null {
  const index = positiveInteger(value);
  const rangeKind = kind === "juz" ? RangeKind.Juz : RangeKind.Page;
  if (index === null || !QURAN_DATA.rangeByIndex(rangeKind, index)) return null;
  return { type: "arabic", cacheKind: kind, index };
}

function rangeKindFromSegment(segment: string): "page" | "juz" | null {
  if (segment === "page") return "page";
  if (segment === "juz") return "juz";
  return null;
}

function translationRangeRoute(
  lang: string,
  translator: string,
  kind: "page" | "juz",
  value: string,
): TranslationReaderRoute | null {
  const source = translation(lang, translator);
  const index = positiveInteger(value);
  const rangeKind = kind === "juz" ? RangeKind.Juz : RangeKind.Page;
  if (!source || index === null || !QURAN_DATA.rangeByIndex(rangeKind, index)) return null;
  return {
    type: "translation",
    sourceId: source.sourceId,
    contentLanguage: source.metadata.languageCode,
    contentDirection: source.metadata.direction,
    cacheKind: kind,
    index,
  };
}

/** Parse one canonical, de-localized reader pathname. No query or fragment accepted. */
export function parseReaderPath(pathname: string): ParsedReaderRoute | null {
  if (pathname.length > 256 || pathname.includes("%") || pathname.includes("//")) return null;
  if (pathname === "/app") return { type: "index", page: "home" };
  if (pathname === "/app/juz") return { type: "index", page: "juz" };

  let match = /^\/app\/([^/]+)\/t\/([^/]+)\/([^/]+)\/page\/([^/]+)$/u.exec(pathname);
  if (match) {
    const localPage = positiveInteger(match[4]!);
    return localPage === null || localPage === 1
      ? null
      : translationSurahRoute(match[1]!, match[2]!, match[3]!, localPage);
  }

  match = /^\/app\/([^/]+)\/t\/([^/]+)\/([^/]+)$/u.exec(pathname);
  if (match) return translationSurahRoute(match[1]!, match[2]!, match[3]!, 1);

  match = /^\/app\/t\/([^/]+)\/([^/]+)\/(page|juz)\/([^/]+)$/u.exec(pathname);
  if (match) {
    const kind = rangeKindFromSegment(match[3]!);
    if (!kind) return null;
    return translationRangeRoute(match[1]!, match[2]!, kind, match[4]!);
  }

  match = /^\/app\/([^/]+)\/page\/([^/]+)$/u.exec(pathname);
  if (match) {
    const localPage = positiveInteger(match[2]!);
    return localPage === null || localPage === 1 ? null : surahRoute(match[1]!, localPage);
  }

  match = /^\/app\/(page|juz)\/([^/]+)$/u.exec(pathname);
  if (match) {
    const kind = rangeKindFromSegment(match[1]!);
    return kind ? rangeRoute(kind, match[2]!) : null;
  }

  match = /^\/app\/([^/]+)$/u.exec(pathname);
  return match ? surahRoute(match[1]!, 1) : null;
}

function requiredParam(
  params: Record<string, string | undefined>,
  name: string,
  pattern: RegExp,
): string | null {
  const value = params[name];
  return value && pattern.test(value) ? value : null;
}

/** Parse the resolved internal SvelteKit route. Use before translated HTML cache access. */
export function parseReaderRoute(
  routeId: string | null,
  params: Record<string, string | undefined>,
): ParsedReaderRoute | null {
  if (!routeId) return null;
  const marker = "/app";
  const markerIndex = routeId.indexOf(marker);
  if (markerIndex < 0) return null;
  const routePattern = routeId.slice(markerIndex).replace(/\.md$/u, "");
  const surah = requiredParam(params, "surah", SURAH_SEGMENT);
  const lang = requiredParam(params, "lang", CONTENT_LANGUAGE_SEGMENT);
  const translator = requiredParam(params, "translator", TRANSLATOR_SEGMENT);
  const localPage = requiredParam(params, "localPage", POSITIVE_INTEGER);
  const n = requiredParam(params, "n", POSITIVE_INTEGER);

  switch (routePattern) {
    case "/app":
      return parseReaderPath("/app");
    case "/app/juz":
      return parseReaderPath("/app/juz");
    case "/app/[surah]":
      return surah ? parseReaderPath(`/app/${surah}`) : null;
    case "/app/[surah]/page/[localPage]":
      return surah && localPage && localPage !== "1"
        ? parseReaderPath(`/app/${surah}/page/${localPage}`)
        : null;
    case "/app/page/[n]":
      return n ? parseReaderPath(`/app/page/${n}`) : null;
    case "/app/juz/[n]":
      return n ? parseReaderPath(`/app/juz/${n}`) : null;
    case "/app/[surah]/t/[lang]/[translator]":
      return surah && lang && translator
        ? parseReaderPath(`/app/${surah}/t/${lang}/${translator}`)
        : null;
    case "/app/[surah]/t/[lang]/[translator]/page/[localPage]":
      return surah && lang && translator && localPage && localPage !== "1"
        ? parseReaderPath(`/app/${surah}/t/${lang}/${translator}/page/${localPage}`)
        : null;
    case "/app/t/[lang]/[translator]/page/[n]":
      return lang && translator && n
        ? parseReaderPath(`/app/t/${lang}/${translator}/page/${n}`)
        : null;
    case "/app/t/[lang]/[translator]/juz/[n]":
      return lang && translator && n
        ? parseReaderPath(`/app/t/${lang}/${translator}/juz/${n}`)
        : null;
    default:
      return null;
  }
}
