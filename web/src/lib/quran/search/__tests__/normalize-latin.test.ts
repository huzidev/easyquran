import { highlightSegments } from "$lib/quran/search/highlights";
import {
  containsArabicScript,
  isEligibleLatinQuery,
  normalizeLatin,
  normalizeLatinWithMap,
  type NormalizedLatinMap,
} from "$lib/quran/search/normalize-latin";
import { describe, expect, it } from "vite-plus/test";

function spansFor(map: NormalizedLatinMap, needle: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  while (from <= map.normalized.length - needle.length) {
    const start = map.normalized.indexOf(needle, from);
    if (start < 0) break;
    const last = start + needle.length - 1;
    spans.push({ start: map.starts[start]!, end: map.ends[last]! });
    from = start + needle.length;
  }
  return spans;
}

describe("normalizeLatin", () => {
  it("case-folds and trims", () => {
    expect(normalizeLatin("  Mercy  ")).toBe("mercy");
  });

  it("strips NFD accents from composed input", () => {
    expect(normalizeLatin("mécréant")).toBe("mecreant");
  });

  it("treats NFC-composed and NFD-decomposed input as the same match surface", () => {
    const nfc = "mércy";
    const nfd = "mércy";
    expect(normalizeLatin(nfd)).toBe("mercy");
    expect(normalizeLatin(nfd)).toBe(normalizeLatin(nfc));
  });

  it("folds curly quotes to ASCII", () => {
    expect(normalizeLatin("don’t “seek” mercy")).toBe("don't \"seek\" mercy");
  });

  it("folds typographic dashes to ASCII hyphen", () => {
    expect(normalizeLatin("ar–rahman")).toBe("ar-rahman");
    expect(normalizeLatin("ar—rahman")).toBe("ar-rahman");
    expect(normalizeLatin("ar−rahman")).toBe("ar-rahman");
  });

  it("collapses whitespace runs to single spaces", () => {
    expect(normalizeLatin("the \t\n merciful")).toBe("the merciful");
    expect(normalizeLatin("   mercy \n")).toBe("mercy");
  });
  it("folds Greek final sigma symmetrically with uppercase input", () => {
    expect(normalizeLatin("ΑΣ")).toBe("ασ");
    expect(normalizeLatin("ας")).toBe("ασ");
    expect(normalizeLatin("ΑΣ")).toBe(normalizeLatin("ας"));
    expect(normalizeLatin("θεοσ")).toBe(normalizeLatin("θεος"));
  });
});

describe("normalizeLatinWithMap", () => {
  it("index-maps every normalized char onto original utf-16 offsets", () => {
    const map = normalizeLatinWithMap("Mércy — MERCY");
    expect(map.normalized).toBe("mercy - mercy");
    expect(map.starts.length).toBe(map.normalized.length);
    expect(map.ends.length).toBe(map.normalized.length);
    for (let i = 0; i < map.normalized.length; i++) {
      expect(map.starts[i]!).toBeLessThan(map.ends[i]!);
    }
  });

  it("lands highlights on the right original spans", () => {
    const original = "Mércy — MERCY";
    const map = normalizeLatinWithMap(original);
    const segments = highlightSegments(original, spansFor(map, "mercy"));
    expect(segments.filter((segment) => segment.highlighted).map((segment) => segment.text)).toEqual(
      ["Mércy", "MERCY"],
    );
    expect(segments.map((segment) => segment.text).join("")).toBe(original);
  });

  it("keeps combining marks inside the highlighted span for decomposed input", () => {
    const original = "mércy and mércy";
    const map = normalizeLatinWithMap(original);
    expect(map.normalized).toBe("mercy and mercy");
    const segments = highlightSegments(original, spansFor(map, "mercy"));
    expect(segments.filter((segment) => segment.highlighted).map((segment) => segment.text)).toEqual([
      "mércy",
      "mércy",
    ]);
  });

  it("emits distinct spans per occurrence", () => {
    const map = normalizeLatinWithMap("mercy, mercy, mercy");
    expect(spansFor(map, "mercy")).toHaveLength(3);
  });

  it("packs the offset maps as uint16 arrays", () => {
    const map = normalizeLatinWithMap("Mércy — MERCY");
    expect(map.starts).toBeInstanceOf(Uint16Array);
    expect(map.ends).toBeInstanceOf(Uint16Array);
    expect(map.starts.byteLength).toBe(map.starts.length * 2);
    expect(map.ends.byteLength).toBe(map.ends.length * 2);
  });

  it("accepts a unit at the uint16 offset ceiling", () => {
    const map = normalizeLatinWithMap("m".repeat(65535));
    expect(map.normalized.length).toBe(65535);
    expect(map.ends[65534]).toBe(65535);
  });

  it("throws when a unit exceeds the uint16 offset ceiling", () => {
    expect(() => normalizeLatinWithMap("m".repeat(65536))).toThrow(/offset map capacity/);
  });
});

describe("isEligibleLatinQuery", () => {
  it("enforces the shared 3–64 length bounds", () => {
    expect(isEligibleLatinQuery("me")).toBe(false);
    expect(isEligibleLatinQuery("mer")).toBe(true);
    expect(isEligibleLatinQuery("a".repeat(64))).toBe(true);
    expect(isEligibleLatinQuery("a".repeat(65))).toBe(false);
    expect(isEligibleLatinQuery("")).toBe(false);
  });
});

describe("containsArabicScript", () => {
  it("detects Arabic script anywhere in the text", () => {
    expect(containsArabicScript("mercy")).toBe(false);
    expect(containsArabicScript("")).toBe(false);
    expect(containsArabicScript("surah الفاتحة")).toBe(true);
    expect(containsArabicScript("بِسْمِ")).toBe(true);
  });
});
