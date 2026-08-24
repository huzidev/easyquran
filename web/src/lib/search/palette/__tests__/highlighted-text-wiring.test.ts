import { describe, expect, it } from "vite-plus/test";

/**
 * Translation hits must render LTR through `HighlightedText`. It is dead code
 * unless wired at both ends: the palette row renders it for previews carrying
 * `dir`, and `translation-text.ts` stamps `dir` on the preview — no `dir` means
 * `HighlightedArabic` (hardcoded `lang="ar" dir="rtl"` + Arabic font). Either
 * end breaking silently reverts translation previews to RTL Arabic rendering,
 * so both are guarded textually, same pattern as `lazy-palette.test.ts`.
 */
// SAFETY: glob uses query "?raw" + import "default", so every matched module's
// default export is its own source text — vite-plus infers string.
const sources = import.meta.glob("../../../**/*.{svelte,ts}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const basename = (path: string): string => path.split("/").pop() ?? path;

function requireSource(name: string): string {
  const entry = Object.entries(sources).find(([path]) => basename(path) === name);
  expect(entry, `${name} should exist`).toBeDefined();
  return entry![1];
}

describe("HighlightedText renders translation previews", () => {
  it("GlobalSearchPalette imports it and gates it on the preview dir", () => {
    const palette = requireSource("GlobalSearchPalette.svelte");
    expect(palette).toMatch(
      /import\s+HighlightedText\s+from\s+["']\$lib\/components\/text\/HighlightedText\.svelte["']/,
    );
    expect(palette).toMatch(/\{#if entry\.preview\?\.dir\}[\s\S]*?<HighlightedText/);
    expect(palette).toMatch(/\{:else if entry\.preview\}[\s\S]*?<HighlightedArabic/);
  });

  it("translation-text.ts stamps preview dir so LTR rows reach it", () => {
    expect(requireSource("translation-text.ts")).toContain("dir: scope.direction");
  });

  it("HighlightedText applies the stamped dir itself", () => {
    const source = requireSource("HighlightedText.svelte");
    expect(source).toContain("<span {dir}");
    expect(source).not.toContain("font-arabic");
  });

  it("stays out of the text barrel — palette-tree-only import keeps it lazy", () => {
    const barrel = Object.entries(sources).find(([path]) => path.endsWith("/text/index.ts"));
    expect(barrel, "components/text/index.ts should exist").toBeDefined();
    expect(barrel![1]).not.toContain("HighlightedText");
  });
});
