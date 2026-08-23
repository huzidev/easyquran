import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("$service-worker", () => ({
  base: "",
  // SAFETY: empty array literal has no elements, so it satisfies string[] without any element-type check
  build: [] as string[],
  // SAFETY: empty array literal has no elements, so it satisfies string[] without any element-type check
  files: [] as string[],
  version: "test-v1",
}));

const { memIdb } = vi.hoisted(() => ({ memIdb: new Map<string, Map<string, unknown>>() }));

vi.mock("../../../../lib/workers/idb", () => ({
  IDB_VERSION: 1,
  openIdb: async (db: string, store: string) => ({ db, store }),
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- mocks lib/workers/idb idbGet; key mirrors the opaque IndexedDB key contract (callers live in service-worker.ts, outside this cluster)
  idbGet: async (h: { db: string; store: string }, store: string, key: unknown) =>
    // SAFETY: the SW only ever passes string data keys; the inner memIdb map is string-keyed and key was narrowed at its write boundary
    memIdb.get(`${h.db} ${store}`)?.get(key as string),
  idbPut: async (
    h: { db: string; store: string },
    store: string,
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- mocks lib/workers/idb idbPut; value is the opaque IDB payload stored verbatim by the SW
    value: unknown,
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- mocks lib/workers/idb idbPut; key mirrors the opaque IndexedDB string key contract
    key?: unknown,
  ) => {
    const k = `${h.db} ${store}`;
    if (!memIdb.has(k)) memIdb.set(k, new Map());
    if (key !== undefined) {
      // SAFETY: the SW only ever passes string data keys; the inner memIdb map is string-keyed
      memIdb.get(k)!.set(key as string, value);
    }
  },
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- mocks lib/workers/idb idbDelete; key mirrors the opaque IndexedDB key contract
  idbDelete: async (h: { db: string; store: string }, store: string, key: unknown) => {
    // SAFETY: the SW only ever passes string data keys; the inner memIdb map is string-keyed
    memIdb.get(`${h.db} ${store}`)?.delete(key as string);
  },
  idbScan: async (h: { db: string; store: string }, store: string, prefix: string) => {
    // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- idbScan returns deserialized IDB values of unknown shape; the SW re-parses per consumer
    const out: Record<string, unknown> = {};
    const storeMap = memIdb.get(`${h.db} ${store}`);
    if (storeMap) {
      for (const [k, v] of storeMap) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      }
    }
    return out;
  },
  runTxVoid: async () => {},
}));

import {
  DATA_CACHE,
  PAGES_CACHE,
  computeStorageStats,
  normalizeDataKey,
  purgeAllDataMeta,
  recordDataEntry,
  storageStatsHandler,
} from "../../../../service-worker";

class FakeCache {
  readonly entries = new Map<string, Response>();

  async match(req: Request | string): Promise<Response | undefined> {
    const key = req instanceof Request ? normalizeDataKey(req.url) : req;
    return this.entries.get(key);
  }

  async put(req: Request | string, res: Response): Promise<void> {
    const key = req instanceof Request ? normalizeDataKey(req.url) : req;
    this.entries.set(key, res);
  }

  async delete(req: Request): Promise<boolean> {
    const key = normalizeDataKey(req.url);
    return this.entries.delete(key);
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((k) => new Request(`https://easyquran.fyi${k}`));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }

  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
}

function responseWith(size: number, contentLength?: string): Response {
  const body = ".".repeat(size);
  const headers = { "content-type": "application/json" };
  const withLength =
    contentLength === undefined ? headers : { ...headers, "content-length": contentLength };
  return new Response(body, { headers: withLength });
}

const ORIGIN = "https://easyquran.fyi";

let fakeCaches: FakeCacheStorage;

beforeEach(async () => {
  memIdb.clear();
  fakeCaches = new FakeCacheStorage();
  vi.stubGlobal("caches", fakeCaches);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage(): void {}
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    },
  );
  await purgeAllDataMeta();
});

afterEach(async () => {
  await purgeAllDataMeta();
  vi.unstubAllGlobals();
});

describe("storageStats accounting", () => {
  it("counts and sizes eq-pages-v1 from the cache itself", async () => {
    const pages = await fakeCaches.open(PAGES_CACHE);
    await pages.put(new Request(`${ORIGIN}/app/al-baqarah`), responseWith(1000));
    await pages.put(new Request(`${ORIGIN}/app/al-fatihah?mode=reading`), responseWith(250));

    const stats = await computeStorageStats();
    expect(stats.pages.entries).toBe(2);
    expect(stats.pages.bytes).toBe(1250);
  });

  it("measures the pages body length, never a trusted content-length header", async () => {
    const pages = await fakeCaches.open(PAGES_CACHE);
    await pages.put(new Request(`${ORIGIN}/app/al-baqarah`), responseWith(300, "1"));
    await pages.put(new Request(`${ORIGIN}/app/al-fatihah`), responseWith(120, "9999"));

    const stats = await computeStorageStats();
    expect(stats.pages.entries).toBe(2);
    expect(stats.pages.bytes).toBe(420);
  });

  it("sums eq-data-v1 from scanDataMeta — the same accounting the budget enforcer uses", async () => {
    const data = await fakeCaches.open(DATA_CACHE);
    for (let i = 1; i <= 3; i++) {
      const key = `/app/juz/${i}/__data.json`;
      await data.put(new Request(`${ORIGIN}${key}`), responseWith(64));
      await recordDataEntry(key, responseWith(64));
    }

    const stats = await computeStorageStats();
    expect(stats.data.entries).toBe(3);
    expect(stats.data.bytes).toBe(192);
  });

  it("skips data-meta records whose cache entry was already evicted", async () => {
    const data = await fakeCaches.open(DATA_CACHE);
    const liveKey = "/app/juz/1/__data.json";
    await data.put(new Request(`${ORIGIN}${liveKey}`), responseWith(64));
    await recordDataEntry(liveKey, responseWith(64));
    await recordDataEntry("/app/juz/9/__data.json", responseWith(512));

    const stats = await computeStorageStats();
    expect(stats.data.entries).toBe(1);
    expect(stats.data.bytes).toBe(64);
  });

  it("keeps pages and data layers independent (pack and app caches never counted)", async () => {
    const pack = await fakeCaches.open("eq-pack-pack-xyz");
    await pack.put(new Request(`${ORIGIN}/app/juz/1`), responseWith(9999));
    const app = await fakeCaches.open("eq-app-test-v1");
    await app.put(new Request(`${ORIGIN}/_app/immutable/a.js`), responseWith(8888));

    const stats = await computeStorageStats();
    expect(stats.pages.entries).toBe(0);
    expect(stats.pages.bytes).toBe(0);
    expect(stats.data.entries).toBe(0);
    expect(stats.data.bytes).toBe(0);
  });

  it("storageStatsHandler replies with a STORAGE_STATS_ACK carrying both layers", async () => {
    const pages = await fakeCaches.open(PAGES_CACHE);
    await pages.put(new Request(`${ORIGIN}/app/al-baqarah`), responseWith(120));
    const data = await fakeCaches.open(DATA_CACHE);
    const key = "/app/juz/2/__data.json";
    await data.put(new Request(`${ORIGIN}${key}`), responseWith(30));
    await recordDataEntry(key, responseWith(30));

    const posted: unknown[] = [];
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes MessagePort.postMessage; message is the opaque structured-clone payload the SW ack writes
    const port = {
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes MessagePort.postMessage; message is the opaque structured-clone payload the SW ack writes
      postMessage: (message: unknown): void => {
        posted.push(message);
      },
    };
    // SAFETY: storageStatsHandler reads only postMessage off the port; the fake satisfies that single call surface.
    await storageStatsHandler(port as MessagePort);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: "STORAGE_STATS_ACK",
      pages: { entries: 1, bytes: 120 },
      data: { entries: 1, bytes: 30 },
    });
  });
});
