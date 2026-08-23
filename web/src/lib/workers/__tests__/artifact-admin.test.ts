import { describe, expect, it, beforeEach, afterEach } from "vite-plus/test";

const MB = 1024 * 1024;
const opLog: string[] = [];

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
    opLog.push(`opfs:remove:${this.name}/${name}`);
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
          // eslint-disable-next-line anti-slop/no-runtime-typeof -- IDB keys are polymorphic (IDBValidKey); the op log records string keys only, matching what production stores
          if (typeof key === "string") opLog.push(`idb:del:${db.name}/${store}:${key}`);
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
  opLog.length = 0;
}

async function seedOpfsArtifact(id: string, sizeBytes: number): Promise<void> {
  const root = fakeRoot!;
  const top = await root.getDirectoryHandle("easyquran", { create: true });
  const dir = await top.getDirectoryHandle(id, { create: true });
  const fh = await dir.getFileHandle(`${id}.sqlite`, { create: true });
  const w = await fh.createWritable();
  await w.write(new Uint8Array(sizeBytes));
  await w.close();
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

type WorkerModule = typeof import("$lib/workers/quran.worker");
let worker: WorkerModule;

beforeEach(async () => {
  installFakes();
  resetFakes();
  worker = await import("$lib/workers/quran.worker");
});

afterEach(() => {
  // SAFETY: navigator.storage is optional at runtime; cast exposes it for conditional teardown.
  const nav = globalThis.navigator as { storage?: unknown } | undefined;
  if (nav) delete nav.storage;
  // SAFETY: globalThis.indexedDB is set by installFakes; cast exposes it for teardown.
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe("worker listStorageArtifacts joins cached artifacts with lastUsed", () => {
  it("lists OPFS + IDB artifacts with stamped and unstamped lastUsed", async () => {
    await seedOpfsArtifact("en.sahih", 2 * MB);
    await seedOpfsArtifact("ur.jalandhry", 3 * MB);
    seedIdbRecord(
      "easyquran-pointers",
      "opfsPointers",
      "en.sahih",
      { sourceId: "en.sahih", activeFile: "en.sahih.sqlite" },
    );
    seedIdbRecord("easyquran-pointers", "opfsPointers", "ur.jalandhry", {
      sourceId: "ur.jalandhry",
      activeFile: "ur.jalandhry.sqlite",
    });
    seedIdbRecord("easyquran-meta", "lastUsed", "en.sahih", 1_700_000_000_000);
    seedIdbRecord("easyquran-quran", "artifacts", "fr.hamid:fr.hamid", new ArrayBuffer(5 * MB));
    seedIdbRecord("easyquran-artifact-meta", "artifacts", "fr.hamid:fr.hamid", {
      id: "fr.hamid",
      tag: "fr.hamid",
      sizeBytes: 5 * MB,
    });
    await flush();

    const artifacts = await worker.listStorageArtifacts();
    expect(artifacts).toHaveLength(3);
    const byId = new Map(artifacts.map((a) => [a.id, a]));
    expect(byId.get("en.sahih")).toMatchObject({
      store: "opfs",
      tag: "en.sahih",
      sizeBytes: 2 * MB,
      lastUsed: 1_700_000_000_000,
    });
    expect(byId.get("ur.jalandhry")).toMatchObject({ store: "opfs", lastUsed: null });
    expect(byId.get("fr.hamid")).toMatchObject({ store: "idb", sizeBytes: 5 * MB });
  });
});

describe("worker deleteStorageArtifact refusals", () => {
  it("refuses an Arabic source id with the typed arabic error and touches nothing", async () => {
    await seedOpfsArtifact("uthmani", 2 * MB);
    seedIdbRecord("easyquran-pointers", "opfsPointers", "uthmani", {
      sourceId: "uthmani",
      activeFile: "uthmani.sqlite",
    });
    await expect(worker.deleteStorageArtifact("uthmani")).rejects.toThrow(/^arabic$/);
    expect(opLog).toEqual([]);
  });

  it("refuses an in-flight download of the same id with the typed busy error", async () => {
    await seedOpfsArtifact("en.sahih", 2 * MB);
    seedIdbRecord("easyquran-pointers", "opfsPointers", "en.sahih", {
      sourceId: "en.sahih",
      activeFile: "en.sahih.sqlite",
    });
    worker.__artifactAdminTestHooks.injectInFlight("en.sahih");
    try {
      await expect(worker.deleteStorageArtifact("en.sahih")).rejects.toThrow(/^busy$/);
      expect(opLog).toEqual([]);
    } finally {
      worker.__artifactAdminTestHooks.clearInFlight("en.sahih");
    }
  });

  it("rejects a same-id runner landing inside the delete window instead of letting it resurrect", async () => {
    await seedOpfsArtifact("en.sahih", 2 * MB);
    seedIdbRecord("easyquran-pointers", "opfsPointers", "en.sahih", {
      sourceId: "en.sahih",
      activeFile: "en.sahih.sqlite",
    });
    seedIdbRecord("easyquran-meta", "lastUsed", "en.sahih", 1_700_000_000_000);
    const hooks = worker.__artifactAdminTestHooks;

    const deleting = worker.deleteStorageArtifact("en.sahih");
    const gate = hooks.pendingRunner("en.sahih");
    expect(gate).not.toBeNull();
    const secondDelete = worker.deleteStorageArtifact("en.sahih");
    const gateRejection = expect(gate).rejects.toThrow(/^busy$/);
    const secondRejection = expect(secondDelete).rejects.toThrow(/^busy$/);
    await gateRejection;
    await secondRejection;

    await deleting;
    expect(hooks.pendingRunner("en.sahih")).toBeNull();
    expect(opLog).toContain("idb:del:easyquran-meta/lastUsed:en.sahih");
  });
});

describe("worker deleteStorageArtifact ordering mirrors runPrune", () => {
  it("closes the open handle before removing the file, pointer, and lastUsed stamp", async () => {
    await seedOpfsArtifact("en.sahih", 2 * MB);
    seedIdbRecord("easyquran-pointers", "opfsPointers", "en.sahih", {
      sourceId: "en.sahih",
      activeFile: "en.sahih.sqlite",
    });
    seedIdbRecord("easyquran-meta", "lastUsed", "en.sahih", 1_700_000_000_000);
    const hooks = worker.__artifactAdminTestHooks;
    hooks.markCached("en.sahih");
    let closed = false;
    hooks.injectOpenDb("en.sahih", () => {
      closed = true;
      opLog.push("db:close");
    });
    expect(hooks.hasOpenDb("en.sahih")).toBe(true);
    expect(hooks.cachedIds()).toContain("en.sahih");

    await worker.deleteStorageArtifact("en.sahih");
    await flush();

    expect(closed).toBe(true);
    expect(hooks.hasOpenDb("en.sahih")).toBe(false);
    expect(hooks.cachedIds()).not.toContain("en.sahih");
    const closeAt = opLog.indexOf("db:close");
    const fileAt = opLog.indexOf("opfs:remove:en.sahih/en.sahih.sqlite");
    const pointerAt = opLog.indexOf("idb:del:easyquran-pointers/opfsPointers:en.sahih");
    const stampAt = opLog.indexOf("idb:del:easyquran-meta/lastUsed:en.sahih");
    expect(closeAt).toBeGreaterThanOrEqual(0);
    expect(fileAt).toBeGreaterThan(closeAt);
    expect(pointerAt).toBeGreaterThan(closeAt);
    expect(stampAt).toBeGreaterThan(fileAt);
  });

  it("no-ops an id that is not cached anywhere", async () => {
    await expect(worker.deleteStorageArtifact("en.missing")).resolves.toBe(null);
    expect(opLog).toEqual([]);
  });
});
