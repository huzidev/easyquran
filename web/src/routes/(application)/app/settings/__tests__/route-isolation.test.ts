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

const SECTION_COMPONENTS = [
  "StorageSection.svelte",
  "AppearanceSection.svelte",
  "ReadingSection.svelte",
  "PrivacySection.svelte",
  "AccountSection.svelte",
] as const;

const SETTINGS_DIR = "app/settings/";

const HEAVY_STATIC_IMPORT =
  /import\s+(?:[A-Za-z0-9_$ {},*]*from\s*)?["'](?:bits-ui(?:\/[^"']*)?|@fontsource\/[^"']+|chart\.js|echarts|d3(?:-[^"']*)?|three(?:\/[^"']*)?)["']/u;

describe("settings route chunk isolation", () => {
  it("section components are referenced only from inside the settings route", () => {
    const outside = [...sources].filter(
      ([path, src]) =>
        !path.includes(SETTINGS_DIR) &&
        !path.includes("__tests__") &&
        SECTION_COMPONENTS.some((name) => src.includes(name)),
    );
    expect(
      outside.map(([path]) => path),
      "settings section components may only be imported by the settings route",
    ).toEqual([]);
  });

  it("the settings shell statically imports every section (route-chunk contract, not per-section loaders)", () => {
    const page = [...sources].find(([path]) => path.endsWith(`${SETTINGS_DIR}+page.svelte`));
    expect(page, "settings +page.svelte should exist").toBeDefined();
    for (const name of SECTION_COMPONENTS) {
      expect(
        page![1],
        `+page.svelte must keep importing ${name} statically`,
      ).toMatch(new RegExp(`import\\s+\\w+\\s+from\\s+"\\./_components/${name}"`, "u"));
    }
  });

  it("settings route files carry no static heavy-package imports", () => {
    const offenders = [...sources]
      .filter(([path]) => path.includes(SETTINGS_DIR))
      .filter(([, src]) => HEAVY_STATIC_IMPORT.test(src))
      .map(([path]) => path);
    expect(
      offenders,
      "heavy packages (bits-ui, @fontsource files, chart libs) may only reach the settings route via dynamic import",
    ).toEqual([]);
  });

  it("shared chrome and the reader tweaks panel never import settings modules", () => {
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
      expect(src, `${suffix} must not statically import a settings route module`).not.toMatch(
        /import[^"']*["'][^"']*app\/settings/,
      );
      expect(src, `${suffix} must not dynamically import a settings route module`).not.toMatch(
        /import\([^)]*app\/settings/,
      );
    }
  });

  it("the settings page resolves copy through the resolver, never raw paraglide", () => {
    const page = [...sources].find(([path]) => path.endsWith(`${SETTINGS_DIR}+page.svelte`));
    expect(page, "settings +page.svelte should exist").toBeDefined();
    expect(page![1]).toContain("getSettingsCopy");
    expect(page![1]).not.toContain("$lib/paraglide");
    expect(page![1]).not.toContain("messages.js");
  });

  it("the settings route never contributes a prerendered /app/**/__data.json", () => {
    const settingsFiles = [...sources.keys()].filter((path) => path.includes(SETTINGS_DIR));
    expect(settingsFiles, "expected the settings route tree to be present").not.toEqual([]);
    expect(
      settingsFiles.filter((path) => path.endsWith("+page.server.ts")),
      "settings route must have no +page.server.ts",
    ).toEqual([]);
    expect(
      settingsFiles.filter(
        (path) =>
          path.endsWith("+page.ts") &&
          /export\s+(?:async\s+)?function\s+load/u.test(sources.get(path) ?? ""),
      ),
      "settings +page.ts must stay a pure route-option module",
    ).toEqual([]);
    const pageOptions = [...sources].find(([path]) => path.endsWith(`${SETTINGS_DIR}+page.ts`));
    expect(pageOptions, "settings +page.ts should exist").toBeDefined();
    expect(pageOptions![1]).toContain("prerender = false");
  });
});

describe("settings storage delete-flow guards", () => {
  const findSource = (name: string): [string, string] | undefined =>
    [...sources].find(([path]) => path.endsWith(`${SETTINGS_DIR}_components/${name}`));

  it("row confirm keeps the Escape guard and a single live announcer", () => {
    const row = findSource("StorageArtifactRow.svelte");
    expect(row, "StorageArtifactRow.svelte should exist").toBeDefined();
    expect(row![1]).toContain("onkeydown={onKeydown}");
    expect(row![1]).toContain('event.key === "Escape"');
    expect(row![1]).toContain("event.stopPropagation()");
    expect(row![1]).toContain('aria-live="polite"');
    expect(row![1].match(/aria-live="polite"/gu)?.length ?? 0).toBe(1);
  });

  it("delete outcomes map to distinct copy keys", () => {
    const row = findSource("StorageArtifactRow.svelte");
    expect(row, "StorageArtifactRow.svelte should exist").toBeDefined();
    expect(row![1]).toContain('if (outcome === "arabic") errorText = copy.arabicError');
    expect(row![1]).toContain('else if (outcome === "busy") errorText = copy.busyError');
    expect(row![1]).toContain("copy.error");
  });

  it("remove-all surfaces worker refusals instead of a bare freed summary", () => {
    const section = findSource("StorageSection.svelte");
    expect(section, "StorageSection.svelte should exist").toBeDefined();
    expect(section![1]).toContain("result.failures");
    expect(section![1]).toContain("copy.busyError");
  });

  it("section-level remove-all confirm keeps the Escape guard and focus cycle", () => {
    const section = findSource("StorageSection.svelte");
    expect(section, "StorageSection.svelte should exist").toBeDefined();
    expect(section![1]).toContain("onkeydown={onKeydown}");
    expect(section![1]).toContain('event.key === "Escape"');
    expect(section![1]).toContain("event.stopPropagation()");
    expect(section![1]).toContain("refocusRemoveAll = true");
    expect(section![1]).toContain("confirmAllButton.focus()");
    expect(section![1]).toContain("removeAllButton.focus()");
    expect(section![1]).toContain("copy.removed(artifactName(artifactId))");
    expect(section![1]).toContain("downloadsHeading?.focus()");
    expect(section![1]).toContain("disabled={!hasController || clearingPages}");
  });

  it("the in-use guard joins reader primary and stacked translation ids", () => {
    const section = findSource("StorageSection.svelte");
    expect(section, "StorageSection.svelte should exist").toBeDefined();
    expect(section![1]).toContain("readerSource.sourceId");
    expect(section![1]).toContain("stackedTranslations.ids");
    expect(section![1]).toContain("inUse={inUseIds.has(artifact.id)}");
    const row = findSource("StorageArtifactRow.svelte");
    expect(row, "StorageArtifactRow.svelte should exist").toBeDefined();
    expect(row![1]).toContain("disabled={inUse}");
  });
});

describe("settings URL param suppression", () => {
  it("the app layout keeps reader ?mode/?more replaceState off /app/settings", () => {
    const layout = [...sources].find(([path]) =>
      path.endsWith("(application)/app/+layout.svelte"),
    );
    expect(layout, "app/+layout.svelte should exist").toBeDefined();
    const src = layout![1];
    expect(src).toContain('endsWith("/app/settings")');
    expect(
      src.match(/if \(onSettingsRoute\) return;/gu)?.length ?? 0,
      "both the ?mode and ?more effects must keep their settings-route early return",
    ).toBe(2);
    expect(src).toContain('onSettingsRoute ? "/app" : canonicalReaderHref');
  });
});
