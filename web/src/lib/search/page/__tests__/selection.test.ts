import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$env/dynamic/public", () => ({ env: {} }));

import { TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";

import { batchPlan, partitionSearchable, resolveDefaultSelection, SEARCH_BATCH_SIZE } from "../selection";

const LTR = "en.sahih";
const LTR_2 = "fr.hamidullah";
const LTR_3 = "nl.keyzer";
const RTL = "ar.jalalayn";
const RTL_2 = "ar.muyassar";
const UNKNOWN = "xx.nope";

function input(overrides: Partial<Parameters<typeof resolveDefaultSelection>[0]> = {}) {
  return {
    urlT: [],
    persisted: [],
    lastReadSourceId: undefined,
    stackedIds: [],
    ...overrides,
  };
}

describe("resolveDefaultSelection", () => {
  it("returns [] when nothing qualifies", () => {
    expect(resolveDefaultSelection(input())).toEqual([]);
  });

  it("prefers the validated ?t list over everything", () => {
    expect(
      resolveDefaultSelection(
        input({ urlT: [LTR], persisted: [LTR_2], lastReadSourceId: LTR_3, stackedIds: [RTL] }),
      ),
    ).toEqual([LTR]);
  });

  it("falls back to the persisted selection, re-validated against the catalogue", () => {
    expect(
      resolveDefaultSelection(input({ persisted: [RTL, LTR_2, UNKNOWN] })),
    ).toEqual([LTR_2]);
  });

  it("skips an all-RTL persisted selection instead of returning it", () => {
    expect(resolveDefaultSelection(input({ persisted: [RTL, RTL_2] }))).toEqual([]);
  });

  it("falls back to the last-read source when it is a searchable translation", () => {
    expect(resolveDefaultSelection(input({ lastReadSourceId: LTR }))).toEqual([LTR]);
  });

  it("ignores an RTL or unknown last-read source", () => {
    expect(resolveDefaultSelection(input({ lastReadSourceId: RTL }))).toEqual([]);
    expect(resolveDefaultSelection(input({ lastReadSourceId: UNKNOWN }))).toEqual([]);
  });

  it("falls back to the first LTR stacked translation", () => {
    expect(resolveDefaultSelection(input({ stackedIds: [RTL, LTR_2, LTR] }))).toEqual([LTR_2]);
  });

  it("returns [] when stacked ids are all RTL or unknown", () => {
    expect(resolveDefaultSelection(input({ stackedIds: [RTL, UNKNOWN] }))).toEqual([]);
  });
});

describe("partitionSearchable", () => {
  it("splits LTR from RTL and drops unknown ids", () => {
    expect(partitionSearchable([LTR, RTL, UNKNOWN, LTR_2], TRANSLATION_CATALOGUE_BY_ID)).toEqual({
      searchable: [LTR, LTR_2],
      disabled: [RTL],
    });
  });
});

describe("batchPlan", () => {
  it("chunks into batches of at most SEARCH_BATCH_SIZE (3)", () => {
    const ids = [LTR, LTR_2, LTR_3, RTL, RTL_2];
    expect(batchPlan(ids, SEARCH_BATCH_SIZE)).toEqual([
      [LTR, LTR_2, LTR_3],
      [RTL, RTL_2],
    ]);
  });

  it("emits one short batch for fewer items than the batch size", () => {
    expect(batchPlan([LTR, LTR_2], SEARCH_BATCH_SIZE)).toEqual([[LTR, LTR_2]]);
  });

  it("returns [] for empty input or a non-positive size", () => {
    expect(batchPlan([], SEARCH_BATCH_SIZE)).toEqual([]);
    expect(batchPlan([LTR], 0)).toEqual([]);
  });
});
