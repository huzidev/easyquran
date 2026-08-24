import { chunk } from "es-toolkit";
import type { TranslationCatalogueEntry } from "$lib/data/quran-types";
import { TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";

/** Worker calls per in-flight batch when searching many translations at once. */
export const SEARCH_BATCH_SIZE = 3;

export interface DefaultSelectionInput {
  readonly urlT: readonly string[];
  readonly persisted: readonly string[];
  readonly lastReadSourceId: string | undefined;
  readonly stackedIds: readonly string[];
}

function isSearchable(
  id: string,
  catalogueById: ReadonlyMap<string, TranslationCatalogueEntry>,
): boolean {
  return catalogueById.get(id)?.direction === "ltr";
}

/**
 * First meaningful choice wins: the `?t=` deep link (already validated by
 * `parseSearchUrl`), then the persisted selection, then the last-read source,
 * then the first stacked translation — each re-validated against the catalogue
 * because offline state goes stale. Returns `[]` when nothing qualifies, which
 * the page renders as the picker prompt.
 */
export function resolveDefaultSelection(input: DefaultSelectionInput): string[] {
  if (input.urlT.length > 0) return [...input.urlT];

  const persisted = input.persisted.filter((id) => isSearchable(id, TRANSLATION_CATALOGUE_BY_ID));
  if (persisted.length > 0) return persisted;

  if (
    input.lastReadSourceId !== undefined &&
    isSearchable(input.lastReadSourceId, TRANSLATION_CATALOGUE_BY_ID)
  ) {
    return [input.lastReadSourceId];
  }

  const stacked = input.stackedIds.find((id) => isSearchable(id, TRANSLATION_CATALOGUE_BY_ID));
  return stacked === undefined ? [] : [stacked];
}

export interface SearchPartition {
  searchable: string[];
  disabled: string[];
}

/** Splits translation ids into searchable (LTR) and disabled (RTL); unknown ids land in neither. */
export function partitionSearchable(
  ids: readonly string[],
  catalogueById: ReadonlyMap<string, TranslationCatalogueEntry>,
): SearchPartition {
  const searchable: string[] = [];
  const disabled: string[] = [];
  for (const id of ids) {
    if (isSearchable(id, catalogueById)) searchable.push(id);
    else if (catalogueById.has(id)) disabled.push(id);
  }
  return { searchable, disabled };
}

/** Fixed-size batches for bounded-concurrency worker calls; a non-positive size yields no batches. */
export function batchPlan<T>(items: readonly T[], size: number): T[][] {
  if (size < 1 || items.length === 0) return [];
  return chunk(items, size);
}
