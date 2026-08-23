import { QURAN } from "$lib/config/site";
import { isArabicSourceId } from "$lib/data/quran-types";
import type {
  Ayah,
  CanonicalQuranCoordinates,
  DownloadProgress,
  QuranRangeText,
  QuranReaderSource,
  QuranSurahText,
  ArtifactSpec,
  TranslationCatalogueEntry,
  SurahLink,
  SurahNormalization,
} from "$lib/data/quran-types";
import { DOWNLOAD_BUDGET_MS } from "$lib/workers/download";

import { quranApi } from "./api-client";
import {
  classifyApiFailure,
  classifyWorkerFailure,
  LOCAL_BOOT_BUDGET_MS,
  ReadChainError,
  type ReadFailure,
  type ReadTierStatus,
} from "./fetch";
import type {
  StorageArtifactInfo,
  WorkerEvent,
  WorkerOutbound,
  WorkerRequest,
  WorkerStatus,
} from "./protocol";
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from "./search/normalize";
import { SearchProvider, type SearchOpts, type SearchResponse } from "./search/types";
import { DEFAULT_QURAN_SOURCE_PLAN } from "./source-plan";
import {
  decodeQuranRangeText,
  decodeQuranSurahText,
  decodeSearchResponse,
  decodeTranslationRangeText,
  decodeTranslationSurahText,
  type AyahCoordinateValidator,
} from "./wire";

interface Pending {
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- stores Promise resolvers for request<T> across every T; the worker reply is validated by each caller's decode() fn
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const COLD_TRANSLATION_READ_TIMEOUT_MS = DOWNLOAD_BUDGET_MS + 5_000;

let worker: Worker | null = null;
let seq = 0;
let isReady = false;
let startPromise: Promise<void> | null = null;
let desiredPinnedTranslations: readonly string[] | null = null;
let pinnedSyncPromise: Promise<void> | null = null;
let pinnedSyncGeneration = 0;

const pending = new Map<number, Pending>();
const statusListeners = new Set<(s: WorkerStatus, detail?: string) => void>();
const progressListeners = new Set<(p: DownloadProgress) => void>();

function equalStrings(a: readonly string[] | null, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function syncPinnedTranslations(): Promise<void> {
  if (pinnedSyncPromise) return pinnedSyncPromise;
  const generation = pinnedSyncGeneration;
  const run = (async (): Promise<void> => {
    await quranWorker.whenReady();
    let sent: readonly string[] | null = null;
    while (generation === pinnedSyncGeneration && desiredPinnedTranslations) {
      if (equalStrings(sent, desiredPinnedTranslations)) return;
      const current = [...desiredPinnedTranslations];
      await request<null>((id) => ({ id, type: "setPinnedTranslations", ids: current }));
      sent = current;
    }
  })();
  pinnedSyncPromise = run;
  const clear = (): void => {
    if (pinnedSyncPromise === run) pinnedSyncPromise = null;
  };
  void run.then(clear, clear);
  return run;
}

function failAll(err: Error): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function resetWorker(error?: Error): void {
  if (error) failAll(error);
  worker?.terminate();
  worker = null;
  isReady = false;
  startPromise = null;
}

function reportWorkerFailure(error: Error): void {
  resetWorker(error);
  for (const listener of statusListeners) listener("error", error.message);
}

const eventHandlers = {
  status: (m: Extract<WorkerEvent, { type: "status" }>) => {
    if (m.status === "ready") isReady = true;
    for (const cb of statusListeners) cb(m.status, m.detail);
  },
  progress: (m: Extract<WorkerEvent, { type: "progress" }>) => {
    const p: DownloadProgress = { script: m.script, loaded: m.loaded, total: m.total };
    for (const cb of progressListeners) cb(p);
  },
  fatal: (m: Extract<WorkerEvent, { type: "fatal" }>) => {
    reportWorkerFailure(new Error(m.error));
  },
} satisfies {
  [K in WorkerEvent["type"]]: (msg: Extract<WorkerEvent, { type: K }>) => void;
};

function handle(msg: WorkerOutbound): void {
  if ("id" in msg) {
    const p = pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
    return;
  }
  // SAFETY: eventHandlers is keyed by every WorkerEvent["type"] via the satisfies contract,
  // so msg.type selects the handler that accepts exactly this msg variant.
  (eventHandlers[msg.type] as (m: WorkerEvent) => void)(msg);
}

function request<T>(
  build: (id: number) => WorkerRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const activeWorker = worker;
  if (!activeWorker) return Promise.reject(new Error("quran worker not started"));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("quran worker request timed out"));
    }, timeoutMs);
    // SAFETY: Pending stores resolvers for request<T> calls of every T at once; the worker
    // reply is untyped here and each caller's decode() fn is the boundary parse.
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- promise resolve value is the raw worker reply; callers decode it
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    activeWorker.postMessage(build(id));
  });
}

function waitForBootBudget(): Promise<void> {
  if (isReady || !startPromise) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      statusListeners.delete(listener);
      resolve();
    };
    const timer = setTimeout(finish, LOCAL_BOOT_BUDGET_MS);
    const listener = (status: WorkerStatus): void => {
      if (status === "ready" || status === "error") finish();
    };
    statusListeners.add(listener);
    void startPromise?.then(finish, finish);
  });
}

export interface ReadOptions {
  /**
   * Race the read API against the local worker once the worker has been silent this long.
   * Left unset the read stays strictly sequential (local, then API).
   */
  readonly hedgeAfterMs?: number;
  readonly signal?: AbortSignal;
}

export type StorageAdminFailure = "arabic" | "busy";

export class StorageAdminError extends Error {
  readonly failure: StorageAdminFailure;
  constructor(failure: StorageAdminFailure) {
    super(failure);
    this.name = "StorageAdminError";
    this.failure = failure;
  }
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- boundary decoder: raw is the untyped worker reply; this function IS the parser that validates each artifact field
function decodeStorageArtifacts(raw: unknown): StorageArtifactInfo[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StorageArtifactInfo[] = [];
  for (const item of raw) {
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- worker-message boundary: typeof-object discriminates a non-null object before per-field validation
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    // SAFETY: item is narrowed to a non-null object by the guard above; the cast only exposes fields for the checks below.
    // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- structured-clone reply bag; each field is validated by name before use
    const obj = item as Record<string, unknown>;
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- worker-message boundary field check: id must be a non-empty string
    if (typeof obj.id !== "string" || obj.id === "") return null;
    if (obj.store !== "opfs" && obj.store !== "idb" && obj.store !== "session") return null;
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- worker-message boundary field check: tag must be a string
    if (typeof obj.tag !== "string") return null;
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- worker-message boundary field check: sizeBytes must be a finite number
    if (typeof obj.sizeBytes !== "number" || !Number.isFinite(obj.sizeBytes)) return null;
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- worker-message boundary field check: lastUsed is a stamped finite number or null
    if (obj.lastUsed !== null && (typeof obj.lastUsed !== "number" || !Number.isFinite(obj.lastUsed))) return null;
    out.push({
      id: obj.id,
      store: obj.store,
      tag: obj.tag,
      sizeBytes: obj.sizeBytes,
      lastUsed: obj.lastUsed,
    });
  }
  return out;
}

interface SourceFallbackArgs<T> {
  hasLocal: () => boolean | Promise<boolean>;
  onMiss?: () => void;
  workerReq: (id: number) => WorkerRequest;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- raw worker reply is opaque wire data; the decode* fn passed here (wire.ts) is the boundary parser
  decode: (raw: unknown) => T | null;
  apiFetch: (signal?: AbortSignal) => Promise<T>;
  errorMessage: string;
  onStatus?: (status: ReadTierStatus) => void;
  hedgeAfterMs?: number;
  signal?: AbortSignal;
  coldLocalRead?: boolean;
}

interface FallbackState {
  workerFailure?: ReadFailure;
  apiFailure?: ReadFailure;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- opaque rejection reason kept for the error message; narrowed with instanceof at use
  workerError?: unknown;
}

async function attemptLocal<T>(
  args: SourceFallbackArgs<T>,
  state: FallbackState,
  force = false,
): Promise<{ value: T } | null> {
  if (force) {
    if (!isReady && startPromise) await quranWorker.whenReady().catch(() => undefined);
  } else {
    let local: boolean;
    const probe = args.hasLocal();
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- hasLocal() returns boolean | Promise<boolean>; typeof picks the sync branch without forcing an await microtask
    if (typeof probe === "boolean") {
      local = probe;
    } else {
      try {
        local = await probe;
      } catch (e) {
        if (!state.workerFailure) {
          state.workerFailure = classifyWorkerFailure(e);
          state.workerError = e;
        }
        return null;
      }
    }
    if (!local) return null;
  }
  try {
    const decoded = args.decode(
      await request<unknown>(
        args.workerReq,
        force ? COLD_TRANSLATION_READ_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
      ),
    );
    if (decoded) return { value: decoded };
    if (!state.workerFailure) state.workerFailure = { kind: "malformed" };
  } catch (e) {
    if (!state.workerFailure) {
      state.workerFailure = classifyWorkerFailure(e);
      state.workerError = e;
    }
  }
  return null;
}

function failChain<T>(args: SourceFallbackArgs<T>, state: FallbackState): never {
  const detail = state.workerError instanceof Error ? `: ${state.workerError.message}` : "";
  args.onStatus?.({
    servedBy: state.apiFailure ? "api" : "local",
    workerFailure: state.workerFailure,
    apiFailure: state.apiFailure,
  });
  throw new ReadChainError(`${args.errorMessage}${detail}`, state.workerFailure, state.apiFailure);
}

type ReadLeg<T> =
  | { readonly ok: true; readonly value: T; readonly servedBy: "local" | "api" }
  | { readonly ok: false };

/** Resolves with the first leg that produced a value, or `{ ok: false }` once every leg missed. */
function firstSuccessfulLeg<T>(legs: readonly Promise<ReadLeg<T>>[]): Promise<ReadLeg<T>> {
  return new Promise<ReadLeg<T>>((resolve) => {
    let remaining = legs.length;
    let done = false;
    for (const leg of legs) {
      void leg.then((result) => {
        if (done) return;
        if (result.ok) {
          done = true;
          resolve(result);
          return;
        }
        remaining--;
        if (remaining === 0) {
          done = true;
          resolve({ ok: false });
        }
      });
    }
  });
}

interface Gate {
  readonly passed: Promise<void>;
  open(): void;
}

function createGate(): Gate {
  let open = (): void => {};
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { passed, open };
}

/**
 * Local-first, but the API leg starts as soon as the worker either reports a miss or stays
 * silent past the hedge budget — the worker message loop blocks while an artifact downloads,
 * so waiting on its reply would strand the reader behind a multi-MB download.
 */
async function hedgedSourceFallback<T>(
  args: SourceFallbackArgs<T>,
  hedgeAfterMs: number,
): Promise<T> {
  const state: FallbackState = {};
  const gate = createGate();
  const apiAbort = new AbortController();
  let hedgeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    hedgeTimer = null;
    gate.open();
  }, hedgeAfterMs);
  const clearHedgeTimer = (): void => {
    if (hedgeTimer === null) return;
    clearTimeout(hedgeTimer);
    hedgeTimer = null;
  };
  const abortApi = (): void => apiAbort.abort();
  const external = args.signal;
  if (external) {
    if (external.aborted) abortApi();
    else external.addEventListener("abort", abortApi, { once: true });
  }

  const localLeg = (async (): Promise<ReadLeg<T>> => {
    if (!isReady && startPromise) await waitForBootBudget();
    const hit = await attemptLocal(args, state);
    if (hit) return { ok: true, value: hit.value, servedBy: "local" };
    args.onMiss?.();
    gate.open();
    return { ok: false };
  })();

  const apiLeg = (async (): Promise<ReadLeg<T>> => {
    await gate.passed;
    try {
      const value = await args.apiFetch(apiAbort.signal);
      return { ok: true, value, servedBy: "api" };
    } catch (e) {
      state.apiFailure = classifyApiFailure(e);
      return { ok: false };
    }
  })();

  const winner = await firstSuccessfulLeg<T>([localLeg, apiLeg]);
  clearHedgeTimer();
  external?.removeEventListener("abort", abortApi);

  if (winner.ok && winner.servedBy === "local") {
    apiAbort.abort();
    args.onStatus?.({ servedBy: "local" });
    return winner.value;
  }
  if (winner.ok) {
    // The local leg keeps running on purpose: its miss is what starts the OPFS download.
    args.onStatus?.({ servedBy: "api", workerFailure: state.workerFailure });
    return winner.value;
  }
  if (state.apiFailure) {
    const recheck = await attemptLocal(args, state, args.coldLocalRead === true);
    if (recheck) {
      args.onStatus?.({ servedBy: "local", apiFailure: state.apiFailure });
      return recheck.value;
    }
  }
  return failChain(args, state);
}

async function withSourceFallback<T>(args: SourceFallbackArgs<T>): Promise<T> {
  const hedgeAfterMs = args.hedgeAfterMs;
  if (hedgeAfterMs !== undefined && QURAN.apiBase) {
    return hedgedSourceFallback(args, hedgeAfterMs);
  }

  const state: FallbackState = {};

  if (!isReady && startPromise) await waitForBootBudget();

  const first = await attemptLocal(args, state);
  if (first) {
    args.onStatus?.({ servedBy: "local" });
    return first.value;
  }

  args.onMiss?.();

  if (QURAN.apiBase) {
    try {
      const result = await args.apiFetch(args.signal);
      args.onStatus?.({ servedBy: "api", workerFailure: state.workerFailure });
      return result;
    } catch (e) {
      state.apiFailure = classifyApiFailure(e);
    }
    const recheck = await attemptLocal(args, state, args.coldLocalRead === true);
    if (recheck) {
      args.onStatus?.({ servedBy: "local", apiFailure: state.apiFailure });
      return recheck.value;
    }
  } else if (args.coldLocalRead) {
    const forced = await attemptLocal(args, state, true);
    if (forced) {
      args.onStatus?.({ servedBy: "local" });
      return forced.value;
    }
  }

  return failChain(args, state);
}

export const quranWorker = {
  get ready(): boolean {
    return isReady;
  },
  onStatus(cb: (s: WorkerStatus, detail?: string) => void): () => void {
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
  },
  onProgress(cb: (p: DownloadProgress) => void): () => void {
    progressListeners.add(cb);
    return () => progressListeners.delete(cb);
  },

  hasTranslation(source: QuranReaderSource): Promise<boolean> {
    return request<boolean>((id) => ({ id, type: "hasTranslation", source }));
  },
  ensureTranslation(source: QuranReaderSource): Promise<void> {
    return request<null>((id) => ({ id, type: "ensureTranslation", source })).then(() => undefined);
  },
  setPinnedTranslations(ids: readonly string[]): Promise<void> {
    desiredPinnedTranslations = [...ids];
    return syncPinnedTranslations();
  },

  listArtifacts(): Promise<StorageArtifactInfo[]> {
    return request<unknown>((id) => ({ id, type: "listArtifacts" })).then((raw) => {
      const decoded = decodeStorageArtifacts(raw);
      if (!decoded) throw new Error("quran worker returned a malformed artifact list");
      return decoded;
    });
  },

  async deleteTranslation(sourceId: string): Promise<void> {
    try {
      await request<null>((id) => ({ id, type: "deleteArtifact", sourceId }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "arabic" || message === "busy") throw new StorageAdminError(message);
      throw e;
    }
  },

  whenReady(): Promise<void> {
    if (isReady) return Promise.resolve();
    if (startPromise) return startPromise;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        statusListeners.delete(listener);
        reject(new Error("quran worker did not become ready"));
      }, DEFAULT_TIMEOUT_MS);
      const listener = (status: WorkerStatus, detail?: string) => {
        if (status !== "ready" && status !== "error") return;
        clearTimeout(timer);
        statusListeners.delete(listener);
        if (status === "ready") resolve();
        else reject(new Error(detail ?? "quran worker failed to start"));
      };
      statusListeners.add(listener);
    });
  },

  start(
    artifacts: readonly ArtifactSpec[],
    coordinates: CanonicalQuranCoordinates,
    catalogue?: readonly TranslationCatalogueEntry[],
  ): Promise<void> {
    if (startPromise) return startPromise;
    const attempt = (async () => {
      worker = new Worker(new URL("../workers/quran.worker.ts", import.meta.url), {
        type: "module",
        name: "quran-db",
      });
      worker.addEventListener("message", (e: MessageEvent<WorkerOutbound>) => handle(e.data));
      worker.addEventListener("error", (e: ErrorEvent) => {
        reportWorkerFailure(
          e.error instanceof Error
            ? e.error
            : new Error(`quran worker failed to load: ${e.message}`),
        );
      });
      worker.addEventListener("messageerror", () => {
        reportWorkerFailure(new Error("quran worker message could not be deserialized"));
      });
      await request<null>((id) => ({
        id,
        type: "init",
        artifacts: [...artifacts],
        coordinates,
        catalogue: catalogue ? [...catalogue] : undefined,
      }));
      isReady = true;
    })();
    startPromise = attempt;
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- rejection reason is any thrown value (opaque boundary); instanceof Error narrows it at first use
    void attempt.catch((error: unknown) => {
      if (startPromise === attempt) {
        resetWorker(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return attempt;
  },

  dispose(): void {
    pinnedSyncGeneration += 1;
    desiredPinnedTranslations = null;
    pinnedSyncPromise = null;
    resetWorker(new Error("quran worker disposed"));
  },

  async readSurah(
    num: number,
    source?: QuranReaderSource,
    onStatus?: (status: ReadTierStatus) => void,
    options?: ReadOptions,
  ): Promise<QuranSurahText> {
    const reader = source ?? DEFAULT_QURAN_SOURCE_PLAN.reader;
    if (isArabicSourceId(reader)) {
      return withSourceFallback({
        hasLocal: () => quranWorker.ready,
        workerReq: (id) => ({ id, type: "readSurah", num, source: reader }),
        decode: decodeQuranSurahText,
        apiFetch: (signal) => quranApi.readSurah(reader, num, signal),
        errorMessage: `arabic surah unavailable: ${reader}/${num}`,
        onStatus,
        hedgeAfterMs: options?.hedgeAfterMs,
        signal: options?.signal,
      });
    }
    return withSourceFallback({
      hasLocal: () => (quranWorker.ready ? quranWorker.hasTranslation(reader) : false),
      onMiss: () => {
        void quranWorker.ensureTranslation(reader).catch(() => {});
      },
      workerReq: (id) => ({ id, type: "readSurah", num, source: reader }),
      decode: decodeTranslationSurahText,
      apiFetch: (signal) => quranApi.readSurah(reader, num, signal),
      errorMessage: `translation surah unavailable: ${reader}/${num}`,
      onStatus,
      hedgeAfterMs: options?.hedgeAfterMs,
      signal: options?.signal,
      coldLocalRead: true,
    });
  },

  async readRange(
    from: number,
    to: number,
    validateCoordinate?: AyahCoordinateValidator,
    source?: QuranReaderSource,
    onStatus?: (status: ReadTierStatus) => void,
    options?: ReadOptions,
  ): Promise<QuranRangeText> {
    const reader = source ?? DEFAULT_QURAN_SOURCE_PLAN.reader;
    if (isArabicSourceId(reader)) {
      return withSourceFallback({
        hasLocal: () => quranWorker.ready,
        workerReq: (id) => ({ id, type: "readRange", from, to, source: reader }),
        decode: (raw) => decodeQuranRangeText(raw, validateCoordinate),
        apiFetch: (signal) => quranApi.readRange(reader, from, to, signal, validateCoordinate),
        errorMessage: `arabic range unavailable: ${reader} ${from}-${to}`,
        onStatus,
        hedgeAfterMs: options?.hedgeAfterMs,
        signal: options?.signal,
      });
    }
    return withSourceFallback({
      hasLocal: () => (quranWorker.ready ? quranWorker.hasTranslation(reader) : false),
      onMiss: () => {
        void quranWorker.ensureTranslation(reader).catch(() => {});
      },
      workerReq: (id) => ({ id, type: "readRange", from, to, source: reader }),
      decode: (raw) => decodeTranslationRangeText(raw, validateCoordinate),
      apiFetch: (signal) => quranApi.readRange(reader, from, to, signal, validateCoordinate),
      errorMessage: `translation range unavailable: ${reader} ${from}-${to}`,
      onStatus,
      hedgeAfterMs: options?.hedgeAfterMs,
      signal: options?.signal,
      coldLocalRead: true,
    });
  },

  search(
    query: string,
    opts?: SearchOpts,
    validateCoordinate?: AyahCoordinateValidator,
  ): Promise<SearchResponse> {
    return request<SearchResponse>((id) => ({ id, type: "search", query, opts })).then((r) => {
      const limit = opts?.limit ?? DEFAULT_LIMIT;
      const offset = opts?.offset ?? DEFAULT_OFFSET;
      const payload = decodeSearchResponse(r, validateCoordinate);
      if (!payload) throw new Error("quran worker returned a malformed search response");
      return {
        query,
        total: payload.total ?? payload.results.length,
        limit: payload.limit ?? limit,
        offset: payload.offset ?? offset,
        results: payload.results,
        source: SearchProvider.Worker,
      };
    });
  },
};

export interface RangeRouteKey {
  readonly sourceId: string | null;
  readonly kind: "juz" | "page";
  readonly index: number;
}

export interface RangeDisplaySnapshot {
  readonly ayahs: readonly Ayah[];
  readonly normalizations: readonly SurahNormalization[];
  readonly surahs: readonly SurahLink[];
}

export interface RangeServerInstall {
  readonly read: boolean;
}

export interface RangeClientApply {
  readonly applied: boolean;
}

export interface RangeReaderCoordinator {
  installServer(key: RangeRouteKey, snapshot: RangeDisplaySnapshot): RangeServerInstall;
  applyClientResult(key: RangeRouteKey, snapshot: RangeDisplaySnapshot): RangeClientApply;
  markFailed(key: RangeRouteKey, failure: ReadFailure | undefined): void;
  canRetry(): RangeRouteKey | null;
  currentSnapshot(): RangeDisplaySnapshot;
  currentKey(): RangeRouteKey | null;
  isDegraded(): boolean;
  lastFailure(): ReadFailure | undefined;
}

export function rangeRouteKey(
  sourceId: string | null,
  kind: "juz" | "page",
  index: number,
): RangeRouteKey {
  return { sourceId, kind, index };
}

export function equalRangeKey(a: RangeRouteKey, b: RangeRouteKey): boolean {
  return a.sourceId === b.sourceId && a.kind === b.kind && a.index === b.index;
}

const EMPTY_RANGE_SNAPSHOT: RangeDisplaySnapshot = {
  ayahs: [],
  normalizations: [],
  surahs: [],
};

export function createRangeReaderCoordinator(): RangeReaderCoordinator {
  let currentKey: RangeRouteKey | null = null;
  let displayed: RangeDisplaySnapshot | null = null;
  let degraded = false;
  let failure: ReadFailure | undefined;

  return {
    installServer(key, snapshot) {
      currentKey = key;
      displayed = snapshot;
      degraded = snapshot.ayahs.length === 0;
      failure = undefined;
      return { read: degraded };
    },
    applyClientResult(key, snapshot) {
      if (currentKey === null || !equalRangeKey(key, currentKey)) {
        return { applied: false };
      }
      displayed = snapshot;
      degraded = false;
      failure = undefined;
      return { applied: true };
    },
    markFailed(key, f) {
      if (currentKey === null || !equalRangeKey(key, currentKey)) return;
      degraded = displayed ? displayed.ayahs.length === 0 : true;
      failure = f;
    },
    canRetry() {
      if (currentKey !== null && degraded) return currentKey;
      return null;
    },
    currentSnapshot() {
      return displayed ?? EMPTY_RANGE_SNAPSHOT;
    },
    currentKey() {
      return currentKey;
    },
    isDegraded() {
      return degraded;
    },
    lastFailure() {
      return failure;
    },
  };
}
