import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$env/dynamic/public", () => ({ env: {} }));

import { parseSearchUrl, serializeSearchState } from "../query-url";

const LTR = "en.sahih";
const LTR_2 = "fr.hamidullah";
const RTL = "ar.jalalayn";

describe("parseSearchUrl", () => {
  it("returns empty state for a URL without search params", () => {
    expect(parseSearchUrl(new URL("https://easyquran.app/app/search"))).toEqual({ q: "", t: [] });
    expect(parseSearchUrl({ search: "" })).toEqual({ q: "", t: [] });
  });

  it("reads and trims q", () => {
    expect(parseSearchUrl({ search: "?q=++mercy+" }).q).toBe("mercy");
    expect(parseSearchUrl({ search: "?q=" }).q).toBe("");
  });

  it("splits a comma list of translation ids", () => {
    const state = parseSearchUrl({ search: `?t=${LTR},${LTR_2}` });
    expect(state.t).toEqual([LTR, LTR_2]);
  });

  it("drops unknown ids", () => {
    const state = parseSearchUrl({ search: `?t=${LTR},xx.nope,${LTR_2}` });
    expect(state.t).toEqual([LTR, LTR_2]);
  });

  it("drops RTL translation ids", () => {
    const state = parseSearchUrl({ search: `?t=${LTR},${RTL}` });
    expect(state.t).toEqual([LTR]);
  });

  it("uniqes duplicates preserving first occurrence", () => {
    const state = parseSearchUrl({ search: `?t=${LTR},${LTR_2},${LTR}` });
    expect(state.t).toEqual([LTR, LTR_2]);
  });

  it("tolerates stray commas and whitespace", () => {
    const state = parseSearchUrl({ search: `?t=, ${LTR} ,,` });
    expect(state.t).toEqual([LTR]);
  });

  it("accepts a URL instance and a {search} object identically", () => {
    const search = `?q=mercy&t=${LTR}`;
    expect(parseSearchUrl(new URL(`https://easyquran.app/app/search${search}`))).toEqual(
      parseSearchUrl({ search }),
    );
  });
});

describe("serializeSearchState", () => {
  it("omits empty parts", () => {
    expect(serializeSearchState("", [])).toBe("");
    expect(serializeSearchState("mercy", [])).toBe("?q=mercy");
    expect(serializeSearchState("", [LTR])).toBe(`?t=${LTR}`);
  });

  it("joins both parts and encodes the query", () => {
    expect(serializeSearchState("the mercy", [LTR, LTR_2])).toBe(
      `?q=the%20mercy&t=${LTR}%2C${LTR_2}`,
    );
  });

  it("round-trips through parseSearchUrl", () => {
    const cases: readonly { q: string; t: string[] }[] = [
      { q: "", t: [] },
      { q: "mercy", t: [] },
      { q: "", t: [LTR] },
      { q: "Indeed there has been", t: [LTR, LTR_2] },
    ];
    for (const state of cases) {
      const serialized = serializeSearchState(state.q, state.t);
      expect(parseSearchUrl({ search: serialized }), serialized).toEqual(state);
    }
  });
});
