import type { DownloadableSpec } from "$lib/data/quran-types";
import { unsafeDownloadSpec, verifyBytes, type DownloadSpec } from "$lib/workers/download";
import { openIdb } from "$lib/workers/idb";
import {
  ACTIVE_SUFFIX,
  ARTIFACT_META_DB,
  ARTIFACT_META_STORE,
  activeFileName,
  clearPointer,
  decideLegacyAdoption,
  decidePromotion,
  deleteCachedArtifact,
  ensureArtifact,
  filterSourceFiles,
  forgetSessionArtifact,
  idFromActiveFileName,
  inspectCachedArtifacts,
  isActiveFileName,
  isTempFileName,
  listCachedArtifacts,
  POINTER_DB,
  POINTER_STORE,
  QURAN_DB,
  QURAN_ROW_COUNT,
  QURAN_STORE,
  readPointer,
  sweepAbandonedTemps,
  tempFileName,
  writePointer,
  type ActivePointer,
} from "$lib/workers/opfs-cache";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const SPEC_ID = "en.sahih";
function makeSpec(sizeBytes: number, id: string = SPEC_ID): DownloadableSpec {
  return { id, sizeBytes, downloadUrl: `https://example.test/${id}.sqlite` };
}
const PAYLOAD = (n: number) => new Uint8Array(n).fill(7);

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
      arrayBuffer: async () => {
        this.parent.arrayBufferReads += 1;
        return this.bytes.buffer.slice(0);
      },
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
  async move(name: string) {
    const b = this.parent.files.get(this.name);
    if (!b) throw new DOMException(this.name, "NotFoundError");
    this.parent.files.delete(this.name);
    this.parent.files.set(name, b);
    this.name = name;
  }
}

class FakeDirHandle {
  dirs = new Map<string, FakeDirHandle>();
  files = new Map<string, Uint8Array>();
  arrayBufferReads = 0;
  keyScans = 0;
  constructor(public name = "") {}
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeDirHandle> {
    if (this.files.has(name)) throw new DOMException(name, "TypeMismatchError");
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!opts.create) throw new DOMException(name, "NotFoundError");
    const d = new FakeDirHandle(name);
    this.dirs.set(name, d);
    return d;
  }
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeFileHandle> {
    if (this.dirs.has(name)) throw new DOMException(name, "TypeMismatchError");
    if (this.files.has(name)) return new FakeFileHandle(this, name);
    if (!opts.create) throw new DOMException(name, "NotFoundError");
    this.files.set(name, new Uint8Array(0));
    return new FakeFileHandle(this, name);
  }
  async *keys(): AsyncIterable<string> {
    this.keyScans += 1;
    for (const n of [...this.dirs.keys(), ...this.files.keys()]) yield n;
  }
  async removeEntry(name: string): Promise<void> {
    if (this.dirs.has(name)) {
      this.dirs.delete(name);
      return;
    }
    if (this.files.has(name)) {
      this.files.delete(name);
      return;
    }
    throw new DOMException(name, "NotFoundError");
  }
}

interface FakeStore {
  data: Map<unknown, unknown>;
  valueCursorReads: number;
}
interface FakeDB {
  name: string;
  stores: Map<string, FakeStore>;
  objectStoreNames: { contains(n: string): boolean };
  transaction(store: string, mode: IDBTransactionMode): FakeTx;
  createObjectStore(name: string): FakeStore;
}
interface FakeReq {
  result: unknown;
  error: DOMException | null;
  onsuccess: ((req: FakeReq) => void) | null;
  onerror: ((req: FakeReq) => void) | null;
  onupgradeneeded: ((req: FakeReq) => void) | null;
}
interface FakeCursor {
  key: unknown;
  value: unknown;
  continue(): void;
}
interface FakeStoreHandle {
  data: Map<unknown, unknown>;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.get; key is an opaque IDB valid key and the real callers live in production opfs-cache.ts
  get(key: unknown): FakeReq;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.put; value/key are opaque structured-clone data and the real callers live in production opfs-cache.ts
  put(value: unknown, key?: unknown): FakeReq;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- fakes IDBObjectStore.delete; key is an opaque IDB valid key
  delete(key: unknown): FakeReq;
  openCursor(): FakeReq;
  openKeyCursor(): FakeReq;
}
interface FakeTx {
  aborted: boolean;
  error: DOMException | null;
  oncomplete: ((tx: FakeTx) => void) | null;
  onerror: ((tx: FakeTx) => void) | null;
  onabort: ((tx: FakeTx) => void) | null;
  objectStore(name: string): FakeStoreHandle;
  abort(): void;
}

interface FakeIdbFactory {
  open(name: string, version: number): FakeReq;
}

interface FakeEnv {
  root: FakeDirHandle;
  idb: FakeIdbFactory;
  reset: () => void;
}

interface FakeSingleton {
  env: FakeEnv | null;
}

const fakeSingleton: FakeSingleton = { env: null };

function buildFakes(): FakeEnv {
  const root = new FakeDirHandle("root");
  const dbByName = new Map<string, FakeDB>();

  function makeStore(db: FakeDB, name: string): FakeStore {
    let store = db.stores.get(name);
    if (!store) {
      store = { data: new Map(), valueCursorReads: 0 };
      db.stores.set(name, store);
    }
    return store;
  }

  function makeStoreHandle(
    store: FakeStore,
    tx: FakeTx,
    track: (req: FakeReq) => void,
    release: (req: FakeReq) => void,
  ): FakeStoreHandle {
    function opReq<T>(result: T, mutate: () => void): FakeReq {
      mutate();
      const req: FakeReq = {
        result,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      track(req);
      queueMicrotask(() => {
        try {
          req.onsuccess?.(req);
        } finally {
          release(req);
        }
      });
      return req;
    }
    return {
      data: store.data,
      get: (key) => opReq(store.data.get(key), () => {}),
      put: (value, key) =>
        opReq(key ?? null, () => {
          if (key !== undefined) store.data.set(key, value);
        }),
      delete: (key) =>
        opReq(undefined, () => {
          store.data.delete(key);
        }),
      openCursor: () => {
        const req: FakeReq = {
          result: null,
          error: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        const keys = [...store.data.keys()];
        let i = 0;
        track(req);
        const fire = () => {
          if (tx.aborted) return;
          if (i >= keys.length) {
            req.result = null;
            try {
              req.onsuccess?.(req);
            } finally {
              release(req);
            }
            return;
          }
          const key = keys[i]!;
          const cursor: FakeCursor = {
            key,
            value: store.data.get(key),
            continue: () => {
              i += 1;
              queueMicrotask(fire);
            },
          };
          store.valueCursorReads += 1;
          req.result = cursor;
          req.onsuccess?.(req);
        };
        queueMicrotask(fire);
        return req;
      },
      openKeyCursor: () => {
        const req: FakeReq = {
          result: null,
          error: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        const keys = [...store.data.keys()];
        let i = 0;
        track(req);
        const fire = () => {
          if (tx.aborted) return;
          if (i >= keys.length) {
            req.result = null;
            try {
              req.onsuccess?.(req);
            } finally {
              release(req);
            }
            return;
          }
          const cursor: FakeCursor = {
            key: keys[i]!,
            value: undefined,
            continue: () => {
              i += 1;
              queueMicrotask(fire);
            },
          };
          req.result = cursor;
          req.onsuccess?.(req);
        };
        queueMicrotask(fire);
        return req;
      },
    };
  }

  function makeTx(db: FakeDB, name: string): FakeTx {
    const store = makeStore(db, name);
    let pending = 0;
    let completed = false;
    function maybeComplete() {
      if (pending === 0 && !completed && !tx.aborted) {
        completed = true;
        queueMicrotask(() => {
          if (!tx.aborted) tx.oncomplete?.(tx);
        });
      }
    }
    function track(_req: FakeReq) {
      pending += 1;
    }
    function release(_req: FakeReq) {
      pending -= 1;
      maybeComplete();
    }
    const tx: FakeTx = {
      aborted: false,
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => makeStoreHandle(store, tx, track, release),
      abort: () => {
        tx.aborted = true;
        tx.error = new DOMException("aborted", "AbortError");
        queueMicrotask(() => tx.onabort?.(tx));
      },
    };
    queueMicrotask(maybeComplete);
    return tx;
  }

  function makeDB(name: string): FakeDB {
    const db: FakeDB = {
      name,
      stores: new Map(),
      objectStoreNames: { contains: (n) => db.stores.has(n) },
      createObjectStore: (n) => makeStore(db, n),
      transaction: (n) => makeTx(db, n),
    };
    return db;
  }

  const idb: FakeIdbFactory = {
    open(name: string, _version: number): FakeReq {
      let db = dbByName.get(name);
      const isNew = !db;
      if (!db) {
        db = makeDB(name);
        dbByName.set(name, db);
      }
      const req: FakeReq = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (isNew) req.onupgradeneeded?.(req);
        req.onsuccess?.(req);
      });
      return req;
    },
  };

  const env: FakeEnv = {
    root,
    idb,
    reset: () => {
      root.dirs.clear();
      root.files.clear();
      root.arrayBufferReads = 0;
      root.keyScans = 0;
      for (const db of dbByName.values()) {
        for (const store of db.stores.values()) {
          store.data.clear();
          store.valueCursorReads = 0;
        }
      }
    },
  };
  return env;
}

function installFakes(): FakeEnv {
  if (!fakeSingleton.env) fakeSingleton.env = buildFakes();
  const env = fakeSingleton.env;
  // SAFETY: globalThis.indexedDB is a real runtime global in the test env; cast exposes the slot to install the fake IDB factory.
  (globalThis as { indexedDB: unknown }).indexedDB = env.idb;
  Object.defineProperty(globalThis.navigator, "storage", {
    value: { getDirectory: async () => env.root },
    configurable: true,
    writable: true,
  });
  // SAFETY: globalThis.fetch is a real runtime global; cast exposes the slot to install the default test stub.
  (globalThis as { fetch: unknown }).fetch = async () => ({
    ok: true,
    status: 200,
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  env.reset();
  return env;
}

function setFetchPayload(bytes: Uint8Array): void {
  // SAFETY: globalThis.fetch is a real runtime global; cast exposes the slot to install the payload stub.
  (globalThis as { fetch: unknown }).fetch = async () => ({
    ok: true,
    status: 200,
    body: null,
    arrayBuffer: async () => bytes.buffer.slice(0),
  });
}

function setFetchError(message: string): void {
  // SAFETY: globalThis.fetch is a real runtime global; cast exposes the slot to install the throwing stub.
  (globalThis as { fetch: unknown }).fetch = async () => {
    throw new Error(message);
  };
}

async function seedFile(tag: string, name: string, bytes: Uint8Array, root: FakeDirHandle) {
  const top = await root.getDirectoryHandle("easyquran", { create: true });
  const dir = await top.getDirectoryHandle(tag, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
}

async function readSeed(
  tag: string,
  name: string,
  root: FakeDirHandle,
): Promise<Uint8Array | null> {
  try {
    const top = await root.getDirectoryHandle("easyquran", { create: false });
    const dir = await top.getDirectoryHandle(tag, { create: false });
    const fh = await dir.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function readPointerViaExport(sourceId: string): Promise<ActivePointer | null> {
  return readPointer(sourceId);
}

// Test-only reinterpreter: openIdb() runs against the faked globalThis.indexedDB,
// so the typed IDBDatabase it returns is actually a FakeDB at runtime. One
// SAFETY-justified assertion (no chain, no intermediate widening).
function reinterpretAs<T>(value: Awaited<ReturnType<typeof openIdb>>): T {
  // SAFETY: the faked indexedDB.open returns a FakeDB; openIdb's IDBDatabase
  // return type hides that fake shape. T is always FakeDB at the call site.
  return value as T;
}

async function breakNextPointerPut(): Promise<() => void> {
  // Wrap the pointer store so the next readwrite `put` (the commit-phase
  // writePointer) throws synchronously inside runTxVoid's executor, rejecting
  // the commit. `get` (readPointer) stays intact, and other DBs are untouched.
  const pointerDb = reinterpretAs<FakeDB>(await openIdb(POINTER_DB, POINTER_STORE));
  const origTransaction = pointerDb.transaction.bind(pointerDb);
  pointerDb.transaction = (store: string, mode: IDBTransactionMode): FakeTx => {
    const tx = origTransaction(store, mode);
    if (store !== POINTER_STORE) return tx;
    const origObjectStore = tx.objectStore.bind(tx);
    tx.objectStore = (): FakeStoreHandle => {
      const handle = origObjectStore(store);
      // SAFETY: the override only needs to throw on the next put call; the
      // arrow's never-returning body is assignable to FakeStoreHandle["put"].
      handle.put = ((..._args: unknown[]) => {
        throw new Error("commit writePointer boom");
      }) as FakeStoreHandle["put"];
      return handle;
    };
    return tx;
  };
  return () => {
    pointerDb.transaction = origTransaction;
  };
}

async function breakMetadataPuts(): Promise<() => void> {
  const metaDb = reinterpretAs<FakeDB>(await openIdb(ARTIFACT_META_DB, ARTIFACT_META_STORE));
  const origTransaction = metaDb.transaction.bind(metaDb);
  metaDb.transaction = (store: string, mode: IDBTransactionMode): FakeTx => {
    const tx = origTransaction(store, mode);
    const origObjectStore = tx.objectStore.bind(tx);
    tx.objectStore = (): FakeStoreHandle => {
      const handle = origObjectStore(store);
      // SAFETY: test override intentionally replaces FakeStoreHandle.put with a never-returning failure stub.
      handle.put = ((..._args: unknown[]) => {
        throw new Error("metadata interrupted");
      }) as FakeStoreHandle["put"];
      return handle;
    };
    return tx;
  };
  return () => {
    metaDb.transaction = origTransaction;
  };
}

describe("DownloadSpec sizeBytes boundary", () => {
  it("requires sizeBytes on a production DownloadSpec", () => {
    const spec: DownloadSpec = { url: "https://example.test/x", sizeBytes: 16 };
    expect(spec.sizeBytes).toBe(16);
  });

  it("verifyBytes rejects a mismatched buffer for a production spec", async () => {
    const spec: DownloadSpec = { url: "https://example.test/x", sizeBytes: 16 };
    await expect(verifyBytes(new Uint8Array(15), spec)).rejects.toThrow(/size/);
  });

  it("verifyBytes skips the size check for an unsafe fixture without sizeBytes", async () => {
    const unsafe = unsafeDownloadSpec({ url: "https://example.test/x" });
    const buf = new Uint8Array(99);
    await expect(verifyBytes(buf, unsafe)).resolves.toBe(buf);
  });
});

describe("opfs-cache filename helpers", () => {
  it("derives active and temp names from an id", () => {
    expect(activeFileName("en.sahih")).toBe(`en.sahih${ACTIVE_SUFFIX}`);
    expect(tempFileName("en.sahih")).toBe("en.sahih.sqlite.tmp");
  });

  it("classifies temp vs active file names", () => {
    expect(isTempFileName("en.sahih.sqlite.tmp")).toBe(true);
    expect(isTempFileName("en.sahih.sqlite")).toBe(false);
    expect(isActiveFileName("en.sahih.sqlite")).toBe(true);
    expect(isActiveFileName("en.sahih.sqlite.tmp")).toBe(false);
    expect(isActiveFileName("notes.txt")).toBe(false);
  });

  it("extracts the id from an active file name", () => {
    expect(idFromActiveFileName("en.sahih.sqlite")).toBe("en.sahih");
    expect(idFromActiveFileName("en.sahih.sqlite.tmp")).toBeNull();
    expect(idFromActiveFileName("notes.txt")).toBeNull();
  });
});

describe("decideLegacyAdoption", () => {
  it("never re-adopts when a pointer already exists", () => {
    const pointer: ActivePointer = { sourceId: SPEC_ID, activeFile: activeFileName(SPEC_ID) };
    const d = decideLegacyAdoption({ pointer, candidateFile: activeFileName(SPEC_ID) });
    expect(d.adopt).toBe(false);
    expect(d.activeFile).toBe(pointer.activeFile);
  });

  it("adopts the legacy candidate exactly once on first pointer-aware boot", () => {
    const d = decideLegacyAdoption({
      pointer: null,
      candidateFile: activeFileName(SPEC_ID),
    });
    expect(d.adopt).toBe(true);
    expect(d.activeFile).toBe(activeFileName(SPEC_ID));
  });

  it("does not adopt when no legacy file is present", () => {
    const d = decideLegacyAdoption({ pointer: null, candidateFile: null });
    expect(d.adopt).toBe(false);
    expect(d.activeFile).toBeNull();
  });
});

describe("decidePromotion", () => {
  it("refuses to commit when validation failed", () => {
    const d = decidePromotion({
      oldPointer: null,
      newActiveFile: activeFileName(SPEC_ID),
      validationOk: false,
    });
    expect(d.commitPointer).toBe(false);
    expect(d.removeOldFile).toBe(false);
    expect(d.oldFile).toBeNull();
  });

  it("commits and removes nothing when there is no prior pointer", () => {
    const d = decidePromotion({
      oldPointer: null,
      newActiveFile: activeFileName(SPEC_ID),
      validationOk: true,
    });
    expect(d.commitPointer).toBe(true);
    expect(d.removeOldFile).toBe(false);
    expect(d.oldFile).toBeNull();
  });

  it("keeps the old file when the active name is unchanged", () => {
    const oldPointer: ActivePointer = { sourceId: SPEC_ID, activeFile: activeFileName(SPEC_ID) };
    const d = decidePromotion({
      oldPointer,
      newActiveFile: activeFileName(SPEC_ID),
      validationOk: true,
    });
    expect(d.commitPointer).toBe(true);
    expect(d.removeOldFile).toBe(false);
  });

  it("removes the prior active file when the name differs", () => {
    const oldPointer: ActivePointer = { sourceId: SPEC_ID, activeFile: "en.sahih.v1.sqlite" };
    const d = decidePromotion({
      oldPointer,
      newActiveFile: activeFileName(SPEC_ID),
      validationOk: true,
    });
    expect(d.commitPointer).toBe(true);
    expect(d.removeOldFile).toBe(true);
    expect(d.oldFile).toBe("en.sahih.v1.sqlite");
  });
});

describe("filterSourceFiles", () => {
  const pointers = (entries: [string, string][]): Map<string, ActivePointer> =>
    new Map(entries.map(([id, file]) => [id, { sourceId: id, activeFile: file }]));

  it("lists only pointer-active files as sources and flags abandoned temps", () => {
    const files = [
      { tag: "a", name: "a.sqlite" },
      { tag: "a", name: "a.sqlite.tmp" },
      { tag: "b", name: "b.sqlite" },
      { tag: "c", name: "c.sqlite" },
      { tag: "d", name: "notes.txt" },
    ];
    const r = filterSourceFiles({
      pointers: pointers([
        ["a", "a.sqlite"],
        ["c", "c.other.sqlite"],
      ]),
      files,
    });
    const sourceIds = r.sources.map((s) => s.id);
    expect(sourceIds).toEqual(["a"]);
    expect(r.abandonedTemps.map((t) => t.name)).toEqual(["a.sqlite.tmp"]);
  });

  it("ignores files whose tag does not match the id encoded in the name", () => {
    const r = filterSourceFiles({
      pointers: pointers([["x", "y.sqlite"]]),
      files: [{ tag: "x", name: "y.sqlite" }],
    });
    expect(r.sources).toHaveLength(0);
  });

  it("treats an unadopted legacy active file as not a source", () => {
    const r = filterSourceFiles({
      pointers: new Map(),
      files: [{ tag: "legacy", name: "legacy.sqlite" }],
    });
    expect(r.sources).toHaveLength(0);
    expect(r.abandonedTemps).toHaveLength(0);
  });
});

describe("ensureArtifact crash-safe OPFS flow", () => {
  let env: ReturnType<typeof installFakes>;
  // SAFETY: globalThis.fetch is a real runtime global; cast snapshots it for afterEach restore.
  const realFetch = (globalThis as { fetch?: unknown }).fetch;

  beforeEach(() => {
    env = installFakes();
  });
  afterEach(() => {
    // SAFETY: globalThis.fetch is a real runtime global; cast restores the snapshot.
    (globalThis as { fetch?: unknown }).fetch = realFetch;
    // SAFETY: navigator.storage is optional at runtime; cast exposes it for conditional teardown.
    const nav = globalThis.navigator as { storage?: unknown } | undefined;
    if (nav) delete nav.storage;
    // SAFETY: globalThis.indexedDB is set by installFakes; cast exposes it for teardown.
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it("promotes a fully validated staged DB to active and writes the pointer", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    const art = await ensureArtifact(spec);
    expect(art.downloaded).toBe(true);
    expect(art.store).toBe("opfs");
    expect(art.bytes.byteLength).toBe(16);

    const top = await env.root.getDirectoryHandle("easyquran", { create: false });
    const sourceDir = await top.getDirectoryHandle(spec.id, { create: false });
    // Persisted temp validation reads bytes once. Promotion verifies File.size;
    // it must not materialize the complete active SQLite file again.
    expect(sourceDir.arrayBufferReads).toBe(1);

    const active = await readSeed(spec.id, activeFileName(spec.id), env.root);
    expect(active).not.toBeNull();
    expect(active!.byteLength).toBe(16);

    const temp = await readSeed(spec.id, tempFileName(spec.id), env.root);
    expect(temp).toBeNull();

    const pointer = await readPointerViaExport(spec.id);
    expect(pointer).toEqual({ sourceId: spec.id, activeFile: activeFileName(spec.id) });
  });

  it("serves the old corpus and skips redownload when the pointer is valid", async () => {
    const spec = makeSpec(16);
    await seedFile(spec.id, activeFileName(spec.id), PAYLOAD(16), env.root);
    await writePointer({ sourceId: spec.id, activeFile: activeFileName(spec.id) });

    let fetched = 0;
    // SAFETY: globalThis.fetch is a real runtime global; cast exposes the slot to install the counting stub.
    (globalThis as { fetch: unknown }).fetch = async () => {
      fetched += 1;
      return { ok: true, status: 200, body: null, arrayBuffer: async () => new ArrayBuffer(0) };
    };

    const art = await ensureArtifact(spec);
    expect(art.downloaded).toBe(false);
    expect(fetched).toBe(0);
    const pointer = await readPointerViaExport(spec.id);
    expect(pointer?.activeFile).toBe(activeFileName(spec.id));
  });

  it("cleans the staged temp and writes no pointer when validation fails", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    const failValidate = () => {
      throw new Error("content reject");
    };
    await expect(ensureArtifact(spec, undefined, { validate: failValidate })).rejects.toThrow(
      /content reject/,
    );
    expect(await readSeed(spec.id, tempFileName(spec.id), env.root)).toBeNull();
    expect(await readSeed(spec.id, activeFileName(spec.id), env.root)).toBeNull();
    expect(await readPointerViaExport(spec.id)).toBeNull();
  });

  it("cleans the staged temp and leaves the existing pointer stable when a redownload's validation rejects", async () => {
    // Not a corpus-preservation claim: a same-spec valid corpus is served from
    // cache and never redownloaded, so this asserts only temp-cleanup,
    // active-file immutability, and pointer stability (cross-spec preservation
    // is covered in the W10c block below).
    const spec = makeSpec(16);
    const activeBefore = new Uint8Array(4).fill(1);
    await seedFile(spec.id, activeFileName(spec.id), activeBefore, env.root);
    await writePointer({ sourceId: spec.id, activeFile: activeFileName(spec.id) });

    setFetchPayload(PAYLOAD(16));
    const failValidate = () => {
      throw new Error("content reject");
    };
    await expect(ensureArtifact(spec, undefined, { validate: failValidate })).rejects.toThrow(
      /content reject/,
    );

    expect(await readSeed(spec.id, tempFileName(spec.id), env.root)).toBeNull();
    const activeAfter = await readSeed(spec.id, activeFileName(spec.id), env.root);
    expect(activeAfter).not.toBeNull();
    expect(Array.from(activeAfter!)).toEqual(Array.from(activeBefore));
    const pointer = await readPointerViaExport(spec.id);
    expect(pointer?.activeFile).toBe(activeFileName(spec.id));
  });

  it("removes nothing when the download itself is interrupted", async () => {
    const spec = makeSpec(16);
    setFetchError("network down");
    await expect(ensureArtifact(spec)).rejects.toThrow(/network down/);
    expect(await readSeed(spec.id, tempFileName(spec.id), env.root)).toBeNull();
    expect(await readSeed(spec.id, activeFileName(spec.id), env.root)).toBeNull();
    expect(await readPointerViaExport(spec.id)).toBeNull();
  });

  it("adopts a valid legacy file once on first pointer-aware boot", async () => {
    const spec = makeSpec(16);
    const legacy = PAYLOAD(16);
    await seedFile(spec.id, activeFileName(spec.id), legacy, env.root);

    let validates = 0;
    const validate = () => {
      validates += 1;
    };
    const first = await ensureArtifact(spec, undefined, { validate });
    expect(first.downloaded).toBe(false);
    expect(validates).toBe(1);
    expect(await readPointerViaExport(spec.id)).toEqual({
      sourceId: spec.id,
      activeFile: activeFileName(spec.id),
    });

    const second = await ensureArtifact(spec, undefined, { validate });
    expect(second.downloaded).toBe(false);
    expect(validates).toBe(1);
  });

  it("redownloads and replaces an invalid legacy file without adopting it", async () => {
    const spec = makeSpec(16);
    await seedFile(spec.id, activeFileName(spec.id), new Uint8Array(4).fill(9), env.root);
    setFetchPayload(PAYLOAD(16));

    const art = await ensureArtifact(spec);
    expect(art.downloaded).toBe(true);
    expect(art.bytes.byteLength).toBe(16);
    const active = await readSeed(spec.id, activeFileName(spec.id), env.root);
    expect(active!.byteLength).toBe(16);
    expect(await readPointerViaExport(spec.id)).toEqual({
      sourceId: spec.id,
      activeFile: activeFileName(spec.id),
    });
  });

  it("sweeps abandoned temp files and never lists them as sources", async () => {
    const spec = makeSpec(16);
    const other = makeSpec(8, "fr.hamidullah");
    await seedFile(spec.id, tempFileName(spec.id), PAYLOAD(16), env.root);
    await seedFile(other.id, activeFileName(other.id), PAYLOAD(8), env.root);
    await writePointer({
      sourceId: other.id,
      activeFile: activeFileName(other.id),
    });

    await sweepAbandonedTemps();
    expect(await readSeed(spec.id, tempFileName(spec.id), env.root)).toBeNull();

    const listed = await listCachedArtifacts();
    const ids = listed.map((l) => l.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(spec.id);
  });

  it("reuses one OPFS tree snapshot for boot inventory and temp cleanup", async () => {
    const spec = makeSpec(16);
    await seedFile(spec.id, activeFileName(spec.id), PAYLOAD(16), env.root);
    await seedFile(spec.id, tempFileName(spec.id), PAYLOAD(4), env.root);
    await writePointer({ sourceId: spec.id, activeFile: activeFileName(spec.id) });

    const top = await env.root.getDirectoryHandle("easyquran", { create: false });
    const sourceDir = await top.getDirectoryHandle(spec.id, { create: false });
    const inspection = await inspectCachedArtifacts();
    await sweepAbandonedTemps(inspection.abandonedTemps);

    expect(top.keyScans).toBe(1);
    expect(sourceDir.keyScans).toBe(1);
    expect(inspection.artifacts.map((artifact) => artifact.id)).toEqual([spec.id]);
    expect(await readSeed(spec.id, tempFileName(spec.id), env.root)).toBeNull();
  });

  it("deleteCachedArtifact clears the pointer and active file; the boot sweep owns temp cleanup", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    await ensureArtifact(spec);
    await seedFile(spec.id, tempFileName(spec.id), PAYLOAD(4), env.root);

    await deleteCachedArtifact(spec.id, spec.id);
    expect(await readSeed(spec.id, activeFileName(spec.id), env.root)).toBeNull();
    expect(await readPointerViaExport(spec.id)).toBeNull();
    // Eviction must not touch a staging temp (would race an in-flight stage of
    // the same id during runPrune); the boot sweep reclaims it instead.
    expect(await readSeed(spec.id, tempFileName(spec.id), env.root)).not.toBeNull();
    await sweepAbandonedTemps();
    expect(await readSeed(spec.id, tempFileName(spec.id), env.root)).toBeNull();
  });
});

describe("ensureArtifact session fallback", () => {
  // SAFETY: globalThis.fetch is a real runtime global; cast snapshots it for afterEach restore.
  const realFetch = (globalThis as { fetch?: unknown }).fetch;

  function stripOpfs(): void {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {},
      configurable: true,
      writable: true,
    });
  }

  // Wrap the quran artifact store so every `put` (the persist attempt in
  // ensureIdbArtifact) throws synchronously inside runTxVoid's executor,
  // rejecting the persist. `get` stays intact, and other DBs are untouched.
  async function breakQuranPuts(): Promise<() => void> {
    const quranDb = reinterpretAs<FakeDB>(await openIdb(QURAN_DB, QURAN_STORE));
    const origTransaction = quranDb.transaction.bind(quranDb);
    quranDb.transaction = (store: string, mode: IDBTransactionMode): FakeTx => {
      const tx = origTransaction(store, mode);
      if (store !== QURAN_STORE) return tx;
      const origObjectStore = tx.objectStore.bind(tx);
      tx.objectStore = (): FakeStoreHandle => {
        const handle = origObjectStore(store);
        // SAFETY: the override only needs to throw on every put call; the
        // arrow's never-returning body is assignable to FakeStoreHandle["put"].
        handle.put = ((..._args: unknown[]) => {
          throw new Error("quran put refused");
        }) as FakeStoreHandle["put"];
        return handle;
      };
      return tx;
    };
    return () => {
      quranDb.transaction = origTransaction;
    };
  }

  beforeEach(() => {
    installFakes();
  });
  afterEach(() => {
    // SAFETY: globalThis.fetch is a real runtime global; cast restores the snapshot.
    (globalThis as { fetch?: unknown }).fetch = realFetch;
    // SAFETY: navigator.storage is optional at runtime; cast exposes it for conditional teardown.
    const nav = globalThis.navigator as { storage?: unknown } | undefined;
    if (nav) delete nav.storage;
    // SAFETY: globalThis.indexedDB is set by installFakes; cast exposes the slot for teardown.
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it("holds refused-persist bytes in the session store and lists them as removable", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    stripOpfs();
    const restorePuts = await breakQuranPuts();

    const art = await ensureArtifact(spec);
    restorePuts();
    expect(art.store).toBe("session");
    expect(art.downloaded).toBe(true);

    expect(await listCachedArtifacts()).toEqual([
      { id: spec.id, store: "session", tag: spec.id, sizeBytes: 16 },
    ]);

    await deleteCachedArtifact(spec.id, spec.id);
    expect(await listCachedArtifacts()).toEqual([]);
  });

  it("supersedes the session entry once the same id persists to IDB", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    stripOpfs();
    const restorePuts = await breakQuranPuts();
    await ensureArtifact(spec);
    restorePuts();

    const second = await ensureArtifact(spec);
    expect(second.store).toBe("idb");

    expect(await listCachedArtifacts()).toEqual([
      { id: spec.id, store: "idb", tag: spec.id, sizeBytes: 16 },
    ]);
    await deleteCachedArtifact(spec.id, spec.id);
    expect(await listCachedArtifacts()).toEqual([]);
  });

  it("drops the session entry when the worker forgets the id", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    stripOpfs();
    const restorePuts = await breakQuranPuts();
    await ensureArtifact(spec);
    restorePuts();
    expect(await listCachedArtifacts()).toHaveLength(1);

    forgetSessionArtifact(spec.id);
    expect(await listCachedArtifacts()).toEqual([]);
  });
});

describe("IDB inventory metadata", () => {
  let env: ReturnType<typeof installFakes>;
  // SAFETY: test snapshots optional global fetch before stubbing it and restores same value in afterEach.
  const realFetch = (globalThis as { fetch?: unknown }).fetch;

  beforeEach(() => {
    env = installFakes();
    // SAFETY: test removes optional mocked storage property to force IDB fallback.
    delete (globalThis.navigator as { storage?: unknown }).storage;
  });
  afterEach(() => {
    // SAFETY: restores optional fetch snapshot captured above.
    (globalThis as { fetch?: unknown }).fetch = realFetch;
    // SAFETY: test removes optional mocked indexedDB property during teardown.
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it("inventories keys and metadata without value-cursor cloning Quran bytes", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    const artifact = await ensureArtifact(spec);
    expect(artifact.store).toBe("idb");

    const inspection = await inspectCachedArtifacts();
    expect(inspection.artifacts).toEqual([
      { id: spec.id, store: "idb", tag: spec.id, sizeBytes: spec.sizeBytes },
    ]);

    const quranDb = reinterpretAs<FakeDB>(await openIdb(QURAN_DB, QURAN_STORE));
    expect(quranDb.stores.get(QURAN_STORE)?.valueCursorReads).toBe(0);
    expect(env.root.keyScans).toBe(0);
  });

  it("keeps legacy bytes discoverable with unknown size when metadata is absent", async () => {
    const spec = makeSpec(16);
    const quranDb = reinterpretAs<FakeDB>(await openIdb(QURAN_DB, QURAN_STORE));
    quranDb.stores.get(QURAN_STORE)!.data.set(`${spec.id}:${spec.id}`, PAYLOAD(16).buffer);

    const inspection = await inspectCachedArtifacts();
    expect(inspection.artifacts).toEqual([
      { id: spec.id, store: "idb", tag: spec.id, sizeBytes: 0 },
    ]);
    expect(quranDb.stores.get(QURAN_STORE)?.valueCursorReads).toBe(0);
  });

  it("keeps persisted bytes authoritative when metadata write is interrupted", async () => {
    const spec = makeSpec(16);
    setFetchPayload(PAYLOAD(16));
    const restore = await breakMetadataPuts();
    try {
      await expect(ensureArtifact(spec)).resolves.toMatchObject({ store: "idb" });
    } finally {
      restore();
    }

    const inspection = await inspectCachedArtifacts();
    expect(inspection.artifacts).toEqual([
      { id: spec.id, store: "idb", tag: spec.id, sizeBytes: 0 },
    ]);
  });
});

describe("W10c a valid corpus stays byte-identical and re-readable through each failure point", () => {
  // The crash-safe contract: a validated corpus on disk must never be mutated
  // or destroyed by any failure path. These cases seed a VALID corpus (never
  // pre-corrupting it in setup) and assert the bytes come back unchanged after
  // each failure, and that a follow-up read still serves it.
  let env: ReturnType<typeof installFakes>;
  // SAFETY: globalThis.fetch is a real runtime global; cast snapshots it for afterEach restore.
  const realFetch = (globalThis as { fetch?: unknown }).fetch;

  beforeEach(() => {
    env = installFakes();
  });
  afterEach(() => {
    // SAFETY: globalThis.fetch is a real runtime global; cast restores the snapshot.
    (globalThis as { fetch?: unknown }).fetch = realFetch;
    // SAFETY: navigator.storage is optional at runtime; cast exposes it for conditional teardown.
    const nav = globalThis.navigator as { storage?: unknown } | undefined;
    if (nav) delete nav.storage;
    // SAFETY: globalThis.indexedDB is set by installFakes; cast exposes it for teardown.
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it("serves the exact seeded bytes on every repeat read (no mutation, no redownload)", async () => {
    const spec = makeSpec(16);
    const original = PAYLOAD(16);
    await seedFile(spec.id, activeFileName(spec.id), original, env.root);
    await writePointer({ sourceId: spec.id, activeFile: activeFileName(spec.id) });

    let fetched = 0;
    // SAFETY: globalThis.fetch is a real runtime global; cast exposes the slot to install the counting stub.
    (globalThis as { fetch: unknown }).fetch = async () => {
      fetched += 1;
      return { ok: true, status: 200, body: null, arrayBuffer: async () => new ArrayBuffer(0) };
    };

    for (let i = 0; i < 3; i++) {
      const art = await ensureArtifact(spec);
      expect(art.downloaded).toBe(false);
      // Bytes are byte-identical to the seeded corpus — no in-place mutation.
      expect(Array.from(art.bytes)).toEqual(Array.from(original));
    }
    expect(fetched).toBe(0);

    // The on-disk file itself is unchanged.
    const onDisk = await readSeed(spec.id, activeFileName(spec.id), env.root);
    expect(Array.from(onDisk!)).toEqual(Array.from(original));
  });

  it("keeps the valid corpus byte-identical when a separate redownload's validation rejects", async () => {
    // Seed a valid corpus for spec A. Force the redownload path by dropping the
    // pointer AND leaving an INVALID legacy file, so adoption fails verifyBytes
    // and ensureArtifact falls through to a fresh download whose staging is
    // rejected by the validator. The on-disk file (invalid legacy) is untouched
    // by the failure; a separately-seeded valid second corpus stays readable.
    const a = makeSpec(16, "en.sahih");
    const valid = PAYLOAD(16);
    await seedFile(a.id, activeFileName(a.id), valid, env.root);
    await writePointer({ sourceId: a.id, activeFile: activeFileName(a.id) });

    const b = makeSpec(8, "fr.hamidullah");
    // Legacy file for B is wrong-sized so it will not be adopted.
    await seedFile(b.id, activeFileName(b.id), new Uint8Array(4).fill(9), env.root);
    setFetchPayload(PAYLOAD(8));
    const rejectValidate = () => {
      throw new Error("content reject");
    };
    await expect(ensureArtifact(b, undefined, { validate: rejectValidate })).rejects.toThrow(
      /content reject/,
    );

    // Spec A's valid corpus is byte-identical and still readable.
    const art = await ensureArtifact(a);
    expect(art.downloaded).toBe(false);
    expect(Array.from(art.bytes)).toEqual(Array.from(valid));
    const onDisk = await readSeed(a.id, activeFileName(a.id), env.root);
    expect(Array.from(onDisk!)).toEqual(Array.from(valid));
  });

  it("keeps the valid corpus readable when another artifact's download is interrupted", async () => {
    const a = makeSpec(16, "en.sahih");
    const valid = PAYLOAD(16);
    await seedFile(a.id, activeFileName(a.id), valid, env.root);
    await writePointer({ sourceId: a.id, activeFile: activeFileName(a.id) });

    const b = makeSpec(8, "fr.hamidullah");
    setFetchError("network down");
    await expect(ensureArtifact(b)).rejects.toThrow(/network down/);

    // A's corpus survives B's interrupted download byte-identically.
    const art = await ensureArtifact(a);
    expect(art.downloaded).toBe(false);
    expect(Array.from(art.bytes)).toEqual(Array.from(valid));
  });

  it("re-opens and re-serves a valid legacy corpus exactly once, byte-identical", async () => {
    const spec = makeSpec(16);
    const original = PAYLOAD(16);
    await seedFile(spec.id, activeFileName(spec.id), original, env.root);
    // No pointer yet -> first call adopts the valid legacy file once.

    let validates = 0;
    const validate = (bytes: Uint8Array) => {
      validates += 1;
      // The validator sees the real staged/legacy bytes, not a stub.
      expect(Array.from(bytes)).toEqual(Array.from(original));
    };

    const first = await ensureArtifact(spec, undefined, { validate });
    expect(first.downloaded).toBe(false);
    expect(validates).toBe(1);
    expect(Array.from(first.bytes)).toEqual(Array.from(original));
    expect(await readPointerViaExport(spec.id)).toEqual({
      sourceId: spec.id,
      activeFile: activeFileName(spec.id),
    });

    // Second call serves via pointer (no re-validation, no re-adoption).
    const second = await ensureArtifact(spec, undefined, { validate });
    expect(second.downloaded).toBe(false);
    expect(validates).toBe(1);
    expect(Array.from(second.bytes)).toEqual(Array.from(original));
  });

  it("preserves the valid corpus, cleans the staged temp, and leaves the pointer unchanged when a redownload's commit-phase pointer write fails", async () => {
    // A is the old validated corpus that must survive B's commit failure.
    const a = makeSpec(16, "en.sahih");
    const valid = PAYLOAD(16);
    await seedFile(a.id, activeFileName(a.id), valid, env.root);
    await writePointer({ sourceId: a.id, activeFile: activeFileName(a.id) });

    // B reaches the commit phase on a fresh redownload; moveOpfsFile promotes
    // temp -> active (consuming the temp), then writePointer throws. This is
    // the commit-phase failure point at which the temp is already cleaned and
    // the pointer is not yet updated. ensureArtifact swallows the OPFS failure
    // and falls back to IDB, so the call still resolves.
    const b = makeSpec(24, "fr.hamidullah");
    setFetchPayload(PAYLOAD(24));
    const restore = await breakNextPointerPut();
    let result: Awaited<ReturnType<typeof ensureArtifact>>;
    try {
      result = await ensureArtifact(b);
    } finally {
      restore();
    }

    // OPFS commit failed, so B was served via the IDB fallback.
    expect(result.store).toBe("idb");
    // The commit move succeeded before the pointer write threw, so B's staged
    // temp was consumed and cleaned.
    expect(await readSeed(b.id, tempFileName(b.id), env.root)).toBeNull();
    // The pointer write threw, so B's pointer stays unchanged (none).
    expect(await readPointerViaExport(b.id)).toBeNull();

    // A's valid corpus is untouched by B's commit failure: byte-identical on
    // disk and still served from cache.
    const onDisk = await readSeed(a.id, activeFileName(a.id), env.root);
    expect(onDisk).not.toBeNull();
    expect(Array.from(onDisk!)).toEqual(Array.from(valid));
    const art = await ensureArtifact(a);
    expect(art.downloaded).toBe(false);
    expect(Array.from(art.bytes)).toEqual(Array.from(valid));
  });
});

describe("pointer round-trip through the pointer store", () => {
  beforeEach(() => installFakes());
  afterEach(() => {
    // SAFETY: navigator.storage is optional at runtime; cast exposes it for conditional teardown.
    const nav = globalThis.navigator as { storage?: unknown } | undefined;
    if (nav) delete nav.storage;
    // SAFETY: globalThis.indexedDB is set by installFakes; cast exposes it for teardown.
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it("writes and reads back the active pointer, then clears it", async () => {
    const p: ActivePointer = { sourceId: SPEC_ID, activeFile: activeFileName(SPEC_ID) };
    expect(await readPointer(SPEC_ID)).toBeNull();
    await writePointer(p);
    expect(await readPointer(SPEC_ID)).toEqual(p);
    await clearPointer(SPEC_ID);
    expect(await readPointer(SPEC_ID)).toBeNull();
  });

  it("uses a dedicated pointer database separate from the recency store", () => {
    expect(POINTER_DB).not.toBe("easyquran-meta");
    expect(POINTER_STORE).toBe("opfsPointers");
    expect(QURAN_ROW_COUNT).toBe(6236);
  });
});
