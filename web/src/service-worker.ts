/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { base, build, files, version } from "$service-worker";

import {
  SKIP_WAITING,
  APP_READY,
  UPDATE_TAKEOVER,
  PURGE_USER_CACHES,
  PURGE_ACK,
  STORAGE_STATS,
  STORAGE_STATS_ACK,
  SW_BROADCAST_CHANNEL,
  type ClientToSwMessage,
  type StorageLayerStats,
  type SwToClientMessage,
} from "./lib/offline/messages";
import { openIdb, idbGet, idbPut, idbDelete, idbScan } from "./lib/workers/idb";

// SAFETY: this file is the service-worker entry (compiled with the webworker
// lib reference above), so `self` is the worker global at runtime; the DOM lib
// also declares `self`, forcing a widen to cross the incompatible declarations.
const selfAny = self as unknown;
// SAFETY: carried over from `selfAny` above — same global object, re-branded
// with the worker scope the rest of this module uses.
const sw = selfAny as ServiceWorkerGlobalScope;

const APP_CACHE = `eq-app-${version}`;
export const PAGES_CACHE = "eq-pages-v1";
export const DATA_CACHE = "eq-data-v1";

const META_DB = "easyquran-sw-meta";
const META_STORE = "meta";

const SHELL_ROUTE = `${base}/404.html`;
const NAV_TIMEOUT_MS = 3500;
export const PAGES_MAX = 300;
export const DATA_MAX = 400;
export const DATA_BUDGET_BYTES = 32 * 1024 * 1024;
const MAINTENANCE_CONCURRENCY = 6;

const PRECACHE = Array.from(
  new Set([...build, ...files, "/", "/en/app", `${base}/quran-meta/quran-data.json`]),
);

const IMMUTABLE = new Set([...build, ...files]);

export function normalizeDataKey(url: string | URL): string {
  const u = url instanceof URL ? url : new URL(url, sw.location.origin);
  const params = new URLSearchParams();
  for (const [key, value] of u.searchParams) {
    if (key.startsWith("x-sveltekit-")) continue;
    if (key === "mode") continue;
    if (key === "more") continue;
    params.append(key, value);
  }
  const search = params.size > 0 ? `?${params.toString()}` : "";
  return `${u.pathname}${search}`;
}

export function isPending(res: Response): boolean {
  return res.headers.get("x-eq-translation-pending") === "1";
}

export function isCacheable(res: Response): boolean {
  const cc = res.headers.get("cache-control");
  if (cc && (/no-store/i.test(cc) || /private/i.test(cc))) return false;
  if (isPending(res)) return false;
  return true;
}

function db(): Promise<IDBDatabase> {
  return openIdb(META_DB, META_STORE);
}

async function metaGet<T>(key: string): Promise<T | undefined> {
  try {
    return await idbGet<T>(await db(), META_STORE, key);
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- values are heterogeneous IndexedDB records (ack version strings, maintenance cursor, recency maps); the IDB value slot is structurally untyped by design
async function metaSet(key: string, value: unknown): Promise<void> {
  try {
    await idbPut(await db(), META_STORE, value, key);
  } catch {}
}

async function metaDel(key: string): Promise<void> {
  try {
    await idbDelete(await db(), META_STORE, key);
  } catch {}
}

async function metaScan<T>(prefix: string): Promise<Record<string, T>> {
  try {
    return await idbScan<T>(await db(), META_STORE, prefix);
  } catch {
    return {};
  }
}

interface DataMetaEntry {
  key: string;
  lastUsed: number;
  sizeBytes: number;
}

const DATA_META_PREFIX = "data:";

function dataMetaId(key: string): string {
  return `${DATA_META_PREFIX}${key}`;
}

async function measureResponseSize(res: Response): Promise<number> {
  // Measure the decompressed body, never trust Content-Length: prerendered
  // __data.json is served precompressed, so the header reflects the encoded
  // (or absent) size while the cache stores the full decoded body.
  try {
    return (await res.clone().arrayBuffer()).byteLength;
  } catch {
    return 0;
  }
}

let dataMetaLock: Promise<void> = Promise.resolve();
function serializeDataMeta(fn: () => Promise<void>): Promise<void> {
  const next = dataMetaLock.then(fn, fn);
  dataMetaLock = next.catch(() => undefined);
  return next;
}

let recencyLock: Promise<void> = Promise.resolve();
function serializeRecency(fn: () => Promise<void>): Promise<void> {
  const next = recencyLock.then(fn, fn);
  recencyLock = next.catch(() => undefined);
  return next;
}

async function rawDataMetaDel(key: string): Promise<void> {
  try {
    await idbDelete(await db(), META_STORE, dataMetaId(key));
  } catch {}
}

async function rawDataMetaSet(entry: DataMetaEntry): Promise<void> {
  try {
    await idbPut(await db(), META_STORE, entry, dataMetaId(entry.key));
  } catch {}
}

async function rawDataMetaGet(key: string): Promise<DataMetaEntry | undefined> {
  try {
    return await idbGet<DataMetaEntry>(await db(), META_STORE, dataMetaId(key));
  } catch {
    return undefined;
  }
}

async function rawDataMetaScan(): Promise<Map<string, DataMetaEntry>> {
  const obj = await metaScan<DataMetaEntry>(DATA_META_PREFIX);
  return new Map(Object.entries(obj));
}

export async function recordDataEntry(key: string, res: Response): Promise<void> {
  const sizeBytes = await measureResponseSize(res);
  const lastUsed = Date.now();
  return serializeDataMeta(() => rawDataMetaSet({ key, lastUsed, sizeBytes }));
}

export function touchDataMeta(key: string): Promise<void> {
  return serializeDataMeta(async () => {
    const existing = await rawDataMetaGet(key);
    if (!existing) return;
    await rawDataMetaSet({ key, lastUsed: Date.now(), sizeBytes: existing.sizeBytes });
  });
}

export function deleteDataMeta(key: string): Promise<void> {
  return serializeDataMeta(() => rawDataMetaDel(key));
}

export function purgeAllDataMeta(): Promise<void> {
  return serializeDataMeta(async () => {
    const entries = await rawDataMetaScan();
    await Promise.all([...entries.keys()].map((key) => rawDataMetaDel(key)));
  });
}

export async function purgeUserCachesHandler(port?: MessagePort): Promise<void> {
  try {
    await caches.delete(PAGES_CACHE);
    await caches.delete(DATA_CACHE);
    await purgeAllDataMeta();
    await serializeRecency(() => metaSet("recency", {}));
  } catch {}
  if (port) {
    try {
      port.postMessage({ type: PURGE_ACK } satisfies SwToClientMessage);
    } catch {}
  }
}

const EMPTY_LAYER_STATS: StorageLayerStats = Object.freeze({ entries: 0, bytes: 0 });

async function measurePagesCache(): Promise<StorageLayerStats> {
  const pages = await caches.open(PAGES_CACHE);
  const reqs = [...(await pages.keys())];
  const sizes = reqs.map(() => 0);
  await pool(reqs, MAINTENANCE_CONCURRENCY, async (req, index) => {
    const res = await pages.match(req).catch(() => undefined);
    if (!res) return;
    sizes[index] = await measureResponseSize(res);
  });
  let bytes = 0;
  for (const size of sizes) bytes += size;
  return { entries: reqs.length, bytes };
}

async function measureDataCache(): Promise<StorageLayerStats> {
  const meta = await rawDataMetaScan();
  const data = await caches.open(DATA_CACHE);
  const cacheKeys = new Set<string>();
  for (const req of await data.keys()) cacheKeys.add(normalizeDataKey(req.url));
  let bytes = 0;
  let entries = 0;
  for (const [key, entry] of meta) {
    if (!cacheKeys.has(key)) continue;
    bytes += entry.sizeBytes;
    entries += 1;
  }
  return { entries, bytes };
}

export async function computeStorageStats(): Promise<{
  pages: StorageLayerStats;
  data: StorageLayerStats;
}> {
  const [pages, data] = await Promise.all([
    measurePagesCache().catch(() => EMPTY_LAYER_STATS),
    measureDataCache().catch(() => EMPTY_LAYER_STATS),
  ]);
  return { pages, data };
}

export async function storageStatsHandler(port?: MessagePort): Promise<void> {
  const stats = await computeStorageStats();
  if (!port) return;
  try {
    port.postMessage({
      type: STORAGE_STATS_ACK,
      pages: stats.pages,
      data: stats.data,
    } satisfies SwToClientMessage);
  } catch {}
}

export async function enforceDataBoundsInner(): Promise<void> {
  const data = await caches.open(DATA_CACHE);
  const meta = await rawDataMetaScan();
  const cacheReqs = await data.keys();
  const cacheKeys = new Set<string>();
  for (const req of cacheReqs) cacheKeys.add(normalizeDataKey(req.url));

  for (const key of meta.keys()) {
    if (!cacheKeys.has(key)) {
      await rawDataMetaDel(key);
      meta.delete(key);
    }
  }
  const missingMeta: string[] = [];
  for (const key of cacheKeys) if (!meta.has(key)) missingMeta.push(key);

  const entries = [...meta.values()].sort((a, b) => a.lastUsed - b.lastUsed);
  let totalBytes = 0;
  for (const e of entries) totalBytes += e.sizeBytes;
  let count = cacheKeys.size;

  for (const entry of entries) {
    if (count <= DATA_MAX && totalBytes <= DATA_BUDGET_BYTES) break;
    const deleted = await data.delete(new Request(entry.key)).catch(() => false);
    await rawDataMetaDel(entry.key);
    if (deleted) count--;
    totalBytes -= entry.sizeBytes;
  }
  for (const key of missingMeta) {
    if (count <= DATA_MAX) break;
    const deleted = await data.delete(new Request(key)).catch(() => false);
    if (deleted) count--;
  }
}

export function enforceDataBounds(): Promise<void> {
  return serializeDataMeta(enforceDataBoundsInner);
}

export async function readDataMeta(key: string): Promise<DataMetaEntry | undefined> {
  return rawDataMetaGet(key);
}

export async function scanDataMeta(): Promise<Map<string, DataMetaEntry>> {
  return rawDataMetaScan();
}

let broadcastChannel: BroadcastChannel | null = null;
function getBroadcast(): BroadcastChannel | null {
  if (broadcastChannel) return broadcastChannel;
  try {
    broadcastChannel = new BroadcastChannel(SW_BROADCAST_CHANNEL);
  } catch {
    broadcastChannel = null;
  }
  return broadcastChannel;
}

async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next;
      next++;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  }
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(run());
  await Promise.all(runners);
}

sw.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

async function precache(): Promise<void> {
  try {
    const cache = await caches.open(APP_CACHE);
    await Promise.all(
      PRECACHE.map(async (url) => {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res || !res.ok) {
          throw new Error(`precache ${url} failed: ${res ? res.status : "no response"}`);
        }
        await cache.put(url, res);
      }),
    );
    const shellCtrl = new AbortController();
    const shellTimer = setTimeout(() => shellCtrl.abort(), 4000);
    const shell = await fetch(SHELL_ROUTE, {
      cache: "no-cache",
      signal: shellCtrl.signal,
    }).catch(() => null);
    clearTimeout(shellTimer);
    if (shell && shell.ok) await cache.put(SHELL_ROUTE, shell);
  } catch (err) {
    await caches.delete(APP_CACHE).catch(() => {});
    throw err;
  }
}

sw.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

async function activate(): Promise<void> {
  await sw.clients.claim();
  const keys = await caches.keys();
  const priorExisted = keys.some((k) => k.startsWith("eq-app-") && k !== APP_CACHE);
  const prev = await metaGet<string>("installedVersion");
  if (prev && prev !== version) {
    await setCursor(null);
  }
  await metaSet("installedVersion", version);
  await purgeLegacyReaderPaths();
  void enforceDataBounds();
  if (priorExisted) announceTakeover();
}

function isLegacyReaderPath(url: string): boolean {
  const pathname = new URL(url, sw.location.origin).pathname;
  return pathname === "/app" || pathname.startsWith("/app/");
}

async function purgeLegacyReaderPaths(): Promise<void> {
  for (const cacheName of [PAGES_CACHE, DATA_CACHE]) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter((request) => isLegacyReaderPath(request.url))
        .map((request) => cache.delete(request)),
    );
  }
  const dataMeta = await rawDataMetaScan();
  await Promise.all(
    [...dataMeta.keys()].filter((url) => isLegacyReaderPath(url)).map((key) => rawDataMetaDel(key)),
  );
  await serializeRecency(async () => {
    const recency = (await metaGet<Record<string, number>>("recency")) || {};
    let changed = false;
    for (const key of Object.keys(recency)) {
      if (isLegacyReaderPath(key)) {
        delete recency[key];
        changed = true;
      }
    }
    if (changed) await metaSet("recency", recency);
  });
}

function announceTakeover(): void {
  const message: SwToClientMessage = { type: UPDATE_TAKEOVER, version };
  void sw.clients
    .matchAll({ includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) client.postMessage(message);
    })
    .catch(() => {});
  const channel = getBroadcast();
  if (channel) {
    try {
      channel.postMessage(message);
    } catch {}
  }
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- m is event.data from postMessage, an opaque runtime boundary; this guard is the parse
function isClientToSw(m: unknown): m is ClientToSwMessage {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- discriminating an opaque postMessage payload; no parse seam exists at a bare MessageEvent
  if (!m || typeof m !== "object") return false;
  // SAFETY: m is narrowed to a non-null object by the guard above; the cast
  // only widens the property read for the string check below.
  const type = (m as { type?: unknown }).type;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrowing the untyped payload field to string; no schema boundary exists in the SW message path
  return typeof type === "string";
}

function isClient(source: Client | ServiceWorker | MessagePort | null): source is Client {
  return !!source && "id" in source;
}

sw.addEventListener("message", (event) => {
  if (!isClientToSw(event.data)) return;
  const data = event.data;
  switch (data.type) {
    case SKIP_WAITING:
      void sw.skipWaiting();
      return;
    case APP_READY:
      void onAppReady(isClient(event.source) ? event.source : null);
      return;
    case PURGE_USER_CACHES:
      void purgeUserCachesHandler(event.ports[0]);
      return;
    case STORAGE_STATS:
      void storageStatsHandler(event.ports[0]);
      return;
  }
});

async function onAppReady(source: Client | null): Promise<void> {
  if (source) {
    await metaSet(`ack:${source.id}`, version);
  }
  await maybeFinalizeHandoff();
  void runMaintenance();
}

async function maybeFinalizeHandoff(): Promise<void> {
  const live = await sw.clients.matchAll({ includeUncontrolled: false });
  const liveIds = new Set(live.map((c) => c.id));
  const acks = await metaScan<string>("ack:");
  await Promise.all(
    Object.keys(acks)
      .filter((id) => !liveIds.has(id))
      .map((id) => metaDel(`ack:${id}`)),
  );
  if (live.length === 0) return;
  const allAcked = live.every((c) => acks[c.id] === version);
  if (!allAcked) return;
  await pruneOldAppCaches();
}

async function pruneOldAppCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith("eq-app-") && k !== APP_CACHE).map((k) => caches.delete(k)),
  );
}

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname === "/quran" || url.pathname.startsWith("/quran/")) return;
  if (url.pathname === "/_quran" || url.pathname.startsWith("/_quran/")) return;
  if (url.hostname.endsWith("r2.easyquran.fyi")) return;
  if (url.pathname === "/firebase-config.js") return;
  if (url.pathname.includes("/translations/")) return;
  if (url.origin === sw.location.origin && url.pathname.startsWith("/api/")) return;

  if (
    url.pathname === "/_app/version.json" ||
    url.pathname === "/service-worker.js" ||
    url.pathname === "/offline/manifest.json" ||
    (url.pathname.startsWith("/offline/pack.") && url.pathname.endsWith(".json"))
  ) {
    return;
  }

  if (url.pathname.startsWith("/_app/immutable/")) {
    event.respondWith(cacheFirstApp(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
    return;
  }

  if (url.origin === sw.location.origin && url.pathname.endsWith("/__data.json")) {
    event.respondWith(handleData(req));
    return;
  }

  if (url.origin === sw.location.origin && IMMUTABLE.has(url.pathname)) {
    event.respondWith(cacheFirstApp(req));
    return;
  }

  if (url.origin === sw.location.origin) {
    event.respondWith(swrApp(req));
  }
});

async function cacheFirstApp(req: Request): Promise<Response> {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok && isCacheable(res)) {
      void cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return Response.error();
  }
}

export async function handleNavigation(req: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
  let network: Response | null = null;
  try {
    network = await fetch(req, { signal: controller.signal });
  } catch {
    network = null;
  } finally {
    clearTimeout(timeout);
  }

  const key = normalizeDataKey(req.url);

  if (network && network.ok && network.type !== "opaque" && isCacheable(network)) {
    const pages = await caches.open(PAGES_CACHE);
    await pages.put(new Request(key), network.clone()).catch(() => {});
    await touchRecency(req.url);
    return network;
  }
  if (network) return network;

  const app = await caches.open(APP_CACHE);
  const shellHit = await app.match(req);
  if (shellHit) {
    await touchRecency(req.url);
    return shellHit;
  }

  const pages = await caches.open(PAGES_CACHE);
  const pageHit = await pages.match(new Request(key));
  if (pageHit) {
    if (!isCacheable(pageHit)) {
      await pages.delete(new Request(key)).catch(() => {});
    } else {
      await touchRecency(req.url);
      return pageHit;
    }
  }

  const fallback = await app.match(SHELL_ROUTE);
  return fallback || Response.error();
}

export async function handleData(req: Request): Promise<Response> {
  const key = normalizeDataKey(req.url);
  const data = await caches.open(DATA_CACHE);
  let hit = await data.match(key);

  if (hit && !isCacheable(hit)) {
    await data.delete(new Request(key)).catch(() => {});
    await deleteDataMeta(key);
    hit = undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
  const revalidate = fetch(req, { signal: controller.signal })
    .then(async (res) => {
      if (!res || !res.ok || !isCacheable(res)) return res;
      try {
        await data.put(new Request(key), res.clone());
        void recordDataEntry(key, res);
        void enforceDataBounds();
      } catch {
        await deleteDataMeta(key);
      }
      return res;
    })
    .catch(() => null)
    .finally(() => clearTimeout(timeout));

  if (hit) {
    void revalidate;
    void touchDataMeta(key);
    return hit;
  }

  const fresh = await revalidate;
  if (fresh && fresh.ok) return fresh;

  const activePack = await metaGet<{ packId?: string } | null>("activePack");
  const packId = activePack?.packId;
  if (packId) {
    const packName = `eq-pack-${packId}`;
    if (await caches.has(packName)) {
      const packHit = await caches.match(new Request(key), {
        cacheName: packName,
      });
      if (packHit) return packHit;
    }
  }
  return Response.error();
}

async function swrApp(req: Request): Promise<Response> {
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then(async (res) => {
      if (res && res.ok && isCacheable(res)) {
        await cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  if (hit) {
    void network;
    return hit;
  }
  const fresh = await network;
  return fresh || Response.error();
}

async function touchRecency(rawUrl: string): Promise<void> {
  const key = normalizeDataKey(rawUrl);
  return serializeRecency(async () => {
    const recency = (await metaGet<Record<string, number>>("recency")) || {};
    recency[key] = Date.now();
    await metaSet("recency", recency);
  });
}

let maintenanceInFlight = false;

type MaintenanceCursor =
  | { stage: "pages"; offset: number }
  | { stage: "data"; offset: number }
  | { stage: "trim" }
  | { stage: "done" }
  | null;

async function setCursor(cursor: MaintenanceCursor): Promise<void> {
  await metaSet("maintenance", { cursor });
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the maintenance record read back from IndexedDB, which returns it untyped; this fn is the parse
function normalizeCursor(raw: unknown): MaintenanceCursor {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- opaque IDB record; the runtime object check is the only available discriminator
  if (raw && typeof raw === "object") {
    // SAFETY: raw is a non-null object by the guard above; the cast only
    // exposes the persisted fields for validation below.
    const c = raw as { stage?: unknown; offset?: unknown };
    if (c.stage === "trim") return { stage: "trim" };
    if (c.stage === "done") return { stage: "done" };
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- validating the persisted offset field; no schema/parser seam exists in the SW
    if ((c.stage === "pages" || c.stage === "data") && typeof c.offset === "number") {
      return { stage: c.stage, offset: c.offset };
    }
  }
  return null;
}

async function runMaintenance(): Promise<void> {
  if (maintenanceInFlight) return;
  maintenanceInFlight = true;
  try {
    const meta = await metaGet<{ cursor: unknown }>("maintenance");
    let cursor: MaintenanceCursor = normalizeCursor(meta?.cursor);
    let successes = 0;
    let attempted = 0;
    for (;;) {
      if (cursor === null) {
        const r = await revalidateCache(PAGES_CACHE, 0, "pages");
        successes += r.successes;
        attempted += r.attempted;
        cursor = { stage: "data", offset: 0 };
        await setCursor(cursor);
        continue;
      }
      switch (cursor.stage) {
        case "pages": {
          const r = await revalidateCache(PAGES_CACHE, cursor.offset, "pages");
          successes += r.successes;
          attempted += r.attempted;
          cursor = { stage: "data", offset: 0 };
          await setCursor(cursor);
          continue;
        }
        case "data": {
          const r = await revalidateCache(DATA_CACHE, cursor.offset, "data");
          successes += r.successes;
          attempted += r.attempted;
          cursor = { stage: "trim" };
          await setCursor(cursor);
          continue;
        }
        case "trim": {
          await trimPages();
          await enforceDataBounds();
          if (attempted > 0 && successes === 0) {
            await setCursor(null);
            return;
          }
          cursor = { stage: "done" };
          await setCursor(cursor);
          continue;
        }
        case "done": {
          return;
        }
        default: {
          const _: never = cursor;
          void _;
          return;
        }
      }
    }
  } finally {
    maintenanceInFlight = false;
  }
}

async function revalidateCache(
  cacheName: string,
  start: number,
  stage: "pages" | "data",
): Promise<{ successes: number; attempted: number }> {
  const cache = await caches.open(cacheName);
  const all = await cache.keys();
  const slice = all.slice(start).map((req, i) => ({ req, idx: start + i }));
  const done = new Set<number>();
  let contiguous = start;
  let successes = 0;
  await pool(slice, MAINTENANCE_CONCURRENCY, async (item) => {
    let ok = false;
    try {
      const res = await fetch(item.req, { cache: "no-store" });
      if (res && res.ok && isCacheable(res)) {
        await cache.put(item.req, res.clone());
        if (stage === "data") void recordDataEntry(normalizeDataKey(item.req.url), res);
        ok = true;
      }
    } catch {
      // keep stale on failure
    }
    if (ok) successes++;
    done.add(item.idx);
    while (done.has(contiguous)) contiguous++;
    await setCursor({ stage, offset: contiguous });
  });
  return { successes, attempted: slice.length };
}

async function trimPages(): Promise<void> {
  const cache = await caches.open(PAGES_CACHE);
  const reqs = await cache.keys();
  if (reqs.length <= PAGES_MAX) return;
  await serializeRecency(async () => {
    const recency = (await metaGet<Record<string, number>>("recency")) || {};
    const scored = reqs.map((req) => ({
      req,
      last: recency[normalizeDataKey(req.url)] ?? 0,
    }));
    scored.sort((a, b) => a.last - b.last);
    const evict = scored.slice(0, reqs.length - PAGES_MAX);
    const nextRecency = { ...recency };
    for (const { req } of evict) {
      await cache.delete(req).catch(() => {});
      const key = normalizeDataKey(req.url);
      delete nextRecency[key];
    }
    await metaSet("recency", nextRecency);
  });
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the url field of an untrusted push JSON payload; this fn validates it before use
function safeTarget(raw: unknown): string {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- untrusted push payload field; the runtime string check precedes URL parsing
  if (typeof raw !== "string" || raw.length === 0) return "/";
  try {
    const u = new URL(raw, sw.location.origin);
    if (u.origin !== sw.location.origin) return "/";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/";
  }
}

interface PushPayload {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
}

sw.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    // SAFETY: event.data.json() returns untyped JSON; PushPayload fields are
    // all optional and every read below falls back when data is missing.
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = {};
  }
  const n = payload.notification || {};
  const data = payload.data || {};
  const title = n.title || data.title || "EasyQuran";
  const body = n.body || data.body || "";
  const url = safeTarget(data.url);
  event.waitUntil(
    sw.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined,
      data: Object.assign({ url }, data),
    }),
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target: string = safeTarget(event.notification?.data?.url);
  event.waitUntil(
    (async () => {
      const all = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        await client.focus();
        try {
          await client.navigate(target);
        } catch {
          void 0;
        }
        return;
      }
      await sw.clients.openWindow(target);
    })(),
  );
});
