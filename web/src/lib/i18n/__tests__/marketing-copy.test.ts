import { readFileSync } from "node:fs";

import { resolveAppearanceCopy } from "$lib/i18n/appearance-copy";
import { marketingFooterLinks, resolveChromeCopy } from "$lib/i18n/chrome-copy";
import { resolveLandingCopy, resolveLandingSeoCopy } from "$lib/i18n/landing-copy";
import {
  marketingHomeHref,
  marketingLocaleFromPath,
  marketingLocaleLinks,
  marketingReaderHomeHref,
} from "$lib/i18n/marketing-copy";
import { describe, expect, it } from "vite-plus/test";

type Variant = {
  readonly declarations?: readonly string[];
  readonly match?: Record<string, string>;
};
type Catalog = Record<string, string | Variant[]>;

function readJson(path: string): Catalog {
  // SAFETY: messages/*.json values are translation strings or paraglide plural variant blocks; the parity tests below cover both shapes.
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Catalog;
}

function parameters(value: string): string[] {
  return [...value.matchAll(/\{([a-z]+)\}/gi)].map((match) => match[1]!).sort();
}

function arms(value: string | Variant[]): string[] {
  if (Array.isArray(value)) return value.flatMap((variant) => Object.values(variant.match ?? {}));
  return [value];
}

function text(value: string | Variant[]): string {
  if (Array.isArray(value)) throw new Error("expected plain message text");
  return value;
}

describe("marketing message catalogs", () => {
  const english = readJson("../../../../messages/en.json");
  const arabic = readJson("../../../../messages/ar.json");

  it("keeps exact key and parameter parity", () => {
    expect(Object.keys(arabic).sort()).toEqual(Object.keys(english).sort());

    for (const key of Object.keys(english)) {
      const en = english[key]!;
      const ar = arabic[key]!;
      expect(Array.isArray(ar), key).toBe(Array.isArray(en));
      if (Array.isArray(en) && Array.isArray(ar)) {
        expect(ar.map((variant) => variant.declarations), key).toEqual(
          en.map((variant) => variant.declarations),
        );
        expect(ar.flatMap((variant) => Object.keys(variant.match ?? {})).sort(), key).toEqual(
          en.flatMap((variant) => Object.keys(variant.match ?? {})).sort(),
        );
        continue;
      }
      expect(parameters(text(ar)), key).toEqual(parameters(text(en)));
    }
  });

  it("contains non-empty plain text only", () => {
    for (const catalog of [english, arabic]) {
      for (const value of Object.values(catalog)) {
        for (const arm of arms(value)) {
          expect(arm.trim()).not.toBe("");
          expect(arm).not.toMatch(/<\/?[a-z][^>]*>/i);
        }
      }
    }
  });
});

describe("marketing copy resolvers", () => {
  it("resolves each locale explicitly without leaking prior calls", () => {
    const english = resolveChromeCopy("en");
    const arabic = resolveChromeCopy("ar");
    const englishLanding = resolveLandingCopy("en");
    const arabicLanding = resolveLandingCopy("ar");
    const englishLandingAgain = resolveLandingCopy("en");

    expect(english.direction).toBe("ltr");
    expect(arabic.direction).toBe("rtl");
    expect(arabicLanding.heroTitle).not.toBe(englishLanding.heroTitle);
    expect(englishLandingAgain.heroTitle).toBe(englishLanding.heroTitle);
    expect(resolveLandingSeoCopy("ar").title).not.toBe(resolveLandingSeoCopy("en").title);
  });

  it("keeps stable structural IDs across locales", () => {
    const english = resolveLandingCopy("en");
    const arabic = resolveLandingCopy("ar");

    expect(arabic.values.map((item) => item.id)).toEqual(english.values.map((item) => item.id));
    expect(arabic.roadmap.map((item) => item.id)).toEqual(english.roadmap.map((item) => item.id));
  });

  it("keeps the appearance panel out of the chrome resolver", () => {
    const chrome = resolveChromeCopy("en");

    expect(chrome.appearanceTrigger).toBe("Customize appearance");
    // Exact key set, so a namespace merged back into chrome fails here rather than silently
    // reappearing in every page's bundle.
    expect(Object.keys(chrome).sort()).toEqual([
      "appearanceTrigger",
      "brand",
      "direction",
      "footer",
      "locale",
      "nav",
      "skipToContent",
    ]);
  });

  it("uses typed parameterized messages for control labels", () => {
    const english = resolveAppearanceCopy("en");
    const arabic = resolveAppearanceCopy("ar");

    expect(english.colourInputLabel("Background")).toBe("Background colour");
    expect(arabic.colourInputLabel("الخلفية")).toBe("لون الخلفية");
    expect(arabic.toggleStatusLabel("التحليلات", "مفعّل")).toContain("التحليلات");
  });
});

describe("marketing locale links", () => {
  it("recognizes only the Arabic marketing prefix", () => {
    expect(marketingLocaleFromPath("/")).toBe("en");
    expect(marketingLocaleFromPath("/about")).toBe("en");
    expect(marketingLocaleFromPath("/ar/")).toBe("ar");
    expect(marketingLocaleFromPath("/arbitrary")).toBe("en");
  });

  it("uses canonical marketing and reader helpers", () => {
    expect(marketingHomeHref("en")).toBe("/");
    expect(marketingHomeHref("ar")).toBe("/ar/");
    expect(marketingReaderHomeHref("en")).toBe("/en/app");
    expect(marketingReaderHomeHref("ar")).toBe("/ar/app");
  });

  it("does not expose unpublished Arabic marketing links", () => {
    const links = marketingFooterLinks("ar");

    expect(links.company).toEqual([]);
    expect(links.legal).toEqual([]);
    expect(links.product.every((link) => link.href.startsWith("/ar/"))).toBe(true);
  });

  it("marks one locale switch link current", () => {
    const links = marketingLocaleLinks("ar");

    expect(links.filter((link) => link.current)).toHaveLength(1);
    expect(links.find((link) => link.current)?.locale).toBe("ar");
    expect(links.every((link) => link.label.length > 0)).toBe(true);
  });
});
