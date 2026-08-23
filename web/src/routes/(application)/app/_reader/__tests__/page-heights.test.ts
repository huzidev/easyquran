import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reader } from "$lib/stores/reader.svelte";
import { describe, expect, it } from "vite-plus/test";

import { PageHeightCache } from "../page-heights";

describe("PageHeightCache typography key", () => {
  it("namespaces measured heights by every typography axis", () => {
    const cache = new PageHeightCache();
    cache.save(3, 1234, 800);
    expect(cache.get(3, 800)).toBe(1234);
    expect(cache.get(3, 800)).toBe(1234);

    reader.setArabicFont("scheherazade-new");
    expect(cache.get(3, 800)).not.toBe(1234);
    reader.setArabicFont("amiri");
    expect(cache.get(3, 800)).toBe(1234);

    reader.growTranslation();
    expect(cache.get(3, 800)).not.toBe(1234);
    reader.shrinkTranslation();
    expect(cache.get(3, 800)).toBe(1234);

    reader.setTranslationFamily("serif");
    expect(cache.get(3, 800)).not.toBe(1234);
    reader.setTranslationFamily("sans");
    expect(cache.get(3, 800)).toBe(1234);

    reader.bigger();
    expect(cache.get(3, 800)).not.toBe(1234);
    reader.smaller();
    expect(cache.get(3, 800)).toBe(1234);
  });

  it("SurahReader remeasures through preserveViewport keyed on every typography axis", () => {
    const src = readFileSync(
      join(process.cwd(), "src/routes/(application)/app/_reader/SurahReader.svelte"),
      "utf-8",
    );
    expect(src).toContain(
      "${reader.arabicFont}:${reader.arabicSizePx}:${reader.translationSizePx}:${reader.translationFamily}",
    );
    expect(src).toContain("void preserveViewport(");
  });
});
