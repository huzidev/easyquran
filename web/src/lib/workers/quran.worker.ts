import {
  isArabicSourceId,
  OpenerKind,
  OpenerPackaging,
  QuranScript,
  STACKED_MAX_EXTRAS,
  type ArtifactSpec,
  type CanonicalQuranCoordinates,
  type DownloadableSpec,
  type QuranRangeText,
  type QuranReaderSource,
  type QuranSourceId,
  type QuranSurahText,
  type SurahNormalization,
  type TranslationCatalogueEntry,
} from "$lib/data/quran-types";
import { DEFAULT_QURAN_SOURCE_PLAN, plannedSourceIds } from "$lib/quran/source-plan";
import {
  runOne,
  runQuery,
  TANZIL_QURAN_DATABASE,
  type CanonicalQuranRow,
  type QuranCoordinateRow,
  type QuranQueryRunner,
} from "$lib/quran/sql";
import { createWasmQueryRunner } from "$lib/quran/wasm-query-runner";
import init, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { uniq } from "es-toolkit";

import type { StorageArtifactInfo, WorkerOutbound, WorkerRequest, WorkerStatus } from "../quran/protocol";
import {
  buildCanonicalSearchCorpus,
  searchCanonicalCorpus,
  type CanonicalSearchUnit,
} from "../quran/search/corpus";
import { SearchProvider, type SearchOpts, type SearchResponse } from "../quran/search/types";
import { resolveSourceProfile } from "../quran/view/source-profiles";
import {
  loadQuranSource,
  readAllSourceRows,
  readSourceRange,
  readSourceSurah,
  type LoadedQuranSource,
} from "../quran/view/source-runtime";
import {
  deleteCachedArtifact,
  ensureArtifact,
  forgetSessionArtifact,
  inspectCachedArtifacts,
  listCachedArtifacts,
  QURAN_ROW_COUNT,
  sweepAbandonedTemps,
  type CachedArtifactInfo,
  type StagedValidator,
} from "./opfs-cache";
import { clearLastUsed, pruneTranslations, readLastUsedMap } from "./opfs-retention";

interface WorkerCtx {
  postMessage(msg: WorkerOutbound): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}
// SAFETY: this module is only loaded as a dedicated-worker entry, where `self` is
// the worker global scope; the DOM lib types it as Window, so hop through unknown.
const workerSelf = self as unknown;
// SAFETY: the worker scope's postMessage/onmessage match WorkerCtx at runtime.
const ctx = workerSelf as WorkerCtx;

let sqlite3: Sqlite3Static | null = null;

interface WorkerSourceState {
  readonly bytes: Uint8Array;
  readonly source: LoadedQuranSource;
  readonly store: string;
  readonly runner: QuranQueryRunner | null;
}

const sources = new Map<QuranSourceId, WorkerSourceState>();
let corpus: CanonicalSearchUnit[] | null = null;
let ready = false;
let storedCatalogue: readonly TranslationCatalogueEntry[] = [];
let storedCatalogueById: ReadonlyMap<string, TranslationCatalogueEntry> = new Map();
let bootPromise: Promise<readonly CachedArtifactInfo[]> | null = null;
let bootInventory: readonly CachedArtifactInfo[] = Object.freeze([]);
const TRANSLATION_DB_CAP = STACKED_MAX_EXTRAS + 2;
const translationDbs = new Map<string, Database>();
const pendingTranslationRunners = new Map<string, Promise<QuranQueryRunner>>();
let activeTranslationFetches = 0;
const cachedTranslationIds = new Set<string>();
const PINNED_ARABIC: readonly string[] = Object.freeze(plannedSourceIds(DEFAULT_QURAN_SOURCE_PLAN));
let pinnedTranslationIds: readonly string[] = [];

function emit(message: WorkerOutbound): void {
  ctx.postMessage(message);
}

function status(value: WorkerStatus, detail?: string): void {
  emit({ type: "status", status: value, detail });
}

function progressEmitter(spec: DownloadableSpec): (loaded: number, total: number) => void {
  let lastPct = -1;
  return (loaded, total) => {
    const pct = total > 0 ? Math.floor((loaded / total) * 100) : 0;
    if (pct === lastPct) return;
    lastPct = pct;
    emit({ type: "progress", script: spec.id, loaded, total });
  };
}

function openReadOnly(bytes: Uint8Array): Database {
  if (!sqlite3) throw new Error("[quran-worker] sqlite3 not initialized before open");
  const s = sqlite3;
  const database = new s.oo1.DB();
  const flags = s.capi.SQLITE_DESERIALIZE_FREEONCLOSE | s.capi.SQLITE_DESERIALIZE_READONLY;
  const pointer = s.wasm.allocFromTypedArray(bytes);
  const result = s.capi.sqlite3_deserialize(
    database,
    "main",
    pointer,
    bytes.byteLength,
    bytes.byteLength,
    flags,
  );
  if (result !== s.capi.SQLITE_OK) {
    s.wasm.dealloc(pointer);
    throw new Error(`sqlite3_deserialize failed: rc=${result}`);
  }
  return database;
}

export function assertStagedQuranContent(
  count: number,
  rows: readonly QuranCoordinateRow[],
  sourceId: string,
): void {
  if (count !== QURAN_ROW_COUNT) {
    throw new Error(`[quran-stage:${sourceId}] row count ${count} != ${QURAN_ROW_COUNT}`);
  }
  if (rows.length !== QURAN_ROW_COUNT) {
    throw new Error(
      `[quran-stage:${sourceId}] coordinate count ${rows.length} != ${QURAN_ROW_COUNT}`,
    );
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.surah < 1 || row.surah > 114 || row.ayah < 1) {
      throw new Error(
        `[quran-stage:${sourceId}] bad coordinate ${row.globalIndex}/${row.surah}:${row.ayah}`,
      );
    }
    if (row.globalIndex !== i + 1) {
      throw new Error(
        i === 0
          ? `[quran-stage:${sourceId}] globalIndex must start at 1, got ${row.globalIndex}`
          : `[quran-stage:${sourceId}] non-contiguous globalIndex at ${row.globalIndex}`,
      );
    }
  }
  if (isArabicSourceId(sourceId)) {
    const profile = resolveSourceProfile(sourceId);
    if (profile.canonicalRowCount !== QURAN_ROW_COUNT) {
      throw new Error(`[quran-stage:${sourceId}] profile row count mismatch`);
    }
  }
}

export function assertStagedQuranBytes(bytes: Uint8Array, sourceId: string): void {
  if (!sqlite3) throw new Error("[quran-worker] sqlite3 not initialized before staging check");
  const database = openReadOnly(bytes);
  try {
    const runner = createWasmQueryRunner(database);
    const count = runOne(runner, TANZIL_QURAN_DATABASE.queries.count);
    const rows = runQuery(runner, TANZIL_QURAN_DATABASE.queries.coordinates);
    runner.all("SELECT text FROM quran_text LIMIT 1");
    assertStagedQuranContent(count, rows, sourceId);
  } finally {
    database.close();
  }
}

function stagedQuranValidator(): StagedValidator {
  return (bytes, spec) => assertStagedQuranBytes(bytes, spec.id);
}

export async function __initValidatorRuntime(): Promise<void> {
  if (!sqlite3) sqlite3 = await init();
}

async function bootArabic(
  artifacts: readonly ArtifactSpec[],
  coordinates: CanonicalQuranCoordinates,
): Promise<readonly CachedArtifactInfo[]> {
  status("init");
  sqlite3 = await init();

  const persistentSources = new Set([
    DEFAULT_QURAN_SOURCE_PLAN.reader,
    DEFAULT_QURAN_SOURCE_PLAN.search.display,
  ]);
  for (const sourceId of plannedSourceIds(DEFAULT_QURAN_SOURCE_PLAN)) {
    const spec = artifacts.find((artifact) => artifact.id === sourceId);
    if (!spec) throw new Error(`artifact list missing Quran source ${sourceId}`);
    const profile = resolveSourceProfile(spec.id);
    status("downloading", sourceId);
    const artifact = await ensureArtifact(spec, progressEmitter(spec), {
      validate: stagedQuranValidator(),
    });
    const database = openReadOnly(artifact.bytes);
    const runner = createWasmQueryRunner(database);
    const source = loadQuranSource(runner, profile, coordinates);
    const persistent = persistentSources.has(sourceId);
    sources.set(sourceId, {
      bytes: artifact.bytes,
      source,
      store: artifact.store,
      runner: persistent ? runner : null,
    });
    if (!persistent) database.close();
  }

  // One inventory drives temp cleanup, cached IDs, and initial pruning. Sweep
  // orphan .sqlite.tmp files BEFORE flipping ready: while ready is false
  // no readTranslation can have started an ensureArtifact stage, so no temp here
  // is in flight (the worker processes messages concurrently via void
  // handleMessage, so this must hold before any staging can start). The prune
  // path no longer deletes temps (it raced in-flight staging), so this boot
  // sweep is the sole temp-cleanup owner.
  const inspection = await inspectCachedArtifacts();
  await sweepAbandonedTemps(inspection.abandonedTemps);
  cachedTranslationIds.clear();
  for (const artifact of inspection.artifacts) {
    if (!isArabicSourceId(artifact.id)) cachedTranslationIds.add(artifact.id);
  }
  ready = true;
  status("ready");
  return inspection.artifacts;
}

async function initialize(
  artifacts: readonly ArtifactSpec[],
  coordinates: CanonicalQuranCoordinates,
  catalogue?: readonly TranslationCatalogueEntry[],
): Promise<readonly CachedArtifactInfo[]> {
  if (catalogue !== undefined) {
    storedCatalogue = catalogue;
    storedCatalogueById = new Map(catalogue.map((entry) => [entry.id, entry]));
  }
  if (ready) return bootInventory;
  if (bootPromise !== null) {
    return await bootPromise;
  }
  bootPromise = bootArabic(artifacts, coordinates);
  try {
    bootInventory = await bootPromise;
    return bootInventory;
  } finally {
    bootPromise = null;
  }
}

function readSurah(num: number, sourceId?: QuranSourceId): QuranSurahText {
  const state = sourceState(sourceId ?? DEFAULT_QURAN_SOURCE_PLAN.reader);
  if (!state.runner) throw new Error("reader source is not open");
  return {
    sourceId: state.source.profile.sourceId,
    script: state.source.profile.script,
    verses: readSourceSurah(state.runner, state.source, num),
    normalization: state.source.view.normalization(num),
  };
}

function rowsToRangeText(
  rows: ReadonlyArray<CanonicalQuranRow>,
  normalize: (surah: number) => SurahNormalization,
): QuranRangeText {
  return {
    ayahs: rows.map((row) => ({
      key: `${row.surah}:${row.ayah}`,
      surah: row.surah,
      ayah: row.ayah,
      globalIndex: row.globalIndex,
      text: row.text,
    })),
    normalizations: uniq(rows.map((row) => row.surah)).map((surah) => normalize(surah)),
  };
}

function readRange(from: number, to: number, sourceId?: QuranSourceId): QuranRangeText {
  const state = sourceState(sourceId ?? DEFAULT_QURAN_SOURCE_PLAN.reader);
  if (!state.runner) throw new Error("reader source is not open");
  return rowsToRangeText(readSourceRange(state.runner, state.source, from, to), (surah) =>
    state.source.view.normalization(surah),
  );
}

function translationSpec(sourceId: string): DownloadableSpec {
  if (storedCatalogue.length === 0) {
    throw new Error("translation catalogue unavailable");
  }
  const entry = storedCatalogueById.get(sourceId);
  if (!entry) {
    throw new Error(`translation source ${sourceId} is not in the catalogue`);
  }
  return Object.freeze({
    id: entry.id,
    sizeBytes: entry.sizeBytes,
    downloadUrl: entry.downloadUrl,
  });
}

function evictTranslationDbs(): void {
  while (translationDbs.size >= TRANSLATION_DB_CAP) {
    const oldest = translationDbs.keys().next().value;
    if (oldest === undefined) break;
    const database = translationDbs.get(oldest);
    translationDbs.delete(oldest);
    forgetSessionArtifact(oldest);
    if (database) {
      try {
        database.close();
      } catch {}
    }
  }
}

function forgetTranslations(ids: readonly string[]): void {
  for (const id of ids) {
    cachedTranslationIds.delete(id);
    forgetSessionArtifact(id);
    const database = translationDbs.get(id);
    if (database) {
      translationDbs.delete(id);
      try {
        database.close();
      } catch {}
    }
  }
}

async function translationRunner(sourceId: string): Promise<QuranQueryRunner> {
  const cached = translationDbs.get(sourceId);
  if (cached) {
    translationDbs.delete(sourceId);
    translationDbs.set(sourceId, cached);
    return createWasmQueryRunner(cached);
  }
  const pending = pendingTranslationRunners.get(sourceId);
  if (pending) return pending;
  const run = fetchTranslationRunner(sourceId);
  pendingTranslationRunners.set(sourceId, run);
  try {
    return await run;
  } finally {
    pendingTranslationRunners.delete(sourceId);
  }
}

async function fetchTranslationRunner(sourceId: string): Promise<QuranQueryRunner> {
  const spec = translationSpec(sourceId);
  if (activeTranslationFetches++ === 0) status("downloading", sourceId);
  try {
    try {
      const artifact = await ensureArtifact(spec, progressEmitter(spec), {
        validate: stagedQuranValidator(),
      });
      if (artifact.downloaded) {
        void pruneTranslations({
          pinnedArabicIds: PINNED_ARABIC,
          pinnedTranslationIds,
          catalogue: storedCatalogue,
        }).then(
          (r) => forgetTranslations(r.evicted),
          () => {},
        );
      }
      evictTranslationDbs();
      const database = openReadOnly(artifact.bytes);
      translationDbs.set(sourceId, database);
      return createWasmQueryRunner(database);
    } catch (error) {
      status("translation-fetch-failed", sourceId);
      throw error;
    }
  } finally {
    if (--activeTranslationFetches === 0) status("ready");
  }
}

function hasTranslationCached(sourceId: string): boolean {
  return translationDbs.has(sourceId) || cachedTranslationIds.has(sourceId);
}

async function ensureTranslation(sourceId: string): Promise<void> {
  if (hasTranslationCached(sourceId)) return;
  try {
    await translationRunner(sourceId);
    cachedTranslationIds.add(sourceId);
  } catch {}
}

function translationNormalization(sourceId: string, surah: number): SurahNormalization {
  return Object.freeze({
    surah,
    sourceId,
    script: QuranScript.Translation,
    sourceProfile: `translation:${sourceId}`,
    packaging: OpenerPackaging.Absent,
    openerKind: OpenerKind.None,
    openerText: null,
    openerEndScalar: 0,
    bodyStartScalar: 0,
  });
}

async function readTranslationSurah(sourceId: string, num: number): Promise<QuranSurahText> {
  const runner = await translationRunner(sourceId);
  const verses = runQuery(runner, TANZIL_QURAN_DATABASE.queries.surah, [num]);
  return {
    sourceId,
    script: QuranScript.Translation,
    verses,
    normalization: translationNormalization(sourceId, num),
  };
}

async function readTranslationRange(
  sourceId: string,
  from: number,
  to: number,
): Promise<QuranRangeText> {
  const runner = await translationRunner(sourceId);
  return rowsToRangeText(
    runQuery(runner, TANZIL_QURAN_DATABASE.queries.range, [from, to]),
    (surah) => translationNormalization(sourceId, surah),
  );
}

function sourceState(sourceId: QuranSourceId): WorkerSourceState {
  const state = sources.get(sourceId);
  if (!state) throw new Error(`Quran source ${sourceId} is not loaded`);
  return state;
}

function toStorageArtifactInfo(
  artifact: CachedArtifactInfo,
  lastUsed: ReadonlyMap<string, number>,
): StorageArtifactInfo {
  const used = lastUsed.get(artifact.id);
  return {
    id: artifact.id,
    store: artifact.store,
    tag: artifact.tag,
    sizeBytes: artifact.sizeBytes,
    lastUsed: used !== undefined ? used : null,
  };
}

export async function listStorageArtifacts(): Promise<StorageArtifactInfo[]> {
  const [artifacts, lastUsed] = await Promise.all([listCachedArtifacts(), readLastUsedMap()]);
  return artifacts.map((artifact) => toStorageArtifactInfo(artifact, lastUsed));
}

export async function deleteStorageArtifact(sourceId: string): Promise<null> {
  if (isArabicSourceId(sourceId)) throw new Error("arabic");
  if (pendingTranslationRunners.has(sourceId)) throw new Error("busy");
  forgetTranslations([sourceId]);
  // SAFETY: handlers run concurrently (void handleMessage), so a same-id
  // ensureTranslation/read can register a download inside the awaits below and
  // resurrect the artifact. Holding the pending slot for the whole delete makes
  // any in-window runner observe this gate and reject busy instead.
  const deletionGate = Promise.reject<QuranQueryRunner>(new Error("busy"));
  void deletionGate.catch(() => {});
  pendingTranslationRunners.set(sourceId, deletionGate);
  try {
    const artifacts = await listCachedArtifacts();
    const hit = artifacts.find((artifact) => artifact.id === sourceId);
    if (hit) {
      await deleteCachedArtifact(sourceId, hit.tag);
      await clearLastUsed(sourceId);
    }
  } finally {
    pendingTranslationRunners.delete(sourceId);
  }
  return null;
}

export const __artifactAdminTestHooks = {
  injectInFlight(id: string): void {
    pendingTranslationRunners.set(
      id,
      new Promise<QuranQueryRunner>(() => {}),
    );
  },
  clearInFlight(id: string): void {
    pendingTranslationRunners.delete(id);
  },
  pendingRunner(id: string): Promise<QuranQueryRunner> | null {
    return pendingTranslationRunners.get(id) ?? null;
  },
  injectOpenDb(id: string, close: () => void): void {
    // SAFETY: the fake only carries the close() method deleteStorageArtifact calls via
    // forgetTranslations; no sqlite-wasm query path ever touches a test-injected handle.
    translationDbs.set(id, { close } as Database);
  },
  hasOpenDb(id: string): boolean {
    return translationDbs.has(id);
  },
  markCached(id: string): void {
    cachedTranslationIds.add(id);
  },
  cachedIds(): readonly string[] {
    return [...cachedTranslationIds];
  },
};

function readAllRows(state: WorkerSourceState) {
  if (state.runner) return readAllSourceRows(state.runner, state.source);
  const database = openReadOnly(state.bytes);
  try {
    return readAllSourceRows(createWasmQueryRunner(database), state.source);
  } finally {
    database.close();
  }
}

function ensureSearchCorpus(): void {
  if (corpus) return;
  const match = sourceState(DEFAULT_QURAN_SOURCE_PLAN.search.match);
  const display = sourceState(DEFAULT_QURAN_SOURCE_PLAN.search.display);
  const matchRows = readAllRows(match);
  const displayRows = match === display ? matchRows : readAllRows(display);
  corpus = buildCanonicalSearchCorpus({
    matchRows,
    displayRows,
    matchView: match.source.view,
    displayView: display.source.view,
  });
}

function search(query: string, opts: SearchOpts = {}): SearchResponse {
  ensureSearchCorpus();
  return {
    query,
    ...searchCanonicalCorpus(corpus!, query, opts),
    source: SearchProvider.Worker,
  };
}

function runReaderOp<T>(
  source: QuranReaderSource | undefined,
  arabic: () => T,
  translation: (src: QuranReaderSource) => Promise<T> | T,
): Promise<T> | T {
  return source !== undefined && !isArabicSourceId(source) ? translation(source) : arabic();
}

function arabicSourceId(source: QuranReaderSource | undefined): QuranSourceId | undefined {
  if (source === undefined || !isArabicSourceId(source)) return undefined;
  return source;
}

type HandlerResult =
  | QuranSurahText
  | QuranRangeText
  | SearchResponse
  | boolean
  | null
  | readonly StorageArtifactInfo[];
type Handler<K extends WorkerRequest["type"]> = (
  msg: Extract<WorkerRequest, { type: K }>,
) => HandlerResult | Promise<HandlerResult>;

const handlers = {
  init: async (m) => {
    await initialize(m.artifacts, m.coordinates, m.catalogue);
    return null;
  },
  hasTranslation: (m) => hasTranslationCached(m.source),
  ensureTranslation: (m) => {
    void ensureTranslation(m.source);
    return null;
  },
  setPinnedTranslations: (m) => {
    pinnedTranslationIds = m.ids;
    return null;
  },
  listArtifacts: () => listStorageArtifacts(),
  deleteArtifact: (m) => deleteStorageArtifact(m.sourceId),
  readSurah: (m) =>
    runReaderOp(
      m.source,
      () => readSurah(m.num, arabicSourceId(m.source)),
      (src) => readTranslationSurah(src, m.num),
    ),
  readRange: (m) =>
    runReaderOp(
      m.source,
      () => readRange(m.from, m.to, arabicSourceId(m.source)),
      (src) => readTranslationRange(src, m.from, m.to),
    ),
  search: (m) => search(m.query, m.opts),
} satisfies { [K in WorkerRequest["type"]]: Handler<K> };

async function handleMessage(event: MessageEvent<WorkerRequest>): Promise<void> {
  const message = event.data;
  const id = message.id;
  try {
    if (message.type === "init") {
      await handlers.init(message);
      emit({ id, ok: true, result: null });
      void pruneTranslations({
        pinnedArabicIds: PINNED_ARABIC,
        pinnedTranslationIds,
        catalogue: storedCatalogue,
        inventory: bootInventory,
      }).then(
        (r) => forgetTranslations(r.evicted),
        () => {},
      );
      return;
    }
    if (message.type === "setPinnedTranslations") {
      emit({ id, ok: true, result: handlers.setPinnedTranslations(message) });
      return;
    }
    if (!ready) {
      emit({ id, ok: false, error: "engine not ready" });
      return;
    }
    // SAFETY: message.type is the WorkerRequest discriminator and every handlers
    // entry is registered for exactly its own variant, so this union indexes the one
    // exact handler for message.
    const handler = handlers[message.type] as (
      m: WorkerRequest,
    ) => HandlerResult | Promise<HandlerResult>;
    emit({ id, ok: true, result: await handler(message) });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (message.type === "init") {
      status("error", errorMessage);
      emit({ type: "fatal", error: errorMessage });
    }
    emit({ id, ok: false, error: errorMessage });
  }
}

// onmessage must return void; the handler owns its own error reporting.
ctx.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  void handleMessage(event);
};
