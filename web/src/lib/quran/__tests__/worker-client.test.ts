import {
  OpenerKind,
  OpenerPackaging,
  QuranScript,
  QuranSourceId,
  type ArtifactSpec,
} from "$lib/data/quran-types";
import type { WorkerOutbound, WorkerRequest } from "$lib/quran/protocol";
import { SearchHitKind, SearchProvider } from "$lib/quran/search/types";
import { quranWorker, StorageAdminError } from "$lib/quran/worker-client";
import { QURAN_DATA } from "$lib/server/quran-data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("$lib/config/site", () => ({ QURAN: { apiBase: "" } }));

// eslint-disable-next-line anti-slop/no-unknown-parameters -- mirrors the DOM Worker addEventListener callback contract; quranWorker registers its own opaque message listener, so the event shape stays unknown at this fake boundary
type Listener = (e: unknown) => void;

class FakeWorker {
  static last: FakeWorker | null = null;
  readonly listeners = new Map<string, Set<Listener>>();
  readonly posted: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.last = this;
  }
  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  postMessage(msg: WorkerRequest): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(type: "message", data: WorkerOutbound): void;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- error/messageerror payloads follow the DOM Worker event contract (opaque event data); no test emits them
  emit(type: "error" | "messageerror", payload: unknown): void;
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- implementation signature must accept both the WorkerOutbound message payload and the opaque error payload above
  emit(type: string, payload: unknown): void {
    const evt = type === "message" ? { data: payload } : payload;
    this.listeners.get(type)?.forEach((fn) => fn(evt));
  }
}

const ARTIFACTS: readonly ArtifactSpec[] = [
    {
      id: QuranSourceId.TanzilUthmani,
      sizeBytes: 1,
      downloadUrl: "https://x/uthmani",
    },
    {
      id: QuranSourceId.TanzilSimpleClean,
      sizeBytes: 1,
      downloadUrl: "https://x/simple-clean",
    },
];

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.last = null;
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  quranWorker.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function startReady(): Promise<FakeWorker> {
  const started = quranWorker.start(ARTIFACTS, QURAN_DATA.coordinates);
  const fake = FakeWorker.last!;
  const init = fake.posted.find(
    (m): m is Extract<WorkerRequest, { type: "init" }> => m.type === "init",
  )!;
  fake.emit("message", { id: init.id, ok: true, result: null });
  await started;
  return fake;
}

describe("quranWorker request settlement", () => {
  it("coalesces pre-ready pinned translations and sends only latest state", async () => {
    const first = quranWorker.setPinnedTranslations(["en.sahih"]);
    const second = quranWorker.setPinnedTranslations(["ur.jalandhry", "en.sahih"]);
    expect(second).toBe(first);

    const started = quranWorker.start(ARTIFACTS, QURAN_DATA.coordinates);
    const fake = FakeWorker.last!;
    const init = fake.posted.find(
      (message): message is Extract<WorkerRequest, { type: "init" }> => message.type === "init",
    )!;
    fake.emit("message", { id: init.id, ok: true, result: null });
    fake.emit("message", { type: "status", status: "ready" });
    await started;
    await Promise.resolve();

    const pinRequests = fake.posted.filter(
      (message): message is Extract<WorkerRequest, { type: "setPinnedTranslations" }> =>
        message.type === "setPinnedTranslations",
    );
    expect(pinRequests).toHaveLength(1);
    expect(pinRequests[0]!.ids).toEqual(["ur.jalandhry", "en.sahih"]);
    fake.emit("message", { id: pinRequests[0]!.id, ok: true, result: null });
    await expect(first).resolves.toBeUndefined();
  });

  it("notifies page loaders when the worker reports ready", async () => {
    const ready = quranWorker.whenReady();
    const started = quranWorker.start(ARTIFACTS, QURAN_DATA.coordinates);
    const fake = FakeWorker.last!;
    fake.emit("message", { type: "status", status: "ready" });
    await ready;
    expect(quranWorker.ready).toBe(true);
    const init = fake.posted.find(
      (message): message is Extract<WorkerRequest, { type: "init" }> => message.type === "init",
    )!;
    fake.emit("message", { id: init.id, ok: true, result: null });
    await started;
  });

  it("resolves readSurah with the worker's verses", async () => {
    const fake = await startReady();
    expect(quranWorker.ready).toBe(true);

    const p = quranWorker.readSurah(1);
    const req = fake.posted.at(-1)!;
    const result = {
      sourceId: QuranSourceId.TanzilUthmani,
      script: QuranScript.Uthmani,
      verses: ["بسم", "الله"],
      normalization: {
        surah: 1,
        sourceId: QuranSourceId.TanzilUthmani,
        script: QuranScript.Uthmani,
        sourceProfile: "tanzil-uthmani-581cc540",
        packaging: OpenerPackaging.NumberedAyah,
        openerKind: OpenerKind.Verse,
        openerText: "بسم",
        openerEndScalar: 0,
        bodyStartScalar: 0,
      },
    } as const;
    fake.emit("message", { id: req.id, ok: true, result });

    expect(await p).toEqual(result);
  });

  it("rejects readSurah on an error response", async () => {
    const fake = await startReady();
    const p = quranWorker.readSurah(1);
    const req = fake.posted.at(-1)!;
    const assertion = expect(p).rejects.toThrow("no such surah");
    fake.emit("message", { id: req.id, ok: false, error: "no such surah" });
    await assertion;
  });

  it("decodes a clipped coordinate-aware range", async () => {
    const fake = await startReady();
    const resultPromise = quranWorker.readRange(
      8,
      9,
      (globalIndex, surah, ayah) => QURAN_DATA.globalIndexOf(surah, ayah) === globalIndex,
    );
    const req = fake.posted.at(-1)!;
    expect(req).toMatchObject({ type: "readRange", from: 8, to: 9 });
    const normalization = {
      surah: 2,
      sourceId: QuranSourceId.TanzilUthmani,
      script: QuranScript.Uthmani,
      sourceProfile: "tanzil-uthmani-581cc540",
      packaging: OpenerPackaging.EmbeddedPrefix,
      openerKind: OpenerKind.Header,
      openerText: "opener",
      openerEndScalar: 6,
      bodyStartScalar: 7,
    } as const;
    fake.emit("message", {
      id: req.id,
      ok: true,
      result: {
        ayahs: [
          { key: "2:1", surah: 2, ayah: 1, globalIndex: 8, text: "first" },
          { key: "2:2", surah: 2, ayah: 2, globalIndex: 9, text: "second" },
        ],
        normalizations: [normalization],
      },
    });

    expect(await resultPromise).toMatchObject({
      ayahs: [{ key: "2:1" }, { key: "2:2" }],
      normalizations: [{ surah: 2 }],
    });
  });

  it("decodes the canonical tagged search response", async () => {
    const fake = await startReady();
    const resultPromise = quranWorker.search("الم");
    const req = fake.posted.at(-1)!;
    fake.emit("message", {
      id: req.id,
      ok: true,
      result: {
        query: "الم",
        total: 1,
        limit: 20,
        offset: 0,
        results: [
          {
            kind: SearchHitKind.Ayah,
            ayah: {
              key: "2:1",
              surah: 2,
              ayah: 1,
              globalIndex: 8,
              text: "بِسْمِ ٱللَّهِ الٓمٓ",
            },
            highlights: [{ start: 16, end: 20 }],
          },
        ],
      },
    });

    expect(await resultPromise).toMatchObject({
      query: "الم",
      total: 1,
      source: SearchProvider.Worker,
      results: [{ kind: SearchHitKind.Ayah, ayah: { key: "2:1" } }],
    });
  });

  it("rejects a legacy ayah-only search response", async () => {
    const fake = await startReady();
    const resultPromise = quranWorker.search("الم");
    const assertion = expect(resultPromise).rejects.toThrow("malformed search response");
    const req = fake.posted.at(-1)!;
    fake.emit("message", {
      id: req.id,
      ok: true,
      result: {
        query: "الم",
        total: 1,
        limit: 20,
        offset: 0,
        results: [{ ayah: { key: "2:1" }, highlights: [] }],
      },
    });
    await assertion;
  });

  it("rejects a request that never gets a response (timeout)", async () => {
    await startReady();
    const p = quranWorker.readSurah(1);
    const assertion = expect(p).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("a post-init fatal rejects every in-flight request", async () => {
    const fake = await startReady();
    const statuses: Array<[string, string | undefined]> = [];
    const detach = quranWorker.onStatus((status, detail) => statuses.push([status, detail]));
    const p1 = quranWorker.readSurah(1);
    const p2 = quranWorker.readSurah(2);
    const a1 = expect(p1).rejects.toThrow("sqlite-wasm exploded");
    const a2 = expect(p2).rejects.toThrow("sqlite-wasm exploded");
    fake.emit("message", { type: "fatal", error: "sqlite-wasm exploded" });
    await a1;
    await a2;
    expect(fake.terminated).toBe(true);
    expect(quranWorker.ready).toBe(false);
    expect(statuses.at(-1)).toEqual(["error", "sqlite-wasm exploded"]);
    detach();

    const restarted = quranWorker.start(ARTIFACTS, QURAN_DATA.coordinates);
    const next = FakeWorker.last!;
    const init = next.posted.find(
      (message): message is Extract<WorkerRequest, { type: "init" }> => message.type === "init",
    )!;
    next.emit("message", { id: init.id, ok: true, result: null });
    await restarted;
    expect(next).not.toBe(fake);
    expect(quranWorker.ready).toBe(true);
  });

  it("dispose rejects in-flight requests and terminates the worker", async () => {
    const fake = await startReady();
    const p = quranWorker.readSurah(1);
    const assertion = expect(p).rejects.toThrow("disposed");
    quranWorker.dispose();
    await assertion;
    expect(fake.terminated).toBe(true);
    expect(quranWorker.ready).toBe(false);
  });
});

describe("quranWorker storage admin wire contract", () => {
  it("maps the busy wire error to a StorageAdminError", async () => {
    const fake = await startReady();
    const p = quranWorker.deleteTranslation("en.sahih");
    const req = fake.posted.at(-1)!;
    expect(req).toMatchObject({ type: "deleteArtifact", sourceId: "en.sahih" });
    const assertion = expect(p).rejects.toMatchObject({
      name: "StorageAdminError",
      failure: "busy",
    });
    fake.emit("message", { id: req.id, ok: false, error: "busy" });
    await assertion;
  });

  it("maps the arabic wire error to a StorageAdminError", async () => {
    const fake = await startReady();
    const p = quranWorker.deleteTranslation("uthmani");
    const req = fake.posted.at(-1)!;
    const assertion = expect(p).rejects.toBeInstanceOf(StorageAdminError);
    fake.emit("message", { id: req.id, ok: false, error: "arabic" });
    await assertion;
  });

  it("passes an unrelated wire error through untouched", async () => {
    const fake = await startReady();
    const messageCase = quranWorker.deleteTranslation("en.sahih");
    const messageReq = fake.posted.at(-1)!;
    const messageAssertion = expect(messageCase).rejects.toThrow("engine not ready");
    fake.emit("message", { id: messageReq.id, ok: false, error: "engine not ready" });
    await messageAssertion;

    const instanceCase = quranWorker.deleteTranslation("ur.jalandhry");
    const instanceReq = fake.posted.at(-1)!;
    const instanceAssertion = expect(instanceCase).rejects.not.toBeInstanceOf(StorageAdminError);
    fake.emit("message", { id: instanceReq.id, ok: false, error: "engine not ready" });
    await instanceAssertion;
  });

  it("decodes a valid artifact list", async () => {
    const fake = await startReady();
    const p = quranWorker.listArtifacts();
    const req = fake.posted.at(-1)!;
    expect(req).toMatchObject({ type: "listArtifacts" });
    const assertion = expect(p).resolves.toEqual([
      { id: "en.sahih", store: "opfs", tag: "en.sahih", sizeBytes: 2048, lastUsed: 1234 },
      { id: "fr.hamid", store: "idb", tag: "fr.hamid", sizeBytes: 4096, lastUsed: null },
      { id: "ur.jaw", store: "session", tag: "ur.jaw", sizeBytes: 1024, lastUsed: null },
    ]);
    fake.emit("message", {
      id: req.id,
      ok: true,
      result: [
        { id: "en.sahih", store: "opfs", tag: "en.sahih", sizeBytes: 2048, lastUsed: 1234 },
        { id: "fr.hamid", store: "idb", tag: "fr.hamid", sizeBytes: 4096, lastUsed: null },
        { id: "ur.jaw", store: "session", tag: "ur.jaw", sizeBytes: 1024, lastUsed: null },
      ],
    });
    await assertion;
  });

  it("rejects a malformed artifact list", async () => {
    const fake = await startReady();
    const p = quranWorker.listArtifacts();
    const req = fake.posted.at(-1)!;
    const assertion = expect(p).rejects.toThrow("malformed artifact list");
    fake.emit("message", {
      id: req.id,
      ok: true,
      result: [{ id: "en.sahih", store: "bogus", tag: "en.sahih", sizeBytes: 2048, lastUsed: null }],
    });
    await assertion;
  });

  it("rejects every malformed artifact field at the boundary", async () => {
    const fake = await startReady();
    const wellFormed = { id: "en.sahih", store: "opfs", tag: "en.sahih", sizeBytes: 2048, lastUsed: null };
    const cases: unknown[] = [
      "not-an-array",
      { not: "an array" },
      [{ ...wellFormed, id: "" }],
      [{ ...wellFormed, tag: 7 }],
      [{ ...wellFormed, sizeBytes: Number.NaN }],
      [{ ...wellFormed, sizeBytes: "2048" }],
      [{ ...wellFormed, lastUsed: "1234" }],
      [{ ...wellFormed, lastUsed: Number.POSITIVE_INFINITY }],
    ];
    for (const result of cases) {
      const p = quranWorker.listArtifacts();
      const req = fake.posted.at(-1)!;
      const assertion = expect(p).rejects.toThrow("malformed artifact list");
      fake.emit("message", { id: req.id, ok: true, result });
      await assertion;
    }
  });
});
