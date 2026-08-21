import {
  appendVaryAccept,
  mdSiblingPathFor,
  negotiateMarkdownPath,
  notAcceptableBody,
  parseAccept,
  preferredType,
  varyWithAccept,
} from "$lib/accept-parse";
import { describe, expect, it } from "vite-plus/test";

const CHROME_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

describe("accept-parse preferredType", () => {
  it.each([
    ["text/markdown", "text/markdown"],
    ["text/markdown, text/html;q=0.8", "text/markdown"],
    ["text/html", "text/html"],
    ["text/markdown;q=0, text/html", "text/html"],
    [CHROME_ACCEPT, "text/html"],
    ["*/*", "text/html"],
    ["", "text/html"],
  ])("%s -> %s", (header, expected) => {
    expect(preferredType(header, ["text/html", "text/markdown"])).toBe(expected);
  });

  it("returns the first producible type when the header is missing", () => {
    expect(preferredType(null, ["text/html", "text/markdown"])).toBe("text/html");
  });

  it("returns null when every producible type is unmatched", () => {
    expect(preferredType("application/pdf", ["text/html", "text/markdown"])).toBeNull();
  });

  it("returns null when the only match carries q=0", () => {
    expect(preferredType("text/markdown;q=0", ["text/html", "text/markdown"])).toBeNull();
  });

  it("keeps the more specific match for the same candidate", () => {
    expect(preferredType("text/*;q=0.5, text/html;q=0.9", ["text/html"])).toBe("text/html");
  });

  it("treats header types case-insensitively", () => {
    expect(preferredType("TEXT/MARKDOWN", ["text/html", "text/markdown"])).toBe("text/markdown");
  });

  it("parses q-values and specificity", () => {
    expect(parseAccept("text/html;q=0.8, */*;q=0.1")).toEqual([
      { type: "text/html", q: 0.8, specificity: 2 },
      { type: "*/*", q: 0.1, specificity: 0 },
    ]);
  });
});

describe("accept-parse varyWithAccept", () => {
  it("produces Accept on its own", () => {
    expect(varyWithAccept(undefined)).toBe("Accept");
    expect(varyWithAccept(null)).toBe("Accept");
    expect(varyWithAccept("")).toBe("Accept");
  });

  it("appends to an existing vary value", () => {
    expect(varyWithAccept("Accept-Encoding")).toBe("Accept-Encoding, Accept");
  });

  it("does not duplicate an existing accept token", () => {
    expect(varyWithAccept("accept-encoding, accept")).toBe("accept-encoding, accept");
  });

  it("appends via Headers", () => {
    const headers = new Headers({ vary: "Accept-Encoding" });
    appendVaryAccept(headers);
    expect(headers.get("vary")).toBe("Accept-Encoding, Accept");
    appendVaryAccept(headers);
    expect(headers.get("vary")).toBe("Accept-Encoding, Accept");
  });
});

describe("accept-parse mdSiblingPathFor", () => {
  it("maps the six marketing pages", () => {
    expect(mdSiblingPathFor("/")).toBe("/index.md");
    expect(mdSiblingPathFor("/about")).toBe("/about.md");
    expect(mdSiblingPathFor("/faq")).toBe("/faq.md");
    expect(mdSiblingPathFor("/contact")).toBe("/contact.md");
    expect(mdSiblingPathFor("/privacy")).toBe("/privacy.md");
    expect(mdSiblingPathFor("/terms")).toBe("/terms.md");
  });

  it.each(["/ar", "/ar/about", "/app/al-fatihah", "/about/", "/about.md", "/llms.txt", "/x"])(
    "rejects %s",
    (pathname) => {
      expect(mdSiblingPathFor(pathname)).toBeNull();
    },
  );
});

describe("accept-parse negotiateMarkdownPath", () => {
  it("passes through non-negotiable paths regardless of Accept", () => {
    expect(negotiateMarkdownPath("/app/1", "text/markdown")).toEqual({ kind: "passthrough" });
    expect(negotiateMarkdownPath("/ar/about", "text/markdown")).toEqual({ kind: "passthrough" });
  });

  it("serves markdown when preferred", () => {
    expect(negotiateMarkdownPath("/", "text/markdown")).toEqual({
      kind: "markdown",
      mdPath: "/index.md",
    });
    expect(negotiateMarkdownPath("/about", "text/markdown, text/html;q=0.8")).toEqual({
      kind: "markdown",
      mdPath: "/about.md",
    });
  });

  it("passes through browser and default accepts", () => {
    expect(negotiateMarkdownPath("/", CHROME_ACCEPT)).toEqual({ kind: "passthrough" });
    expect(negotiateMarkdownPath("/", null)).toEqual({ kind: "passthrough" });
    expect(negotiateMarkdownPath("/", "*/*")).toEqual({ kind: "passthrough" });
  });

  it("rejects unsatisfiable accepts with 406 material", () => {
    const decision = negotiateMarkdownPath("/faq", "application/pdf");
    expect(decision).toEqual({ kind: "not-acceptable", accept: "application/pdf" });
    expect(notAcceptableBody("application/pdf")).toContain("text/html");
    expect(notAcceptableBody("application/pdf")).toContain("text/markdown");
    expect(notAcceptableBody("application/pdf")).toContain("application/pdf");
  });
});
