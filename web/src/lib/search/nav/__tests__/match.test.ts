import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$env/dynamic/public", () => ({ env: {} }));

import { createQuranData, type QuranData } from "$lib/data/quran-data";

import { SAJDA_ALIASES, SURAH_ALIASES, placeForAlias } from "../aliases";
import { isNavCandidate, matchNav, matchSajdas, splitPlaceToken } from "../match";
import { parseQuery } from "../parse";
import type { NavMatch } from "../types";

const DATA_PATH = [
  path.resolve(process.cwd(), "static/quran-meta/quran-data.json"),
  path.resolve(process.cwd(), "web/static/quran-meta/quran-data.json"),
].find((candidate) => existsSync(candidate));
if (!DATA_PATH) throw new Error("missing quran-data.json fixture");
const QURAN: QuranData = createQuranData(JSON.parse(readFileSync(DATA_PATH, "utf8")));

function targets(matches: readonly NavMatch[]): string[] {
  return matches.map((match) => match.id);
}

function firstTarget(matches: readonly NavMatch[]): NavMatch["target"] {
  const head = matches[0];
  if (head === undefined) throw new Error("expected at least one match");
  return head.target;
}

describe("matchNav — ayah references", () => {
  it.each(["2:255", "2 255", "2.255", "2-255", "surah 2 255", "٢:٢٥٥"])(
    "resolves %s to ayah 2:255",
    (query) => {
      const matches = matchNav(QURAN, query);
      expect(targets(matches)).toEqual(["ayah:2:255"]);
      expect(firstTarget(matches)).toMatchObject({ kind: "ayah", surah: 2, ayah: 255 });
    },
  );

  it("drops out-of-range ayah numbers", () => {
    expect(matchNav(QURAN, "1:8")).toEqual([]);
    expect(matchNav(QURAN, "2:287")).toEqual([]);
  });
});

describe("matchNav — surah numbers", () => {
  it("resolves a keyword-guarded surah number", () => {
    const matches = matchNav(QURAN, "surah 18");
    expect(targets(matches)).toEqual(["surah:18"]);
    expect(firstTarget(matches)).toMatchObject({ kind: "surah", surah: 18 });
  });

  it("resolves an Arabic-keyboard surah number", () => {
    expect(targets(matchNav(QURAN, "سورة ١٨"))).toEqual(["surah:18"]);
  });

  it("drops out-of-range surah numbers", () => {
    expect(matchNav(QURAN, "surah 115")).toEqual([]);
    expect(matchNav(QURAN, "surah 0")).toEqual([]);
  });
});

describe("matchNav — juz", () => {
  it("resolves keyword-guarded juz numbers with aliases and Arabic digits", () => {
    expect(targets(matchNav(QURAN, "juz 5"))).toEqual(["juz:5"]);
    expect(targets(matchNav(QURAN, "para 5"))).toEqual(["juz:5"]);
    expect(targets(matchNav(QURAN, "جزء ٥"))).toEqual(["juz:5"]);
  });

  it("drops out-of-range juz numbers", () => {
    expect(matchNav(QURAN, "juz 31")).toEqual([]);
    expect(matchNav(QURAN, "juz 0")).toEqual([]);
  });

  it("resolves juz nicknames anywhere in the query", () => {
    expect(targets(matchNav(QURAN, "amma"))).toEqual(["juz:30"]);
    expect(targets(matchNav(QURAN, "juz amma"))).toEqual(["juz:30"]);
    expect(targets(matchNav(QURAN, "ama"))).toEqual(["juz:30"]);
    expect(targets(matchNav(QURAN, "tabarak"))).toEqual(["juz:29"]);
    expect(targets(matchNav(QURAN, "mubarak"))).toEqual(["juz:29"]);
    expect(targets(matchNav(QURAN, "qad sama"))).toEqual(["juz:28"]);
    expect(firstTarget(matchNav(QURAN, "amma"))).toMatchObject({ kind: "juz", juz: 30 });
  });
});

describe("matchNav — mushaf pages", () => {
  it("resolves keyword-guarded pages with aliases and Arabic digits", () => {
    expect(targets(matchNav(QURAN, "page 100"))).toEqual(["page:100"]);
    expect(targets(matchNav(QURAN, "p 100"))).toEqual(["page:100"]);
    expect(targets(matchNav(QURAN, "صفحة ١٠٠"))).toEqual(["page:100"]);
  });

  it("drops out-of-range pages", () => {
    expect(matchNav(QURAN, "page 605")).toEqual([]);
    expect(matchNav(QURAN, "page 0")).toEqual([]);
  });
});

describe("matchNav — sajdas", () => {
  it("lists all fifteen sajdas for the bare keyword in index order", () => {
    const matches = matchNav(QURAN, "sajda", 20);
    expect(matches).toHaveLength(15);
    expect(matches.every((match) => match.score === 0.5)).toBe(true);
    const indexes = matches
      .map((match) => match.target)
      .filter((target): target is Extract<typeof target, { kind: "sajda" }> => target.kind === "sajda")
      .map((target) => target.index);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("covers both sajda kinds", () => {
    const kinds = new Set(
      matchNav(QURAN, "sajda", 20)
        .map((match) => match.target)
        .filter((target): target is Extract<typeof target, { kind: "sajda" }> => target.kind === "sajda")
        .map((target) => target.sajdaKind),
    );
    expect(kinds.has("recommended")).toBe(true);
    expect(kinds.has("obligatory")).toBe(true);
  });

  it("scopes to one surah's sajda when a number is present", () => {
    const matches = matchNav(QURAN, "sajda 7");
    expect(targets(matches)).toEqual(["sajda:7:206"]);
    expect(matches[0]?.score).toBe(1);
    expect(targets(matchNav(QURAN, "سجدة ٧"))).toEqual(["sajda:7:206"]);
  });

  it("resolves an exact sajda ayah ref", () => {
    expect(targets(matchNav(QURAN, "sajda 96:19"))).toEqual(["sajda:96:19"]);
  });

  it("returns nothing for a surah without a sajda", () => {
    expect(matchNav(QURAN, "sajda 1")).toEqual([]);
    expect(matchNav(QURAN, "sajda 2")).toEqual([]);
  });

  it("exposes matchSajdas for the palette source", () => {
    const all = matchSajdas(QURAN, parseQuery("sujud"));
    expect(all).toHaveLength(15);
    const scoped = matchSajdas(QURAN, parseQuery("سجده ٢٢"));
    expect(targets(scoped)).toEqual(["sajda:22:18", "sajda:22:77"]);
  });
});

describe("matchNav — bare numbers", () => {
  it("offers surah, juz and page in that order", () => {
    const matches = matchNav(QURAN, "5");
    expect(targets(matches)).toEqual(["surah:5", "juz:5", "page:5"]);
    expect(matches.map((match) => match.score)).toEqual([1, 0.9, 0.8]);
  });

  it("keeps only in-range targets", () => {
    expect(targets(matchNav(QURAN, "40"))).toEqual(["surah:40", "page:40"]);
    expect(targets(matchNav(QURAN, "200"))).toEqual(["page:200"]);
    expect(matchNav(QURAN, "9999")).toEqual([]);
  });
});

describe("matchNav — place facets", () => {
  it("splits place tokens wherever they sit", () => {
    expect(splitPlaceToken("meccan kahf")).toEqual({ place: "meccan", text: "kahf" });
    expect(splitPlaceToken("kahf meccan")).toEqual({ place: "meccan", text: "kahf" });
    expect(splitPlaceToken("مكية")).toEqual({ place: "meccan", text: "" });
    expect(splitPlaceToken("مدنية")).toEqual({ place: "medinan", text: "" });
    expect(splitPlaceToken("madani")).toEqual({ place: "medinan", text: "" });
    expect(splitPlaceToken("the cow")).toEqual({ place: null, text: "the cow" });
  });

  it("emits a place facet with the surah count", () => {
    const facet = matchNav(QURAN, "medinan").find((match) => match.id === "place:medinan");
    expect(facet?.target).toEqual({
      kind: "place",
      place: "medinan",
      surahCount: QURAN.surahs.filter((surah) => surah.place === "medinan").length,
    });
    const meccan = matchNav(QURAN, "meccan kahf").find((match) => match.id === "place:meccan");
    expect(meccan?.target).toMatchObject({ kind: "place", place: "meccan" });
  });
});

describe("matchNav — caps and empties", () => {
  it("caps the result list", () => {
    expect(matchNav(QURAN, "sajda", 5)).toHaveLength(5);
  });

  it("returns nothing for empty and non-coordinate queries", () => {
    expect(matchNav(QURAN, "")).toEqual([]);
    expect(matchNav(QURAN, "kahf")).toEqual([]);
    expect(matchNav(QURAN, "mercy")).toEqual([]);
  });
});

describe("isNavCandidate", () => {
  it("accepts short coordinate queries and rejects plain text", () => {
    expect(isNavCandidate("55")).toBe(true);
    expect(isNavCandidate("2:255")).toBe(true);
    expect(isNavCandidate("juz")).toBe(true);
    expect(isNavCandidate("s")).toBe(false);
    expect(isNavCandidate("ab")).toBe(false);
    expect(isNavCandidate("")).toBe(false);
  });
});

describe("aliases", () => {
  it("maps every place alias to its place", () => {
    expect(placeForAlias("meccan")).toBe("meccan");
    expect(placeForAlias("makkan")).toBe("meccan");
    expect(placeForAlias("madani")).toBe("medinan");
    expect(placeForAlias("مكية")).toBe("meccan");
    expect(placeForAlias("مدنيه")).toBe("medinan");
    expect(placeForAlias("kahf")).toBeNull();
    expect(SURAH_ALIASES).toContain("surah");
    expect(SAJDA_ALIASES).toContain("سجدة");
  });
});
