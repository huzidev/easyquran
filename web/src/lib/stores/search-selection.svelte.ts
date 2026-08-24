import { browser } from "$app/environment";
import { uniq } from "es-toolkit";
import {
  asArray,
  asObject,
  asString,
  isFutureSchema,
  onStorageKey,
  readJSON,
  writeJSON,
} from "$lib/storage";

const SEARCH_SELECTION_STORAGE_KEY = "easyquran.search.selection";
const SEARCH_SELECTION_SCHEMA_VERSION = 1;

interface PersistedSearchSelection {
  v: number;
  ids: string[];
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the untyped localStorage JSON boundary (readJSON -> JSON.parse); isFutureSchema/asObject/asArray validate
function decodeSearchSelection(raw: unknown): PersistedSearchSelection {
  const fallback: PersistedSearchSelection = { v: SEARCH_SELECTION_SCHEMA_VERSION, ids: [] };
  if (isFutureSchema(raw, SEARCH_SELECTION_SCHEMA_VERSION)) return fallback;
  const stored = asObject(raw);
  if (!stored) return fallback;
  return { v: SEARCH_SELECTION_SCHEMA_VERSION, ids: asArray(stored.ids, asString) };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/**
 * Translation ids the dedicated search page searches. Uncapped by design: a cap
 * would silently drop a picked translation, and the page batches worker calls
 * instead. Persisted to localStorage and synced across tabs.
 */
export class SearchSelectionStore {
  #ids = $state<string[]>([]);
  #teardown: (() => void) | null = null;

  constructor() {
    if (!browser) return;
    this.#ids = decodeSearchSelection(readJSON(SEARCH_SELECTION_STORAGE_KEY)).ids;
    this.#teardown = onStorageKey(SEARCH_SELECTION_STORAGE_KEY, () => {
      const next = decodeSearchSelection(readJSON(SEARCH_SELECTION_STORAGE_KEY)).ids;
      if (!sameIds(next, this.#ids)) this.#ids = next;
    });
  }

  dispose(): void {
    this.#teardown?.();
    this.#teardown = null;
  }

  get ids(): readonly string[] {
    return this.#ids;
  }

  #commit(ids: string[]): void {
    this.#ids = ids;
    if (browser) writeJSON(SEARCH_SELECTION_STORAGE_KEY, { v: SEARCH_SELECTION_SCHEMA_VERSION, ids });
  }

  setIds(ids: readonly string[]): void {
    const next = uniq(ids);
    if (sameIds(next, this.#ids)) return;
    this.#commit(next);
  }

  toggle(id: string): void {
    const next = this.#ids.includes(id)
      ? this.#ids.filter((x) => x !== id)
      : [...this.#ids, id];
    this.setIds(next);
  }

  remove(id: string): void {
    if (!this.#ids.includes(id)) return;
    this.#commit(this.#ids.filter((x) => x !== id));
  }

  clear(): void {
    if (this.#ids.length === 0) return;
    this.#commit([]);
  }
}

export const searchSelection = new SearchSelectionStore();
