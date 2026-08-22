import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$app/environment", () => ({ dev: false }));
vi.mock("$env/dynamic/public", () => ({ env: {} }));

import { htmlToMarkdown, renderLlmsIndex } from "$lib/seo/render";

describe("renderLlmsIndex", () => {
  const llms = renderLlmsIndex();

  it("starts with the site heading and a blockquote summary", () => {
    const lines = llms.split("\n");
    expect(lines[0]).toBe("# easyquran.fyi");
    expect(lines[1]).toBe("");
    expect(lines[2]?.startsWith("> ")).toBe(true);
  });

  it("documents when to use and how to call", () => {
    expect(llms).toContain("## When to use");
    expect(llms).toContain("## How to call");
  });

  it("documents juz and mushaf page URL patterns", () => {
    expect(llms).toContain("/app/juz/");
    expect(llms).toContain("/app/page/");
  });

  it("documents markdown negotiation for every route, reader included", () => {
    expect(llms).toContain("send `Accept: text/markdown` or append `.md` to the path");
    expect(llms).not.toContain("HTML-only");
  });

  it("resolves every list link to an absolute site URL", () => {
    for (const line of llms.split("\n")) {
      if (!line.startsWith("- [")) continue;
      const href = line.match(/\]\(([^)]+)\)/)?.[1];
      expect(href).toBeDefined();
      expect(href?.startsWith("https://easyquran.fyi")).toBe(true);
    }
  });
});

describe("htmlToMarkdown", () => {
  it("converts a main element to markdown", () => {
    const md = htmlToMarkdown("<main><h1>Hi</h1><p>there</p></main>");
    expect(md).toContain("# Hi");
    expect(md).toContain("there");
  });
});
