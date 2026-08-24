import type { TranslationCatalogueEntry } from "$lib/data/quran-types";
import init, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

class FakeFileHandle {
  constructor(
    public parent: FakeDirHandle,
    public name: string,
  ) {}
  get bytes(): Uint8Array {
    return this.parent.files.get(this.name)!;
  }
  async getFile() {
    return {
      size: this.bytes.byteLength,
      arrayBuffer: async () => this.bytes.buffer.slice(0),
    };
  }
  async createWritable() {
    let buf = new Uint8Array(0);
    return {
      write: async (chunk: Uint8Array) => {
        buf = chunk.slice(0);
      },
      close: async () => {
        this.parent.files.set(this.name, buf);
      },
    };
  }
}

class FakeDirHandle {
  dirs = new Map<string, FakeDirHandle>();
  files = new Map<string, Uint8Array>();
  constructor(public name = "") {}
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeDirHandle> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!opts.create) throw new DOMException(name, "NotFoundError");
    const d = new FakeDirHandle(name);
    this.dirs.set(name, d);
    return d;
  }
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeFileHandle> {
    if (this.files.has(name)) return new FakeFileHandle(this, name);
    if (!opts.create) throw new DOMException(name, "NotFoundError");
    this.files.set(name, new Uint8Array(0));
    return new FakeFileHandle(this, name);
  }
  async *keys(): AsyncIterable<string> {
    for (const n of [...this.dirs.keys(), ...this.files.keys()]) yield n;
  }
  async removeEntry(name: string): Promise<void> {
    if (this.dirs.has(name)) {
      this.dirs.delete(name);
      return;
    }
    if (!this.files.has(name)) throw new DOMException(name, "NotFoundError");
    this.files.delete(name);
  }
}

interface FakeReq {
  result: unknown;
  error: DOMException | null;
  onsuccess: ((req: FakeReq) => void) | null;
  onerror: ((req: FakeReq) => void) | null;
  onupgradeneeded: ((req: FakeReq) => void) | null;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes an IDB request; result is the opaque value the fake resolves and the real callers live in production idb.ts
function makeReq(result: unknown): FakeReq {
  const req: FakeReq = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => req.onsuccess?.(req));
  return req;
}

interface FakeTx {
  objectStore(store: string): {
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.get; key is an opaque IDB valid key and the real caller is production idb.ts
    get(key: unknown): FakeReq;
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.put; value/key are opaque structured-clone data and the real caller is production idb.ts
    put(value: unknown, key?: unknown): FakeReq;
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.delete; key is an opaque IDB valid key and the real caller is production idb.ts
    delete(key: unknown): FakeReq;
    openCursor(): FakeReq;
    openKeyCursor(): FakeReq;
  };
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

interface FakeDB {
  name: string;
  stores: Map<string, Map<unknown, unknown>>;
  objectStoreNames: { contains(n: string): boolean };
  transaction(store: string, mode: IDBTransactionMode): FakeTx;
  createObjectStore(name: string): void;
  close(): void;
}

function makeDB(name: string): FakeDB {
  const stores = new Map<string, Map<unknown, unknown>>();
  const db: FakeDB = {
    name,
    stores,
    objectStoreNames: { contains: (n) => stores.has(n) },
    transaction(store) {
      const data = stores.get(store)!;
      const handle = {
        // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.get; key is an opaque IDB valid key and the real caller is production idb.ts
        get: (key: unknown) => makeReq(data.has(key) ? data.get(key) : undefined),
        // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.put; value/key are opaque structured-clone data and the real caller is production idb.ts
        put: (value: unknown, key?: unknown) => {
          const k = key === undefined ? `auto:${data.size}` : key;
          data.set(k, value);
          return makeReq(undefined);
        },
        // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.delete; key is an opaque IDB valid key and the real caller is production idb.ts
        delete: (key: unknown) => {
          data.delete(key);
          return makeReq(undefined);
        },
        openCursor: () => {
          const entries = [...data.entries()];
          let index = 0;
          const req: FakeReq = {
            result: null,
            error: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          const advance = (): void => {
            if (index < entries.length) {
              // eslint-disable-next-line anti-slop/no-unknown-parameters -- cursor payload mirrors the opaque IDBCursor key/value pair the production cursor contract exposes
              const [key, value] = entries[index]!;
              req.result = {
                key,
                value,
                continue: () => {
                  index++;
                  advance();
                },
              };
            } else {
              req.result = null;
            }
            queueMicrotask(() => req.onsuccess?.(req));
          };
          advance();
          return req;
        },
        openKeyCursor: () => {
          const keys = [...data.keys()];
          let index = 0;
          const req: FakeReq = {
            result: null,
            error: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          const advance = (): void => {
            if (index < keys.length) {
              // eslint-disable-next-line anti-slop/no-unknown-parameters -- cursor payload mirrors the opaque IDBCursor key the production key-cursor contract exposes
              const key = keys[index]!;
              req.result = {
                key,
                value: undefined,
                continue: () => {
                  index++;
                  advance();
                },
              };
            } else {
              req.result = null;
            }
            queueMicrotask(() => req.onsuccess?.(req));
          };
          advance();
          return req;
        },
      };
      const tx: FakeTx = {
        objectStore: () => handle,
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    createObjectStore(store) {
      stores.set(store, new Map());
    },
    close() {},
  };
  return db;
}

let fakeRoot: FakeDirHandle | undefined;
let fakeDbs: Map<string, FakeDB> | undefined;

function installFakes(): void {
  if (!fakeRoot || !fakeDbs) {
    fakeRoot = new FakeDirHandle();
    fakeDbs = new Map();
  }
  const root = fakeRoot;
  const dbByName = fakeDbs;
  // SAFETY: globalThis.indexedDB is a real runtime global in the test env; cast exposes the slot to install the fake IDB factory.
  (globalThis as { indexedDB: unknown }).indexedDB = {
    open: (name: string): FakeReq => {
      const isNew = !dbByName.has(name);
      if (isNew) dbByName.set(name, makeDB(name));
      const db = dbByName.get(name)!;
      const req: FakeReq = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (isNew) {
          for (const store of db.stores.keys()) {
            if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
          }
          req.onupgradeneeded?.(req);
        }
        req.onsuccess?.(req);
      });
      return req;
    },
  };
  Object.defineProperty(globalThis.navigator, "storage", {
    value: { getDirectory: async () => root },
    configurable: true,
    writable: true,
  });
}

function resetFakes(): void {
  fakeRoot?.dirs.clear();
  fakeRoot?.files.clear();
  for (const db of fakeDbs?.values() ?? []) {
    for (const store of db.stores.values()) store.clear();
  }
}

async function seedTranslation(id: string, bytes: Uint8Array): Promise<void> {
  const root = fakeRoot!;
  const top = await root.getDirectoryHandle("easyquran", { create: true });
  const dir = await top.getDirectoryHandle(id, { create: true });
  const fh = await dir.getFileHandle(`${id}.sqlite`, { create: true });
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
  seedIdbRecord("easyquran-pointers", "opfsPointers", id, {
    sourceId: id,
    activeFile: `${id}.sqlite`,
  });
  await flush();
}

function seedIdbRecord(
  dbName: string,
  store: string,
  key: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- test seeding helper; value is the opaque structured-clone record the fake IDB stores verbatim
  value: unknown,
): void {
  const dbs = fakeDbs!;
  if (!dbs.has(dbName)) dbs.set(dbName, makeDB(dbName));
  const db = dbs.get(dbName)!;
  if (!db.stores.has(store)) db.stores.set(store, new Map());
  db.stores.get(store)!.set(key, value);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

interface BuildRow {
  index: number;
  sura: number;
  aya: number;
  text: string;
}

let builder: Sqlite3Static | null = null;

function serializeQuranDb(rows: readonly BuildRow[]): Uint8Array {
  const s = builder!;
  const db = new s.oo1.DB();
  db.exec('CREATE TABLE quran_text ("index" INTEGER, sura INTEGER, aya INTEGER, text TEXT)');
  const stmt = db.prepare("INSERT INTO quran_text VALUES (?,?,?,?)");
  try {
    for (const r of rows) {
      stmt.bind([r.index, r.sura, r.aya, r.text]);
      stmt.step();
      stmt.reset();
    }
  } finally {
    stmt.finalize();
  }
  const capi = s.capi;
  const wasm = s.wasm;
  const pSize = wasm.alloc(8);
  const dataPtr = capi.sqlite3_serialize(db, "main", pSize, 0);
  const heap = wasm.heap8u();
  const size = Number(new DataView(heap.buffer, heap.byteOffset + pSize, 8).getBigInt64(0, true));
  const bytes = new Uint8Array(heap.buffer, heap.byteOffset + dataPtr, size).slice();
  db.close();
  wasm.dealloc(pSize);
  return bytes;
}

const ROWS: readonly BuildRow[] = [
  { index: 1, sura: 1, aya: 1, text: "Allah is full of Mercy." },
  { index: 2, sura: 1, aya: 2, text: "An entirely different verse." },
  { index: 3, sura: 1, aya: 3, text: "MERCY twice mercy" },
  { index: 4, sura: 1, aya: 4, text: "The throne verse." },
];

const GAPPED_ROWS: readonly BuildRow[] = [
  { index: 1, sura: 1, aya: 1, text: "Allah is full of Mercy." },
  { index: 2, sura: 1, aya: 2, text: "An entirely different verse." },
  { index: 4, sura: 1, aya: 4, text: "The throne verse." },
];

function catalogueFor(id: string, bytes: Uint8Array): TranslationCatalogueEntry {
  return {
    id,
    language: "English",
    languageCode: "en",
    direction: "ltr",
    name: `Test ${id}`,
    translator: null,
    sizeBytes: bytes.byteLength,
    downloadUrl: `/_quran/tanzil/translations/${id}.sqlite`,
  };
}

async function seedSources(sources: readonly { id: string; bytes: Uint8Array }[]): Promise<void> {
  for (const source of sources) await seedTranslation(source.id, source.bytes);
  worker.__translationSearchTestHooks.setCatalogue(
    sources.map((source) => catalogueFor(source.id, source.bytes)),
  );
}

type WorkerModule = typeof import("$lib/workers/quran.worker");
let worker: WorkerModule;
let validBytes: Uint8Array;

beforeAll(async () => {
  builder = await init();
  // The worker scope calls postMessage(msg) with a single argument; the happy-dom
  // Window signature demands a targetOrigin, so replace the slot the worker
  // captured before any status emission runs.
  vi.stubGlobal("postMessage", () => {});
  worker = await import("$lib/workers/quran.worker");
  await worker.__initValidatorRuntime();
  validBytes = serializeQuranDb(ROWS);
});

beforeEach(async () => {
  installFakes();
  resetFakes();
  await seedSources([{ id: "en.test", bytes: validBytes }]);
});

afterEach(() => {
  // SAFETY: navigator.storage is optional at runtime; cast exposes it for conditional teardown.
  const nav = globalThis.navigator as { storage?: unknown } | undefined;
  if (nav) delete nav.storage;
  // SAFETY: globalThis.indexedDB is set by installFakes; cast exposes it for teardown.
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe("worker searchTranslation real SQLite path", () => {
  it("returns ordered hits with highlight spans from a cached translation DB", async () => {
    const response = await worker.searchTranslation("en.test", "mercy");
    expect(response.query).toBe("mercy");
    expect(response.sourceId).toBe("en.test");
    expect(response.total).toBe(2);
    expect(response.limit).toBe(20);
    expect(response.offset).toBe(0);
    expect(response.source).toBe("worker");
    expect(response.results).toHaveLength(2);

    const [first, second] = response.results;
    expect(first).toMatchObject({
      kind: "ayah",
      sourceId: "en.test",
      ayah: {
        key: "1:1",
        surah: 1,
        ayah: 1,
        globalIndex: 1,
        text: "Allah is full of Mercy.",
      },
      highlights: [{ start: 17, end: 22 }],
    });
    expect(second).toMatchObject({
      kind: "ayah",
      sourceId: "en.test",
      ayah: {
        key: "1:3",
        surah: 1,
        ayah: 3,
        globalIndex: 3,
        text: "MERCY twice mercy",
      },
      highlights: [
        { start: 0, end: 5 },
        { start: 12, end: 17 },
      ],
    });
  });

  it("reuses the corpus across searches without re-reading the DB", async () => {
    const first = await worker.searchTranslation("en.test", "mercy");
    const builds = worker.__translationSearchTestHooks.corpusBuilds();
    const second = await worker.searchTranslation("en.test", "mercy");
    expect(worker.__translationSearchTestHooks.corpusBuilds()).toBe(builds);
    expect(worker.__translationSearchTestHooks.corpusIds()).toContain("en.test");
    expect(second).toEqual(first);
  });

  it("dedupes concurrent corpus builds for the same source", async () => {
    await seedSources([
      { id: "en.test", bytes: validBytes },
      { id: "en.dedupe", bytes: validBytes },
    ]);
    const builds = worker.__translationSearchTestHooks.corpusBuilds();
    const [first, second] = await Promise.all([
      worker.searchTranslation("en.dedupe", "mercy"),
      worker.searchTranslation("en.dedupe", "mercy"),
    ]);
    expect(worker.__translationSearchTestHooks.corpusBuilds()).toBe(builds + 1);
    expect(first).toEqual(second);
    expect(first.total).toBe(2);
  });

  it("caps corpora at 3 with LRU eviction", async () => {
    const ids = ["en.lru1", "en.lru2", "en.lru3", "en.lru4"];
    await seedSources(ids.map((id) => ({ id, bytes: validBytes })));
    const builds = worker.__translationSearchTestHooks.corpusBuilds();
    for (const id of ids) await worker.searchTranslation(id, "mercy");
    expect(worker.__translationSearchTestHooks.corpusBuilds()).toBe(builds + ids.length);
    expect(worker.__translationSearchTestHooks.corpusIds().slice(-3)).toEqual([
      "en.lru2",
      "en.lru3",
      "en.lru4",
    ]);
  });

  it("propagates a corpus build failure on a gapped DB and caches nothing", async () => {
    const gapped = serializeQuranDb(GAPPED_ROWS);
    await seedSources([
      { id: "en.test", bytes: validBytes },
      { id: "en.gap", bytes: gapped },
    ]);
    await expect(worker.searchTranslation("en.gap", "mercy")).rejects.toThrow(
      /contiguous globalIndex 3/,
    );
    expect(worker.__translationSearchTestHooks.corpusIds()).not.toContain("en.gap");
    await expect(worker.searchTranslation("en.gap", "mercy")).rejects.toThrow(
      /contiguous globalIndex 3/,
    );
  });

  it("deleteArtifact drops the corpus alongside the DB", async () => {
    await worker.searchTranslation("en.test", "mercy");
    expect(worker.__translationSearchTestHooks.corpusIds()).toContain("en.test");
    expect(worker.__artifactAdminTestHooks.hasOpenDb("en.test")).toBe(true);

    await worker.deleteStorageArtifact("en.test");

    expect(worker.__translationSearchTestHooks.corpusIds()).not.toContain("en.test");
    expect(worker.__artifactAdminTestHooks.hasOpenDb("en.test")).toBe(false);
    const artifacts = await worker.listStorageArtifacts();
    expect(artifacts.map((artifact) => artifact.id)).not.toContain("en.test");
  });
});
