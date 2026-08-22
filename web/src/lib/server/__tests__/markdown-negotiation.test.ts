import type { Handle, RequestEvent } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$lib/config/site", () => ({
  QURAN: { apiBase: "" },
  SITE: {
    name: "EasyQuran",
    domain: "easyquran.fyi",
    url: "https://easyquran.fyi",
    github: "https://github.com/hmziqrs",
    maker: "oxlabs",
    makerUrl: "https://oxlabs.dev",
    owner: "hmziq.rs",
    ownerUrl: "https://hmziq.rs",
    tanzilUrl: "https://tanzil.net",
  },
}));

import {
  agentNotFoundMarkdown,
  appendVaryAccept,
  mdSiblingRequest,
  parseAccept,
  preferredType,
} from "$lib/server/markdown-negotiation";
import { handle } from "../../../hooks.server";

const ORIGIN = "https://easyquran.fyi";

const CHROME_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

const PRODUCES = ["text/html", "text/markdown"];

const MD_BODY = "# EasyQuran\n\nmock markdown sibling\n";

function requestEvent(
  pathname: string,
  routeId: string | null,
  opts: { headers?: HeadersInit; fetch?: RequestEvent["fetch"]; params?: Record<string, string> } = {},
): RequestEvent {
  const url = new URL(pathname, ORIGIN);
  const request = new Request(url);
  for (const [name, value] of new Headers(opts.headers)) request.headers.set(name, value);
  // SAFETY: test double providing every RequestEvent member the handle() path reads; cookies and locals are inert placeholders in this test.
  return {
    // SAFETY: handle() reads no cookies in these tests; the empty object satisfies the accessor shape RequestEvent declares.
    cookies: {} as RequestEvent["cookies"],
    fetch: opts.fetch ?? fetch,
    getClientAddress: () => "127.0.0.1",
    isDataRequest: false,
    isRemoteRequest: false,
    isSubRequest: false,
    locals: {},
    params: opts.params ?? {},
    platform: undefined,
    request,
    route: { id: routeId },
    setHeaders: () => {},
    // SAFETY: tracing is kit-internal telemetry; the handle() path under test never reads it.
    tracing: { enabled: false } as RequestEvent["tracing"],
    url,
  } as RequestEvent;
}

function htmlResolve(body = "rendered", status = 200): Parameters<Handle>[0]["resolve"] {
  return vi.fn(async (_event, options) => {
    const source = `<html lang="%lang%" dir="%dir%"><body>${body}</body></html>`;
    const html = options?.transformPageChunk
      ? await options.transformPageChunk({ html: source, done: true })
      : source;
    return new Response(html, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}

interface MdFetchDouble {
  readonly fetch: RequestEvent["fetch"];
  readonly calls: string[];
}

function fetchPath(input: Parameters<RequestEvent["fetch"]>[0]): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.pathname;
  return input;
}

function mdFetchDouble(): MdFetchDouble {
  const calls: string[] = [];
  const impl: RequestEvent["fetch"] = async (input) => {
    calls.push(fetchPath(input));
    return new Response(MD_BODY, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  };
  return { fetch: impl, calls };
}

describe("parseAccept", () => {
  it("parses q values, wildcards, and specificity", () => {
    expect(parseAccept("text/html;q=0.5, text/*;q=0.2")).toEqual([
      { type: "text/html", q: 0.5, specificity: 2 },
      { type: "text/*", q: 0.2, specificity: 1 },
    ]);
    expect(parseAccept("*/*;q=0.8")).toEqual([{ type: "*/*", q: 0.8, specificity: 0 }]);
  });

  it("drops malformed ranges and falls back to q=1 for invalid q", () => {
    expect(parseAccept("garbage, , TEXT/PLAIN;q=abc")).toEqual([
      { type: "text/plain", q: 1, specificity: 2 },
    ]);
  });
});

describe("preferredType", () => {
  it.each([
    { accept: "text/markdown", expected: "text/markdown" },
    { accept: "text/markdown, text/html;q=0.8", expected: "text/markdown" },
    { accept: "text/html", expected: "text/html" },
    { accept: "text/markdown;q=0, text/html", expected: "text/html" },
    { accept: "text/markdown;q=0", expected: null },
    { accept: null, expected: "text/html" },
    { accept: "*/*", expected: "text/html" },
    { accept: CHROME_ACCEPT, expected: "text/html" },
  ])("preferredType($accept) -> $expected", ({ accept, expected }) => {
    expect(preferredType(accept, PRODUCES)).toBe(expected);
  });
});

describe("appendVaryAccept", () => {
  it("sets Vary on a fresh header", () => {
    const headers = new Headers();
    appendVaryAccept(headers);
    expect(headers.get("vary")).toBe("Accept");
  });

  it("appends while preserving existing tokens", () => {
    const headers = new Headers({ vary: "accept-encoding" });
    appendVaryAccept(headers);
    expect(headers.get("vary")).toBe("accept-encoding, Accept");
  });

  it("does not duplicate an existing Accept token", () => {
    const headers = new Headers({ vary: "Accept, accept-encoding" });
    appendVaryAccept(headers);
    expect(headers.get("vary")).toBe("Accept, accept-encoding");
  });
});

describe("mdSiblingRequest", () => {
  it.each([
    { pathname: "/", mdPath: "/index.md" },
    { pathname: "/about", mdPath: "/about.md" },
    { pathname: "/faq", mdPath: "/faq.md" },
    { pathname: "/contact", mdPath: "/contact.md" },
    { pathname: "/privacy", mdPath: "/privacy.md" },
    { pathname: "/terms", mdPath: "/terms.md" },
    { pathname: "/app/al-fatihah", mdPath: "/app/al-fatihah.md" },
    { pathname: "/en/app/al-fatihah", mdPath: "/en/app/al-fatihah.md" },
    { pathname: "/app/juz/1", mdPath: "/app/juz/1.md" },
    { pathname: "/en/app/al-fatihah/t/en/sahih", mdPath: "/en/app/al-fatihah/t/en/sahih.md" },
  ])("maps $pathname to $mdPath", ({ pathname, mdPath }) => {
    expect(mdSiblingRequest(pathname)).toEqual({ canonicalPath: pathname, mdPath });
  });

  it.each(["/ar", "/ar/about", "/app", "/app/juz", "/about.md", "/llms.txt", "/about/"])(
    "returns null for %s",
    (pathname) => {
      expect(mdSiblingRequest(pathname)).toBeNull();
    },
  );
});

describe("server markdown negotiation integration", () => {
  it("serves the markdown sibling for GET / with Accept: text/markdown", async () => {
    const { fetch, calls } = mdFetchDouble();
    const resolve = htmlResolve("must-not-render");
    const response = await handle({
      event: requestEvent("/", "/", { headers: { accept: "text/markdown" }, fetch }),
      resolve,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("accept");
    expect(await response.text()).toContain("mock markdown sibling");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(calls).toEqual(["/index.md"]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps HTML for the Chrome Accept string and advertises the alternate", async () => {
    const { fetch, calls } = mdFetchDouble();
    const response = await handle({
      event: requestEvent("/", "/", { headers: { accept: CHROME_ACCEPT }, fetch }),
      resolve: htmlResolve(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("accept");
    expect(response.headers.get("link")).toBe(
      '</index.md>; rel="alternate"; type="text/markdown"',
    );
    expect(calls).toEqual([]);
  });

  it("returns 406 when nothing producible matches the Accept header", async () => {
    const { fetch } = mdFetchDouble();
    const response = await handle({
      event: requestEvent("/", "/", { headers: { accept: "application/pdf" }, fetch }),
      resolve: htmlResolve("must-not-render"),
    });

    expect(response.status).toBe(406);
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("accept");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("text/markdown");
    expect(body).toContain("application/pdf");
  });

  it("returns a markdown agent 404 body for unknown pages", async () => {
    const response = await handle({
      event: requestEvent("/does-not-exist", null, { headers: { accept: "text/markdown" } }),
      resolve: htmlResolve("missing page", 404),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("accept");
    const body = await response.text();
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/sitemap.xml");
  });

  it("keeps the HTML 404 from resolve for browser Accept strings", async () => {
    const response = await handle({
      event: requestEvent("/does-not-exist", null, { headers: { accept: CHROME_ACCEPT } }),
      resolve: htmlResolve("missing page", 404),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("accept");
    expect(await response.text()).toContain("missing page");
  });

  it("defaults to HTML for GET /about with no Accept header", async () => {
    const response = await handle({
      event: requestEvent("/about", "/about"),
      resolve: htmlResolve("about page"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("about page");
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("accept");
  });

  it("adds Vary: Accept to direct .md requests via applyHeaders", async () => {
    const response = await handle({
      event: requestEvent("/about.md", "/[slug].md"),
      resolve: htmlResolve("# about"),
    });

    expect(response.status).toBe(200);
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("accept");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, follow");
  });

  it("agentNotFoundMarkdown links the site root and machine endpoints", () => {
    const body = agentNotFoundMarkdown();
    expect(body).toContain("# EasyQuran");
    expect(body).toContain("https://easyquran.fyi/");
    expect(body).toContain("https://easyquran.fyi/llms.txt");
    expect(body).toContain("https://easyquran.fyi/llms-full.txt");
    expect(body).toContain("https://easyquran.fyi/sitemap.xml");
    expect(body).toContain("https://easyquran.fyi/app/al-fatihah");
    expect(body).toContain("https://easyquran.fyi/app/juz");
    expect(body).toContain("https://easyquran.fyi/faq");
    expect(body).toContain("https://easyquran.fyi/contact");
  });
});
