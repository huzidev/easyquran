import { deLocalizeUrl } from "$lib/paraglide/runtime";
import type { Reroute } from "@sveltejs/kit";

const SURAH_SEGMENT = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const CONTENT_LANGUAGE_SEGMENT = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const TRANSLATOR_SEGMENT = "[a-z0-9]+(?:[.-][a-z0-9]+)*";
const NUMBER = "[1-9][0-9]*";
const PAGE_BEYOND_FIRST = "(?:[2-9]|[1-9][0-9]+)";
const READER_ROUTE_PATTERNS = [
  new RegExp("^/app$", "u"),
  new RegExp("^/app/juz$", "u"),
  new RegExp(`^/app/${SURAH_SEGMENT}$`, "u"),
  new RegExp(`^/app/${SURAH_SEGMENT}/page/${NUMBER}$`, "u"),
  new RegExp(`^/app/(?:page|juz)/${NUMBER}$`, "u"),
  new RegExp(`^/app/${SURAH_SEGMENT}/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}$`, "u"),
  new RegExp(
    `^/app/${SURAH_SEGMENT}/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}/page/${NUMBER}$`,
    "u",
  ),
  new RegExp(
    `^/app/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}/(?:page|juz)/${NUMBER}$`,
    "u",
  ),
  new RegExp(`^/app/${SURAH_SEGMENT}\\.md$`, "u"),
  new RegExp(`^/app/${SURAH_SEGMENT}/page/${PAGE_BEYOND_FIRST}\\.md$`, "u"),
  new RegExp(`^/app/(?:page|juz)/${NUMBER}\\.md$`, "u"),
  new RegExp(`^/app/${SURAH_SEGMENT}/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}\\.md$`, "u"),
  new RegExp(
    `^/app/${SURAH_SEGMENT}/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}/page/${PAGE_BEYOND_FIRST}\\.md$`,
    "u",
  ),
  new RegExp(
    `^/app/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}/(?:page|juz)/${NUMBER}\\.md$`,
    "u",
  ),
];

function isReaderRoute(pathname: string): boolean {
  return (
    pathname.length <= 256 &&
    !pathname.includes("%") &&
    !pathname.includes("//") &&
    READER_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))
  );
}

function localizedReaderTuple(rawPathname: string, candidatePathname: string): boolean {
  const match = /^\/(en|ar)(\/app(?:\/.*)?)$/u.exec(rawPathname);
  return !!match && match[2] === candidatePathname && isReaderRoute(candidatePathname);
}

export const reroute: Reroute = ({ url }) => {
  const candidate = deLocalizeUrl(url);
  if (localizedReaderTuple(url.pathname, candidate.pathname)) return candidate.pathname;
  if ((url.pathname === "/ar" || url.pathname === "/ar/") && candidate.pathname === "/") {
    return "/";
  }
  return url.pathname;
};
