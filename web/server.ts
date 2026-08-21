import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";

import {
  mdSiblingPathFor,
  negotiateMarkdownPath,
  notAcceptableBody,
  varyWithAccept,
} from "./src/lib/accept-parse";

// Emitted by adapter-node at build time, so it carries no types of its own.
import { handler } from "./build/handler.js";

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

/** The two `writeHead` shapes this server's call graph produces, as one tuple. */
type WriteHeadArgs = [statusCode: number, headers?: OutgoingHttpHeaders];

type EndArgs = [chunk?: unknown, encoding?: BufferEncoding | null, callback?: () => void];

const IMMUTABLE = "public, max-age=31536000, immutable";
const HSTS = "max-age=31536000; includeSubDomains";
const packPattern = /^\/offline\/pack\.[A-Za-z0-9_-]+\.json$/u;
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const prerenderedDir = "build/prerendered";
const scriptPattern = /<script>([\s\S]*?)<\/script>/gu;

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`[server] invalid PORT: ${process.env.PORT ?? ""}`);
}

// adapter-node serves prerendered pages through sirv BEFORE hooks run, so their
// inline scripts (app.html theme script + kit's per-route bootstrap) carry no
// nonce. A per-request nonce would mean rewriting (pre)compressed bodies; the
// sanctioned fallback is a 'sha256-<hash>' script-src entry per served path,
// scanned once at boot from the prerendered output itself.
async function scanPageScriptHashes(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const addFile = async (file: string): Promise<void> => {
    const html = await readFile(file, "utf8").catch(() => null);
    if (html === null) return;
    const hashes: string[] = [];
    for (const match of html.matchAll(scriptPattern)) {
      hashes.push(
        `'sha256-${createHash("sha256")
          .update(match[1] ?? "")
          .digest("base64")}'`,
      );
    }
    if (hashes.length === 0) return;
    const relative = file.slice(prerenderedDir.length).replace(/^\/+|\/+$/gu, "");
    const base = relative.replace(/\.html$/u, "");
    const keys = base === "index" ? ["/", "/index.html"] : [`/${base}`, `/${base}.html`];
    for (const key of keys) map.set(key, hashes);
  };
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);
    if (entries === null) return;
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".html")) await addFile(full);
    }
  };
  await walk(prerenderedDir);
  return map;
}

const pageScriptHashes = await scanPageScriptHashes();

function apiOrigin(): string {
  const base = (process.env.PUBLIC_QURAN_API_BASE ?? "").replace(/\/+$/, "");
  return base ? `${base}/` : "";
}

function buildCsp(scriptTokens: readonly string[]): string {
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
  const api = apiOrigin();
  if (api) connectSrc.push(api);
  const scriptSrc = [
    "'self'",
    ...scriptTokens,
    "https://www.gstatic.com",
    "https://www.googletagmanager.com",
  ];
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

function headerArg(headers: OutgoingHttpHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    if (Array.isArray(value)) return value.map(String).join(", ");
    if (value !== undefined) return String(value);
  }
  return undefined;
}

function getHeaderString(response: ServerResponse, name: string): string | undefined {
  const value = response.getHeader(name);
  if (Array.isArray(value)) return value.join(", ");
  if (value !== undefined) return String(value);
  return undefined;
}

// The outermost header pass. Inner layers win: hooks sets the full
// nonce-CSP + privacy Cache-Control tiers on every SSR response, and sirv
// sets Cache-Control on immutable client assets — those are respected, only
// missing headers are filled in. Prerendered HTML (sirv, pre-hooks) gets the
// script-hash CSP; everything else gets the nonce-free static policy.
// applyHeaders runs before the wrapped writeHead re-applies sirv's argsHeaders,
// so a merged value must ALSO be written back into argsHeaders in place or the
// inner layer's copy clobbers it on the real write.
function mergeHeaderInPlace(
  response: ServerResponse,
  argsHeaders: OutgoingHttpHeaders | undefined,
  name: string,
  merge: (existing: string) => string,
): void {
  const current = getHeaderString(response, name);
  const argValue = headerArg(argsHeaders, name);
  if (current === undefined && argValue === undefined) {
    response.setHeader(name, merge(""));
    return;
  }
  const merged = merge(current ?? argValue ?? "");
  response.setHeader(name, merged);
  if (argsHeaders !== undefined && argValue !== undefined) {
    for (const key of Object.keys(argsHeaders)) {
      if (key.toLowerCase() === name) delete argsHeaders[key];
    }
    argsHeaders[name] = merged;
  }
}

function applyHeaders(
  response: ServerResponse,
  pathname: string,
  statusCode: number,
  argsHeaders?: OutgoingHttpHeaders,
): void {
  const setIfAbsent = (name: string, value: string): void => {
    if (getHeaderString(response, name.toLowerCase()) === undefined)
      response.setHeader(name, value);
  };
  setIfAbsent("X-Content-Type-Options", "nosniff");
  setIfAbsent("Referrer-Policy", "strict-origin-when-cross-origin");
  setIfAbsent("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  setIfAbsent("Strict-Transport-Security", HSTS);
  const contentType =
    headerArg(argsHeaders, "content-type") ?? getHeaderString(response, "content-type");
  const isHtml = contentType !== undefined && contentType.includes("text/html");
  if (
    getHeaderString(response, "content-security-policy") === undefined &&
    headerArg(argsHeaders, "content-security-policy") === undefined
  ) {
    const hashes = isHtml ? pageScriptHashes.get(pathname) : undefined;
    response.setHeader("Content-Security-Policy", buildCsp(hashes ?? []));
  }
  const mdPath = mdSiblingPathFor(pathname);
  if (isHtml && mdPath !== null) {
    const alternate = `<${mdPath}>; rel="alternate"; type="text/markdown"`;
    mergeHeaderInPlace(response, argsHeaders, "Link", (existing) =>
      existing ? `${existing}, ${alternate}` : alternate,
    );
  }
  if (
    headerArg(argsHeaders, "cache-control") === undefined &&
    getHeaderString(response, "cache-control") === undefined
  ) {
    if (statusCode >= 500) {
      response.setHeader("Cache-Control", "no-store");
    } else if (
      pathname.startsWith("/_app/immutable/") ||
      pathname.startsWith("/_quran/tanzil/") ||
      packPattern.test(pathname)
    ) {
      response.setHeader("Cache-Control", IMMUTABLE);
    } else {
      response.setHeader("Cache-Control", "no-cache");
    }
  }
  if (pathname.endsWith(".md") || pathname.endsWith(".txt")) {
    setIfAbsent("X-Robots-Tag", "noindex, follow");
  }
  if (mdPath !== null || pathname.endsWith(".md") || pathname.endsWith(".txt") || statusCode === 404) {
    mergeHeaderInPlace(response, argsHeaders, "Vary", varyWithAccept);
  }
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // keep the raw path for lookups
  }
  const writeHead = response.writeHead.bind(response);
  // Forward args verbatim — writeHead is overloaded, and `Parameters<>` collapses
  // to the last overload. Only the two shapes this call graph produces are
  // spelled: `(statusCode)` from kit's setResponse and `(statusCode, headers)`
  // from sirv — the statusMessage and header-array overloads never occur here.
  // SAFETY: the rest tuple spells those writeHead overloads and the assertions
  // re-attach the overloaded type on the way out.
  response.writeHead = function headerAwareWriteHead(
    this: ServerResponse,
    ...args: WriteHeadArgs
  ): ServerResponse {
    applyHeaders(this, decodedPath, args[0], args[1]);
    // SAFETY: writeHead was captured from this response; the tuple spells its overloads.
    return (writeHead as (...forwarded: WriteHeadArgs) => ServerResponse)(...args);
  } as ServerResponse["writeHead"];

  // sirv's 404/redirect-error paths and adapter error paths call `end` without
  // `writeHead`, so headers would otherwise flush without the security set.
  const end = response.end.bind(response);
  // SAFETY: the rest tuple spells end's overloads and the assertion re-attaches
  // the overloaded type on the way out.
  response.end = function securityAwareEnd(this: ServerResponse, ...args: EndArgs): ServerResponse {
    if (!this.headersSent) applyHeaders(this, decodedPath, this.statusCode);
    // SAFETY: end was captured from this response; the tuple spells its overloads.
    return (end as (...forwarded: EndArgs) => ServerResponse)(...args);
  } as ServerResponse["end"];

  void routeNegotiated(request, response, decodedPath);
});

// Prerendered pages are served by sirv inside the adapter handler BEFORE hooks
// run, so Accept negotiation for the md-sibling marketing pages has to happen
// here — one layer above the handler — reading the prerendered .md directly.
async function routeNegotiated(
  request: IncomingMessage,
  response: ServerResponse,
  decodedPath: string,
): Promise<void> {
  if (request.method === "GET") {
    const negotiation = negotiateMarkdownPath(decodedPath, request.headers.accept ?? null);
    if (negotiation.kind === "not-acceptable") {
      response.statusCode = 406;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Vary", "Accept");
      response.end(notAcceptableBody(negotiation.accept));
      return;
    }
    if (negotiation.kind === "markdown") {
      const body = await readFile(join(prerenderedDir, negotiation.mdPath)).catch(() => null);
      if (body !== null) {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/markdown; charset=utf-8");
        response.end(body);
        return;
      }
    }
  }
  try {
    // SAFETY: adapter-node emits handler.js without types; RequestHandler spells its real signature.
    await (handler as RequestHandler)(request, response);
  } catch (cause: unknown) {
    console.error("[server] unhandled request error", cause);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.statusCode = 500;
    applyHeaders(response, decodedPath, 500);
    response.end("Internal Server Error");
  }
}

server.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
});
