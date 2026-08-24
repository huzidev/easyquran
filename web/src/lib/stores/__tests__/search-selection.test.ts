import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";

const flag = vi.hoisted(() => ({ value: true }));
vi.mock("$app/environment", () => ({
  get browser() {
    return flag.value;
  },
}));

import { SearchSelectionStore } from "../search-selection.svelte";

const KEY = "easyquran.search.selection";

describe("SearchSelectionStore", () => {
  let store: SearchSelectionStore;

  beforeEach(() => {
    flag.value = true;
    window.localStorage.clear();
    store = new SearchSelectionStore();
  });
  afterEach(() => store.dispose());

  const read = (): { v: number; ids: string[] } | null =>
    JSON.parse(window.localStorage.getItem(KEY) ?? "null");

  it("starts empty and persists nothing until written", () => {
    expect(store.ids).toEqual([]);
    expect(read()).toBeNull();
  });

  it("setIds persists {v:1,ids} and is readable by a fresh instance", () => {
    store.setIds(["en.sahih", "fr.hamidullah"]);
    expect(read()).toEqual({ v: 1, ids: ["en.sahih", "fr.hamidullah"] });
    const fresh = new SearchSelectionStore();
    expect(fresh.ids).toEqual(["en.sahih", "fr.hamidullah"]);
    fresh.dispose();
  });

  it("setIds dedupes preserving first occurrence", () => {
    store.setIds(["en.sahih", "en.sahih", "fr.hamidullah"]);
    expect(store.ids).toEqual(["en.sahih", "fr.hamidullah"]);
  });

  it("setIds has no cap — a dozen ids all persist", () => {
    const many = Array.from({ length: 12 }, (_, i) => `en.${i}`);
    store.setIds(many);
    expect(store.ids).toEqual(many);
    expect(store.ids.length).toBe(12);
  });

  it("toggle adds then removes", () => {
    store.toggle("en.sahih");
    expect(store.ids).toEqual(["en.sahih"]);
    store.toggle("en.sahih");
    expect(store.ids).toEqual([]);
  });

  it("remove drops an id", () => {
    store.setIds(["a", "b", "c"]);
    store.remove("b");
    expect(store.ids).toEqual(["a", "c"]);
  });

  it("clear empties the store and persists the empty shape", () => {
    store.setIds(["a", "b"]);
    store.clear();
    expect(store.ids).toEqual([]);
    expect(read()).toEqual({ v: 1, ids: [] });
  });

  it("decodes a future-schema blob to []", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 99, ids: ["en.sahih"] }));
    const fresh = new SearchSelectionStore();
    expect(fresh.ids).toEqual([]);
    fresh.dispose();
  });

  it("decodes a non-array ids field to []", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, ids: "nope" }));
    const fresh = new SearchSelectionStore();
    expect(fresh.ids).toEqual([]);
    fresh.dispose();
  });

  it("filters non-string junk elements during decode", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, ids: ["en.sahih", 42, null, "fr.hamidullah"] }),
    );
    const fresh = new SearchSelectionStore();
    expect(fresh.ids).toEqual(["en.sahih", "fr.hamidullah"]);
    fresh.dispose();
  });

  it("decodes a versionless legacy blob tolerantly", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ids: ["en.sahih"] }));
    const fresh = new SearchSelectionStore();
    expect(fresh.ids).toEqual(["en.sahih"]);
    fresh.dispose();
  });

  it("reconciles from a foreign-tab storage event", () => {
    store.setIds(["en.sahih"]);
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, ids: ["fr.hamidullah", "en.itani"] }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(store.ids).toEqual(["fr.hamidullah", "en.itani"]);
  });

  it("ignores storage events for other keys", () => {
    store.setIds(["en.sahih"]);
    window.dispatchEvent(new StorageEvent("storage", { key: "easyquran.prefs" }));
    expect(store.ids).toEqual(["en.sahih"]);
  });

  it("dispose detaches the cross-tab listener", () => {
    store.setIds(["en.sahih"]);
    store.dispose();
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, ids: ["fr.hamidullah"] }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(store.ids).toEqual(["en.sahih"]);
  });
});
