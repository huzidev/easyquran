import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const USAGE_BAR_PATH = join(
  process.cwd(),
  "src/routes/(application)/app/settings/_components/UsageBar.svelte",
);

const source = readFileSync(USAGE_BAR_PATH, "utf-8");

function layerFillEntries(): [string, string][] {
  const block = /const LAYER_FILL = \{([\s\S]*?)\};/u.exec(source);
  expect(block, "UsageBar must keep a LAYER_FILL constant").not.toBeNull();
  const body = block?.[1] ?? "";
  return [...body.matchAll(/(\w+):\s*"([^"]*)"/gu)].map((m) => [m[1]!, m[2]!]);
}

describe("UsageBar stays accessible and token-themed", () => {
  it("the stacked bar is role=img with a composed label and titles", () => {
    expect(source).toContain('role="img"');
    expect(source).toMatch(/aria-label=\{composedTitle\}/u);
    expect(source).toMatch(/<title>\{composedTitle\}<\/title>/u);
    expect(source).toMatch(/<title>\{segmentTitle\(segment\.layer\)\}<\/title>/u);
  });

  it("segment fills only use theme tokens, never raw colors", () => {
    const fills = layerFillEntries();
    expect(fills.length, "LAYER_FILL must cover every layer").toBeGreaterThanOrEqual(6);
    for (const [layer, fill] of fills) {
      expect(
        fill,
        `LAYER_FILL.${layer} must be a var(--…) token`,
      ).toMatch(/^var\(--[a-z0-9-]+\)$/u);
    }
    expect(source).toMatch(/url\(#usage-other-stripes\)/u);
    expect(source).not.toMatch(/fill="#/u);
    expect(source).not.toMatch(/fill="rgb/u);
  });
});
