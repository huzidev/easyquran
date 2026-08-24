import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const SRC_ROOT = join(process.cwd(), "src");

function collectSources(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".svelte-kit") continue;
    // SAFETY: entries come from readdirSync of repo-owned directories; statSync follows each one.
    if (statSync(full).isDirectory()) {
      collectSources(full, out);
      continue;
    }
    if (!name.endsWith(".svelte") && !name.endsWith(".ts")) continue;
    out.set(full.slice(SRC_ROOT.length), readFileSync(full, "utf-8"));
  }
  return out;
}

const sources = collectSources(SRC_ROOT);

const SEARCH_COMPONENTS = [
  "SearchControls.svelte",
  "TranslationPicker.svelte",
  "TranslationRow.svelte",
  "ResultSection.svelte",
  "AyahResult.svelte",
  "SurahSuggestions.svelte",
  "NavSuggestions.svelte",
] as const;

const SEARCH_DIR = "app/search/";

const HEAVY_STATIC_IMPORT =
  /import\s+(?:[A-Za-z0-9_$ {},*]*from\s*)?["'](?:bits-ui(?:\/[^"']*)?|@fontsource\/[^"']+|chart\.js|echarts|d3(?:-[^"']*)?|three(?:\/[^"']*)?)["']/u;

const ROUTE_COMPONENT_IMPORT = new RegExp(
  `import\\s+\\w+\\s+from\\s+["'][^"']*search/_components/(?:${SEARCH_COMPONENTS.map((name) => name.replace(".", "\\.")).join("|")})["']`,
  "u",
);

describe("search route chunk isolation", () => {
  it("route components are referenced only from inside the search route", () => {
    const outside = [...sources].filter(
      ([path, src]) => !path.includes(SEARCH_DIR) && ROUTE_COMPONENT_IMPORT.test(src),
    );
    expect(
      outside.map(([path]) => path),
      "search route components may only be imported by the search route",
    ).toEqual([]);
  });

  it("every route component is statically imported inside the search route", () => {
    const routeFiles = [...sources].filter(([path]) => path.includes(SEARCH_DIR));
    expect(routeFiles, "expected the search route tree to be present").not.toEqual([]);
    for (const name of SEARCH_COMPONENTS) {
      const imported = routeFiles.some(([, src]) =>
        new RegExp(`import\\s+\\w+\\s+from\\s+["'][^"']*${name.replace(".", "\\.")}["']`, "u").test(
          src,
        ),
      );
      expect(imported, `no search route file statically imports ${name}`).toBe(true);
    }
  });

  it("the page statically imports the components it renders", () => {
    const page = [...sources].find(([path]) => path.endsWith(`${SEARCH_DIR}+page.svelte`));
    expect(page, "search +page.svelte should exist").toBeDefined();
    for (const name of [
      "SearchControls",
      "TranslationPicker",
      "SurahSuggestions",
      "NavSuggestions",
      "ResultSection",
    ]) {
      expect(
        page![1],
        `+page.svelte must keep importing ${name} statically`,
      ).toMatch(new RegExp(`import\\s+\\w+\\s+from\\s+"\\./_components/${name}\\.svelte"`, "u"));
    }
  });

  it("search route files carry no static heavy-package imports", () => {
    const offenders = [...sources]
      .filter(([path]) => path.includes(SEARCH_DIR))
      .filter(([, src]) => HEAVY_STATIC_IMPORT.test(src))
      .map(([path]) => path);
    expect(
      offenders,
      "heavy packages (bits-ui, @fontsource files, chart libs) may only reach the search route via dynamic import",
    ).toEqual([]);
  });

  it("search route files never import palette modules", () => {
    const offenders = [...sources]
      .filter(([path]) => path.includes(SEARCH_DIR) && !path.includes("__tests__"))
      .filter(([, src]) => src.includes("$lib/search/palette"))
      .map(([path]) => path);
    expect(
      offenders,
      "the palette is lazy; the search page must call quranSearch/quranWorker directly",
    ).toEqual([]);
  });

  it("shared chrome never imports search route modules or the search copy chunk", () => {
    const chromePaths = [
      "lib/components/nav/Nav.svelte",
      "lib/components/tweaks/Tweaks.svelte",
      "routes/+layout.svelte",
      "_components/MarketingTweaks.svelte",
    ];
    for (const suffix of chromePaths) {
      const entry = [...sources].find(([path]) => path.endsWith(suffix));
      expect(entry, `${suffix} should exist`).toBeDefined();
      const src = entry![1];
      expect(src, `${suffix} must not statically import a search route module`).not.toMatch(
        /import[^"']*["'][^"']*app\/search/,
      );
      expect(src, `${suffix} must not dynamically import a search route module`).not.toMatch(
        /import\([^)]*app\/search/,
      );
      expect(src, `${suffix} must not import the lazy search copy chunk`).not.toContain(
        "$lib/i18n/search-copy",
      );
    }
  });

  it("the search page resolves copy through the resolver, never raw paraglide", () => {
    const page = [...sources].find(([path]) => path.endsWith(`${SEARCH_DIR}+page.svelte`));
    expect(page, "search +page.svelte should exist").toBeDefined();
    expect(page![1]).toContain("getSearchCopy");
    expect(page![1]).not.toContain("$lib/paraglide");
    expect(page![1]).not.toContain("messages.js");
  });

  it("the search route never contributes a prerendered /app/**/__data.json", () => {
    const searchFiles = [...sources.keys()].filter((path) => path.includes(SEARCH_DIR));
    expect(searchFiles, "expected the search route tree to be present").not.toEqual([]);
    expect(
      searchFiles.filter((path) => path.endsWith("+page.server.ts")),
      "search route must have no +page.server.ts",
    ).toEqual([]);
    expect(
      searchFiles.filter(
        (path) =>
          path.endsWith("+page.ts") &&
          /export\s+(?:async\s+)?function\s+load/u.test(sources.get(path) ?? ""),
      ),
      "search +page.ts must stay a pure route-option module",
    ).toEqual([]);
    const pageOptions = [...sources].find(([path]) => path.endsWith(`${SEARCH_DIR}+page.ts`));
    expect(pageOptions, "search +page.ts should exist").toBeDefined();
    expect(pageOptions![1]).toContain("prerender = false");
  });
});
