import { MARKETING_ROUTES } from "./config/site-structure";

export interface AcceptEntry {
  readonly type: string;
  readonly q: number;
  readonly specificity: number;
}

export type MdNegotiation =
  | { kind: "passthrough" }
  | { kind: "markdown"; mdPath: string }
  | { kind: "not-acceptable"; accept: string };

const NEGOTIABLE_TYPES = ["text/html", "text/markdown"] as const;

const MD_SIBLING_PATHS: ReadonlyMap<string, string> = new Map(
  Object.values(MARKETING_ROUTES)
    .filter((href) => href === "/" || !href.slice(1).includes("/"))
    .map((href) => [href, href === "/" ? "/index.md" : `${href}.md`] as const),
);

const SURAH_SEGMENT = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const CONTENT_LANGUAGE_SEGMENT = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const TRANSLATOR_SEGMENT = "[a-z0-9]+(?:[.-][a-z0-9]+)*";
const NUMBER = "[1-9][0-9]*";
const PAGE_BEYOND_FIRST = "(?:[2-9]|[1-9][0-9]+)";
const READER_MD_SIBLING_PATTERNS: readonly RegExp[] = [
  new RegExp(`^/app/${SURAH_SEGMENT}$`, "u"),
  new RegExp(`^/app/${SURAH_SEGMENT}/page/${PAGE_BEYOND_FIRST}$`, "u"),
  new RegExp(`^/app/(?:page|juz)/${NUMBER}$`, "u"),
  new RegExp(`^/app/${SURAH_SEGMENT}/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}$`, "u"),
  new RegExp(
    `^/app/${SURAH_SEGMENT}/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}/page/${PAGE_BEYOND_FIRST}$`,
    "u",
  ),
  new RegExp(
    `^/app/t/${CONTENT_LANGUAGE_SEGMENT}/${TRANSLATOR_SEGMENT}/(?:page|juz)/${NUMBER}$`,
    "u",
  ),
].map((pattern) => new RegExp(`^(?:/(?:en|ar))?${pattern.source.slice(1)}`, pattern.flags));

function readerMdSibling(pathname: string): string | null {
  if (!pathname.startsWith("/app/") && !/^\/(?:en|ar)\/app\//u.test(pathname)) return null;
  if (pathname === "/app/juz" || pathname === "/en/app/juz" || pathname === "/ar/app/juz") {
    return null;
  }
  return READER_MD_SIBLING_PATTERNS.some((pattern) => pattern.test(pathname))
    ? `${pathname}.md`
    : null;
}

function specificityOf(type: string): number {
  if (type === "*/*") return 0;
  if (type.endsWith("/*")) return 1;
  return 2;
}

export function parseAccept(header: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];
  for (const part of header.split(",")) {
    const segments = part.split(";");
    const type = (segments[0] ?? "").trim().toLowerCase();
    if (!type.includes("/")) continue;
    let q = 1;
    for (const param of segments.slice(1)) {
      const eq = param.indexOf("=");
      if (eq === -1) continue;
      if (param.slice(0, eq).trim().toLowerCase() !== "q") continue;
      const parsed = Number(param.slice(eq + 1));
      q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
      break;
    }
    entries.push({ type, q, specificity: specificityOf(type) });
  }
  return entries;
}

interface AcceptMatch {
  readonly entry: AcceptEntry;
  readonly position: number;
}

function bestMatch(entries: AcceptEntry[], candidate: string): AcceptMatch | null {
  const candidateType = candidate.toLowerCase();
  const major = candidateType.split("/")[0] ?? "";
  let best: AcceptMatch | null = null;
  for (let position = 0; position < entries.length; position += 1) {
    const entry = entries[position]!;
    const matches =
      entry.type === candidateType ||
      entry.type === "*/*" ||
      (entry.type.endsWith("/*") && entry.type.slice(0, -2) === major);
    if (!matches) continue;
    if (best === null || entry.specificity > best.entry.specificity) {
      best = { entry, position };
    }
  }
  return best;
}

export function preferredType(header: string | null, produces: readonly string[]): string | null {
  if (produces.length === 0) return null;
  if (header === null) return produces[0]!;
  const entries = parseAccept(header);
  if (entries.length === 0) return produces[0]!;
  let chosen: string | null = null;
  let chosenQ = 0;
  let chosenPosition = -1;
  for (const candidate of produces) {
    const match = bestMatch(entries, candidate);
    if (match === null || match.entry.q <= 0) continue;
    if (match.entry.q > chosenQ || (match.entry.q === chosenQ && match.position < chosenPosition)) {
      chosen = candidate;
      chosenQ = match.entry.q;
      chosenPosition = match.position;
    }
  }
  return chosen;
}

export function varyWithAccept(existing: string | null | undefined): string {
  if (existing === null || existing === undefined || existing === "") return "Accept";
  const hasAccept = existing.split(",").some((token) => token.trim().toLowerCase() === "accept");
  return hasAccept ? existing : `${existing}, Accept`;
}

export function appendVaryAccept(headers: Headers): void {
  headers.set("Vary", varyWithAccept(headers.get("vary")));
}

export function mdSiblingPathFor(pathname: string): string | null {
  return MD_SIBLING_PATHS.get(pathname) ?? readerMdSibling(pathname);
}

export function negotiateMarkdownPath(pathname: string, accept: string | null): MdNegotiation {
  const mdPath = mdSiblingPathFor(pathname);
  if (mdPath === null) return { kind: "passthrough" };
  const chosen = preferredType(accept, NEGOTIABLE_TYPES);
  if (accept !== null && chosen === null) return { kind: "not-acceptable", accept };
  if (chosen === "text/markdown") return { kind: "markdown", mdPath };
  return { kind: "passthrough" };
}

export function notAcceptableBody(accept: string): string {
  return `406 Not Acceptable. Available representations: text/html, text/markdown. Requested Accept: ${accept}\n`;
}
