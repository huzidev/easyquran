import { mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getSearchCopy } from "$lib/i18n/search-copy";
import { searchSelection } from "$lib/stores/search-selection.svelte";

interface ProgressEvent {
  script: string;
  loaded: number;
  total: number;
}

const h = vi.hoisted(() => {
  const listeners = new Set<(p: ProgressEvent) => void>();
  const artifacts: { id: string }[] = [];
  return {
    artifacts,
    ensureTranslation: vi.fn((_source: string) => Promise.resolve()),
    subscribe: (cb: (p: ProgressEvent) => void): (() => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(p: ProgressEvent): void {
      for (const cb of listeners) cb(p);
    },
  };
});

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$lib/quran/worker-client", () => ({
  quranWorker: {
    onProgress: (cb: (p: ProgressEvent) => void) => h.subscribe(cb),
    ensureTranslation: (source: string) => h.ensureTranslation(source),
  },
}));
vi.mock("$lib/stores/storage-report.svelte", () => ({
  storageReport: {
    get artifacts() {
      return h.artifacts;
    },
  },
}));

import TranslationPicker from "../_components/TranslationPicker.svelte";

const copy = getSearchCopy("en");

const CACHED = "en.sahih";
const UNCACHED = "en.ahmedraza";
const RTL = "ar.jalalayn";
const SELECTION_KEY = "easyquran.search.selection";

let target: HTMLElement;
let unmountPicker: () => void = () => {};

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function rowInput(id: string): HTMLInputElement {
  const el = target.querySelector(`input[id="search-t-${id}"]`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`missing picker row for ${id}`);
  return el;
}

function row(id: string): HTMLLIElement {
  const li = rowInput(id).closest("li");
  if (!li) throw new Error(`missing picker row list item for ${id}`);
  return li;
}

function rowText(id: string): string {
  return row(id).textContent ?? "";
}

function rowButtons(id: string): HTMLButtonElement[] {
  return [...row(id).querySelectorAll("button")];
}

function downloadButton(id: string): HTMLButtonElement | undefined {
  return rowButtons(id).find((btn) => btn.textContent?.trim() === copy.download);
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
  h.artifacts = [];
  h.ensureTranslation.mockClear();
  searchSelection.setIds([]);
  localStorage.clear();
});

afterEach(() => {
  unmountPicker();
  target.remove();
});

describe("TranslationPicker rows", () => {
  it("shows a cached row's downloaded badge instead of a download button", async () => {
    h.artifacts = [{ id: CACHED }];
    const instance = mount(TranslationPicker, { target, props: { copy } });
    unmountPicker = () => {
      void unmount(instance);
    };
    await settle();

    expect(rowText(CACHED)).toContain(copy.cached);
    expect(downloadButton(CACHED)).toBeUndefined();
  });

  it("downloads an uncached row through ensureTranslation on click", async () => {
    const instance = mount(TranslationPicker, { target, props: { copy } });
    unmountPicker = () => {
      void unmount(instance);
    };
    await settle();

    const button = downloadButton(UNCACHED);
    expect(button, `expected a ${copy.download} button on the uncached row`).toBeDefined();
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();

    expect(h.ensureTranslation).toHaveBeenCalledTimes(1);
    expect(h.ensureTranslation).toHaveBeenCalledWith(UNCACHED);
  });

  it("keeps RTL rows disabled with their reason copy and no download control", async () => {
    const instance = mount(TranslationPicker, { target, props: { copy } });
    unmountPicker = () => {
      void unmount(instance);
    };
    await settle();

    expect(rowInput(RTL).disabled).toBe(true);
    expect(rowText(RTL)).toContain(copy.rtlDisabled);
    expect(rowButtons(RTL)).toEqual([]);
  });

  it("renders the progress bar for the row the progress event names", async () => {
    const instance = mount(TranslationPicker, { target, props: { copy } });
    unmountPicker = () => {
      void unmount(instance);
    };
    await settle();

    h.emit({ script: UNCACHED, loaded: 50, total: 200 });
    await settle();

    const bar = row(UNCACHED).querySelector("div.bg-accent");
    expect(bar?.getAttribute("style")).toContain("25%");
    const button = downloadButton(UNCACHED);
    expect(button).toBeUndefined();
    const downloading = rowButtons(UNCACHED).find(
      (btn) => btn.textContent?.trim() === copy.downloading,
    );
    expect(downloading).toBeDefined();
    expect(downloading?.disabled).toBe(true);
  });

  it("mirrors the search selection store and persists toggles", async () => {
    searchSelection.setIds([CACHED]);
    const instance = mount(TranslationPicker, { target, props: { copy } });
    unmountPicker = () => {
      void unmount(instance);
    };
    await settle();

    expect(rowInput(CACHED).checked).toBe(true);
    expect(rowInput(UNCACHED).checked).toBe(false);

    const input = rowInput(UNCACHED);
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    expect(input.checked).toBe(true);
    expect([...searchSelection.ids]).toContain(UNCACHED);
    expect(localStorage.getItem(SELECTION_KEY) ?? "").toContain(UNCACHED);
  });
});
