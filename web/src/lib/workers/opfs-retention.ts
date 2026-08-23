import type { TranslationCatalogueEntry } from "$lib/data/quran-types";

import { idbDelete, idbPut, openIdb } from "./idb";
import { idbError } from "./idb-error";
import {
  deleteCachedArtifact,
  listCachedArtifacts,
  type CachedArtifactInfo,
} from "./opfs-cache";

const META_DB = "easyquran-meta";
const META_STORE = "lastUsed";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CAP_COUNT = 128;
export const CAP_BYTES = 256 * 1024 * 1024;

export async function stampLastUsed(id: string, when: number = Date.now()): Promise<void> {
  try {
    await idbPut(await openIdb(META_DB, META_STORE), META_STORE, when, id);
  } catch {}
}

export async function clearLastUsed(id: string): Promise<void> {
  try {
    await idbDelete(await openIdb(META_DB, META_STORE), META_STORE, id);
  } catch {}
}

export async function readLastUsedMap(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const db = await openIdb(META_DB, META_STORE);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        // eslint-disable-next-line anti-slop/no-runtime-typeof -- parses the IDB record at its read boundary: keys are polymorphic IDBValidKey (this store writes strings only) and values were stamped by stampLastUsed as numbers
        if (typeof cur.key === "string" && typeof cur.value === "number") {
          out.set(cur.key, cur.value);
        }
        cur.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(idbError(tx.error, "transaction"));
    });
  } catch {}
  return out;
}

function buildSizeLookup(catalogue?: readonly TranslationCatalogueEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  if (!catalogue) return m;
  for (const entry of catalogue) {
    m.set(entry.id, entry.sizeBytes);
  }
  return m;
}

export interface PruneOptions {
  readonly pinnedArabicIds: readonly string[];
  readonly pinnedTranslationIds?: readonly string[];
  readonly catalogue?: readonly TranslationCatalogueEntry[];
  /** Boot-only snapshot, captured before translation staging can begin. */
  readonly inventory?: readonly CachedArtifactInfo[];
}

export interface PruneResult {
  readonly evicted: readonly string[];
}

let pruneInFlight: Promise<PruneResult> | null = null;

export async function pruneTranslations(opts: PruneOptions): Promise<PruneResult> {
  if (pruneInFlight) return pruneInFlight;
  pruneInFlight = runPrune(opts).finally(() => {
    pruneInFlight = null;
  });
  return pruneInFlight;
}

export interface PruneCandidate {
  readonly id: string;
  readonly sizeBytes: number;
}

export function computeEvictions(
  candidates: readonly PruneCandidate[],
  lastUsed: ReadonlyMap<string, number>,
  sizeFor: ReadonlyMap<string, number>,
  now: number,
  pinnedIds: readonly string[] = [],
): string[] {
  const cutoff = now - TTL_MS;
  const pinned = new Set(pinnedIds);
  const ranked = candidates
    .filter((artifact) => !pinned.has(artifact.id))
    .map((a) => ({
      id: a.id,
      size: a.sizeBytes > 0 ? a.sizeBytes : (sizeFor.get(a.id) ?? 0),
      used: lastUsed.get(a.id) ?? 0,
    }))
    .sort((x, y) => x.used - y.used);

  let totalBytes = 0;
  for (const r of ranked) totalBytes += r.size;

  const evicted: string[] = [];
  for (const r of ranked) {
    const remaining = ranked.length - evicted.length;
    if (remaining <= CAP_COUNT && totalBytes <= CAP_BYTES && r.used >= cutoff) break;
    evicted.push(r.id);
    totalBytes -= r.size;
  }
  return evicted;
}

async function runPrune(opts: PruneOptions): Promise<PruneResult> {
  const artifacts = opts.inventory ?? (await listCachedArtifacts());
  if (artifacts.length === 0) return { evicted: [] };

  const lastUsed = await readLastUsedMap();
  const sizeFor = buildSizeLookup(opts.catalogue);
  const pinned = [...opts.pinnedArabicIds, ...(opts.pinnedTranslationIds ?? [])];
  const evictIds = computeEvictions(artifacts, lastUsed, sizeFor, Date.now(), pinned);
  if (evictIds.length === 0) return { evicted: Object.freeze([]) };

  const tagById = new Map(artifacts.map((a) => [a.id, a.tag]));
  const evicted: string[] = [];
  for (const id of evictIds) {
    await deleteCachedArtifact(id, tagById.get(id) ?? "");
    await clearLastUsed(id);
    evicted.push(id);
  }
  return { evicted: Object.freeze(evicted) };
}
