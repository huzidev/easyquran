import { randomBytes } from "node:crypto";

import { building } from "$app/environment";
import { QURAN } from "$lib/config/site";
import { isUiLocale, uiDirection, type UiDirection, type UiLocale } from "$lib/i18n/locales";
import { paraglideMiddleware } from "$lib/paraglide/server";
import {
  agentNotFoundMarkdown,
  appendVaryAccept,
  mdSiblingRequest,
  notAcceptableBody,
  preferredType,
} from "$lib/server/markdown-negotiation";
import { diskCacheKey, getCachedHtml, setCachedHtml } from "$lib/server/quran-disk-cache";
import {
  localizedReaderLocale,
  parseReaderPath,
  parseReaderRoute,
  type ParsedReaderRoute,
} from "$lib/server/reader-route";
import type { Handle, RequestEvent } from "@sveltejs/kit";

const IMMUTABLE = "public, max-age=31536000, immutable";

const NEGOTIABLE_TYPES = ["text/html", "text/markdown"];

const packPattern = /^\/offline\/pack\.[A-Za-z0-9_-]+\.json$/u;

const NONCE_PLACEHOLDER = "%csp-nonce%";

function freshNonce(): string {
  return randomBytes(16).toString("base64");
}

function translationRouteCacheKey(
  route: ParsedReaderRoute | null,
  uiLocale: UiLocale | null,
): string | null {
  if (!uiLocale || route?.type !== "translation") return null;
  const base = diskCacheKey(
    route.sourceId,
    route.cacheKind,
    route.index,
    route.cacheKind === "surah" ? (route.localPage ?? 1) : undefined,
  );
  return `${base}__ui-${uiLocale}`;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildCsp(nonce: string | undefined): string {
  const api = QURAN.apiBase ? withTrailingSlash(QURAN.apiBase) : "";
  const connectSrc = [
    "'self'",
    "https://*.firebaseio.com",
    "wss://*.firebaseio.com",
    "https://firestore.googleapis.com",
    "https://firebase.googleapis.com",
    "https://firebaseinstallations.googleapis.com",
    "https://firebaseremoteconfig.googleapis.com",
    "https://firebaselogging.googleapis.com",
    "https://firebaselogging-pa.googleapis.com",
    "https://fcmregistrations.googleapis.com",
    "https://play.google.com",
    "https://www.google-analytics.com",
    "https://www.google.com",
  ];
  if (api) connectSrc.push(api);
  if (import.meta.env.DEV) {
    connectSrc.push("http://localhost:*", "ws://localhost:*", "wss://localhost:*");
  }
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
  if (nonce) scriptSrc.push(`'nonce-${nonce}'`);
  scriptSrc.push("https://www.gstatic.com", "https://www.googletagmanager.com");
  if (import.meta.env.DEV) {
    scriptSrc.push("'unsafe-eval'");
  }
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function hasNoStore(response: Response): boolean {
  const cc = response.headers.get("cache-control");
  return !!cc && /no-store/i.test(cc);
}

function responseSetsCookie(response: Response): boolean {
  if (response.headers.get("set-cookie")) return true;
  // SAFETY: getSetCookie exists at runtime on modern Headers implementations
  // but is missing from the TS lib target; the optional-prop intersection
  // mirrors exactly that runtime shape.
  const getter = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- feature-detecting the optional getSetCookie method on this platform's Headers; no I/O boundary to parse here
  return typeof getter === "function" && getter.call(response.headers).length > 0;
}

export function applyHeaders(
  response: Response,
  pathname: string,
  requestHasCookie = false,
  nonce?: string,
): void {
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const translationPending = response.headers.get("x-eq-translation-pending");
  const privateMode = requestHasCookie || responseSetsCookie(response);
  const isImmutableAsset =
    pathname.startsWith("/_app/immutable/") ||
    pathname.startsWith("/_quran/tanzil/") ||
    packPattern.test(pathname);
  if (privateMode && !isImmutableAsset) {
    response.headers.set("Cache-Control", "private, no-store");
  } else if (response.status >= 500 || hasNoStore(response) || translationPending) {
    response.headers.set("Cache-Control", "no-store");
  } else if (isImmutableAsset) {
    response.headers.set("Cache-Control", IMMUTABLE);
  } else {
    response.headers.set("Cache-Control", "no-cache");
  }
  const textVariant = pathname.endsWith(".md") || pathname.endsWith(".txt");
  if (textVariant) {
    response.headers.set("X-Robots-Tag", "noindex, follow");
  }
  if (textVariant || mdSiblingRequest(pathname) !== null || response.status === 404) {
    appendVaryAccept(response.headers);
  }
}

interface DocumentAttributes {
  readonly lang: string;
  readonly dir: UiDirection;
}

interface NonceHolder {
  nonce?: string;
}

function documentAttributes(uiLocale: UiLocale | null): DocumentAttributes {
  if (uiLocale) return { lang: uiLocale, dir: uiDirection(uiLocale) };
  return { lang: "en", dir: "ltr" };
}

function transformRootHtml(html: string, attributes: DocumentAttributes): string {
  return html
    .replace('lang="%lang%"', `lang="${attributes.lang}"`)
    .replace('dir="%dir%"', `dir="${attributes.dir}"`);
}

function tagInlineScripts(html: string, nonce: string): string {
  return html.replaceAll("<script>", `<script nonce="${nonce}">`);
}

function legacyReaderRedirect(event: RequestEvent): Response | null {
  const { pathname } = event.url;
  if (!pathname.startsWith("/app") || !parseReaderPath(pathname)) return null;
  const tail = building ? "" : `${event.url.search}${event.url.hash}`;
  return new Response(null, {
    status: 307,
    headers: {
      location: `/en${pathname}${tail}`,
      "cache-control": "no-store",
    },
  });
}

function noncanonicalLocalizedReaderRedirect(event: RequestEvent): Response | null {
  const { pathname } = event.url;
  if (
    event.params.localPage !== "1" ||
    !event.route.id ||
    (!event.route.id.endsWith("/app/[surah]/page/[localPage]") &&
      !event.route.id.endsWith("/app/[surah]/t/[lang]/[translator]/page/[localPage]")) ||
    !pathname.endsWith("/page/1")
  ) {
    return null;
  }
  const localizedCanonical = pathname.slice(0, -"/page/1".length);
  const canonical = localizedCanonical.replace(/^\/(?:en|ar)(?=\/app(?:\/|$))/u, "");
  if (!parseReaderPath(canonical)) return null;
  const tail = building ? "" : `${event.url.search}${event.url.hash}`;
  return new Response(null, {
    status: 308,
    headers: { location: `${localizedCanonical}${tail}` },
  });
}

function notFound(event: RequestEvent): Response {
  if (prefersMarkdown(event)) {
    return new Response(agentNotFoundMarkdown(), {
      status: 404,
      headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept" },
    });
  }
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function notAcceptable(accept: string): Response {
  return new Response(notAcceptableBody(accept), {
    status: 406,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      vary: "Accept",
    },
  });
}

function prefersMarkdown(event: RequestEvent): boolean {
  return (
    event.request.method === "GET" &&
    !event.isDataRequest &&
    !event.isSubRequest &&
    preferredType(event.request.headers.get("accept"), NEGOTIABLE_TYPES) === "text/markdown"
  );
}

async function resolveRequest(
  event: RequestEvent,
  resolve: Parameters<Handle>[0]["resolve"],
  uiLocale: UiLocale | null,
  readerRoute: ParsedReaderRoute | null,
  requestHasCookie: boolean,
): Promise<{ response: Response; nonce: string }> {
  const key = translationRouteCacheKey(readerRoute, uiLocale);
  const cacheable =
    event.request.method === "GET" &&
    !event.isDataRequest &&
    key !== null &&
    !requestHasCookie &&
    !event.url.pathname.endsWith(".md");
  const attributes = documentAttributes(uiLocale);
  const nonce = freshNonce();
  const resolveOpts = {
    transformPageChunk: ({ html }: { html: string }) => {
      const out = transformRootHtml(html, attributes);
      return building ? out : tagInlineScripts(out, nonce);
    },
  };

  if (cacheable) {
    const hit = await getCachedHtml(key);
    if (hit !== null) {
      const response = new Response(hit.replaceAll(NONCE_PLACEHOLDER, nonce), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "server-timing": 'quran_ssr_cache;desc="hit"',
          "x-easyquran-quran-cache": "hit",
        },
      });
      return { response, nonce };
    }
    const response = await resolve(event, resolveOpts);
    const contentType = response.headers.get("content-type") ?? "";
    const setsCookie = responseSetsCookie(response);
    if (
      !setsCookie &&
      response.status === 200 &&
      contentType.includes("text/html") &&
      !response.headers.get("x-eq-translation-pending")
    ) {
      const clone = response.clone();
      await clone
        .text()
        .then((html) =>
          setCachedHtml(key, html.replaceAll(`nonce="${nonce}"`, `nonce="${NONCE_PLACEHOLDER}"`)),
        )
        .catch(() => {});
    }
    response.headers.set("server-timing", 'quran_ssr_cache;desc="miss"');
    response.headers.set("x-easyquran-quran-cache", "miss");
    return { response, nonce };
  }

  return { response: await resolve(event, resolveOpts), nonce };
}

function isLocalizedMarketingPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/ar" || pathname === "/ar/";
}

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const requestHasCookie = !!event.request.headers.get("cookie");
  const mdSibling = mdSiblingRequest(pathname);
  let response: Response | null = null;
  let nonce: string | undefined;
  let negotiated = false;

  if (
    mdSibling !== null &&
    event.request.method === "GET" &&
    !event.isDataRequest &&
    !event.isSubRequest
  ) {
    const accept = event.request.headers.get("accept");
    const chosen = preferredType(accept, NEGOTIABLE_TYPES);
    if (accept !== null && chosen === null) {
      response = notAcceptable(accept);
      negotiated = true;
    } else if (chosen === "text/markdown") {
      const md = await event.fetch(mdSibling.mdPath.replace(/^\/(?:en|ar)(?=\/app\/)/u, ""));
      if (md.ok) {
        response = new Response(await md.text(), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "x-robots-tag": "noindex, follow",
            vary: "Accept",
          },
        });
        negotiated = true;
      }
    }
  }

  if (!response) {
    response = legacyReaderRedirect(event);
  }

  if (!response) {
    const readerLocale = localizedReaderLocale(pathname);
    const useI18n = readerLocale !== null || isLocalizedMarketingPath(pathname);
    const noncanonicalRedirect = readerLocale ? noncanonicalLocalizedReaderRedirect(event) : null;
    if (noncanonicalRedirect) {
      response = noncanonicalRedirect;
    } else if (readerLocale && !parseReaderRoute(event.route.id, event.params)) {
      response = notFound(event);
    } else if (useI18n) {
      const resolved: NonceHolder = {};
      response = await paraglideMiddleware(event.request, async ({ request, locale }) => {
        if (!isUiLocale(locale)) return notFound(event);
        event.request = request;
        const readerRoute = readerLocale ? parseReaderRoute(event.route.id, event.params) : null;
        const out = await resolveRequest(event, resolve, locale, readerRoute, requestHasCookie);
        resolved.nonce = out.nonce;
        return out.response;
      });
      if (resolved.nonce) nonce = resolved.nonce;
    } else {
      const resolved = await resolveRequest(
        event,
        resolve,
        null,
        parseReaderRoute(event.route.id, event.params),
        requestHasCookie,
      );
      response = resolved.response;
      nonce = resolved.nonce;
    }
  }

  if (
    response.status === 404 &&
    !(response.headers.get("content-type") ?? "").includes("text/markdown") &&
    prefersMarkdown(event)
  ) {
    response = new Response(agentNotFoundMarkdown(), {
      status: 404,
      headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept" },
    });
  }

  if (mdSibling !== null && !negotiated) {
    appendVaryAccept(response.headers);
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      const link = `<${mdSibling.mdPath}>; rel="alternate"; type="text/markdown"`;
      const existingLink = response.headers.get("link");
      response.headers.set("Link", existingLink ? `${existingLink}, ${link}` : link);
    }
  }

  applyHeaders(response, pathname, requestHasCookie, nonce);
  return response;
};
