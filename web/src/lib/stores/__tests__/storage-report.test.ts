import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { StorageArtifactInfo } from "$lib/quran/protocol";

interface OfflinePackMirror {
  packId: string;
  entries: number;
  bytes: number;
  savedAt: number;
}

interface OfflineStoreMock {
  usage: number | null;
  quota: number | null;
  activePack: OfflinePackMirror | null;
  refreshEstimate: () => Promise<void>;
}

const h = vi.hoisted(() => ({
  workerMock: {
    whenReady: vi.fn<() => Promise<void>>(),
    listArtifacts: vi.fn<() => Promise<StorageArtifactInfo[]>>(),
    deleteTranslation: vi.fn<(id: string) => Promise<void>>(),
    onStatus: vi.fn<(cb: (s: string) => void) => () => void>(),
  },
  statsMock: {
    requestStorageStats: vi.fn<
      () => Promise<{ pages: { entries: number; bytes: number }; data: { entries: number; bytes: number } } | null>
    >(),
  },
  offlineMock: {
    usage: null,
    quota: null,
    activePack: null,
    refreshEstimate: () => Promise.resolve(),
  },
  AdminErrorMock: class extends Error {
    readonly failure: "arabic" | "busy";
    constructor(failure: "arabic" | "busy") {
      super(failure);
      this.failure = failure;
    }
  },
}));

const workerMock = h.workerMock;
const statsMock = h.statsMock;
const offlineMock: OfflineStoreMock = h.offlineMock;

let statusCb: ((s: string, detail?: string) => void) | null = null;

function emitStatus(s: string): void {
  statusCb?.(s, "detail");
}

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$lib/quran/worker-client", () => ({
  quranWorker: h.workerMock,
  StorageAdminError: h.AdminErrorMock,
}));
vi.mock("$lib/offline/offline-store.svelte", () => ({ offline: h.offlineMock }));
vi.mock("$lib/offline/messages", () => ({ requestStorageStats: h.statsMock.requestStorageStats }));

import {
  createStorageReport,
  isQuotaHigh,
  isTranslationCapHigh,
  layerTotal,
  layoutUsageSegments,
  stackStorageLayers,
  TRANSLATION_CAP_BYTES,
} from "$lib/stores/storage-report.svelte";
import { CAP_BYTES } from "$lib/workers/opfs-retention";

const MB = 1024 * 1024;

function artifact(partial: Partial<StorageArtifactInfo> & { id: string }): StorageArtifactInfo {
  return {
    store: "opfs",
    tag: partial.id,
    sizeBytes: MB,
    lastUsed: null,
    ...partial,
  };
}

beforeEach(() => {
  statusCb = null;
  workerMock.whenReady.mockReset().mockResolvedValue(undefined);
  workerMock.listArtifacts.mockReset();
  workerMock.deleteTranslation.mockReset().mockResolvedValue(undefined);
  workerMock.onStatus.mockReset().mockImplementation((cb: (s: string) => void) => {
    statusCb = cb;
    return () => {
      statusCb = null;
    };
  });
  statsMock.requestStorageStats.mockReset().mockResolvedValue(null);
  offlineMock.usage = null;
  offlineMock.quota = null;
  offlineMock.activePack = null;
  Object.defineProperty(globalThis.navigator, "storage", {
    value: {
      persisted: async () => true,
      persist: async () => false,
      getDirectory: async () => {
        throw new Error("no opfs in test");
      },
    },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  // SAFETY: navigator.storage is optional at runtime; cast exposes it for teardown.
  const nav = globalThis.navigator as { storage?: unknown } | undefined;
  if (nav) delete nav.storage;
});

describe("storage report fan-in", () => {
  it("fans in artifacts, SW stats, and persist state after whenReady resolves", async () => {
    workerMock.listArtifacts.mockResolvedValue([
      artifact({ id: "uthmani", sizeBytes: 2 * MB }),
      artifact({ id: "en.sahih" }),
    ]);
    offlineMock.usage = 6 * MB;
    offlineMock.quota = 60 * MB;
    offlineMock.activePack = { packId: "p", entries: 10, bytes: MB, savedAt: 0 };
    statsMock.requestStorageStats.mockResolvedValue({
      pages: { entries: 4, bytes: MB },
      data: { entries: 2, bytes: 0.5 * MB },
    });

    const report = createStorageReport();
    report.hydrate();
    await report.refresh();

    expect(report.phase).toBe("ready");
    expect(report.artifacts).toHaveLength(2);
    expect(report.swPages).toEqual({ entries: 4, bytes: MB });
    expect(report.swData).toEqual({ entries: 2, bytes: 0.5 * MB });
    expect(report.persisted).toBe(true);
  });

  it("gates on whenReady and reports error when the engine fails to boot", async () => {
    workerMock.whenReady.mockRejectedValue(new Error("no worker"));
    const report = createStorageReport();
    await report.refresh();
    expect(report.phase).toBe("error");
    expect(workerMock.listArtifacts).not.toHaveBeenCalled();
  });

  it("reports error when the artifact list is malformed or fails", async () => {
    workerMock.listArtifacts.mockRejectedValue(new Error("list boom"));
    const report = createStorageReport();
    await report.refresh();
    expect(report.phase).toBe("error");
  });

  it("maps StorageAdminError failures from deleteTranslation", async () => {
    workerMock.listArtifacts.mockResolvedValue([]);
    workerMock.deleteTranslation.mockRejectedValue(new h.AdminErrorMock("busy"));
    const report = createStorageReport();
    const outcome = await report.deleteArtifact("en.sahih");
    expect(outcome).toBe("busy");
  });

  it("refreshes from worker truth after a successful deleteArtifact", async () => {
    workerMock.listArtifacts
      .mockResolvedValueOnce([artifact({ id: "en.sahih" })])
      .mockResolvedValueOnce([]);
    workerMock.deleteTranslation.mockResolvedValue(undefined);
    const report = createStorageReport();
    await report.refresh();
    expect(report.artifacts.map((a) => a.id)).toEqual(["en.sahih"]);

    const outcome = await report.deleteArtifact("en.sahih");

    expect(outcome).toBe("ok");
    expect(workerMock.deleteTranslation).toHaveBeenCalledWith("en.sahih");
    expect(workerMock.listArtifacts).toHaveBeenCalledTimes(2);
    expect(report.artifacts).toEqual([]);
    expect(report.phase).toBe("ready");
  });

  it("clearAllTranslations skips Arabic and passed ids and sums freed bytes", async () => {
    workerMock.listArtifacts
      .mockResolvedValueOnce([
        artifact({ id: "uthmani", sizeBytes: 2 * MB }),
        artifact({ id: "en.sahih", sizeBytes: 3 * MB }),
        artifact({ id: "ur.jalandhry", sizeBytes: 4 * MB }),
      ])
      .mockResolvedValue([]);
    workerMock.deleteTranslation.mockResolvedValue(undefined);
    const report = createStorageReport();
    report.artifacts = [
      artifact({ id: "uthmani", sizeBytes: 2 * MB }),
      artifact({ id: "en.sahih", sizeBytes: 3 * MB }),
      artifact({ id: "ur.jalandhry", sizeBytes: 4 * MB }),
    ];
    const result = await report.clearAllTranslations(["ur.jalandhry"]);
    expect(workerMock.deleteTranslation).toHaveBeenCalledTimes(1);
    expect(workerMock.deleteTranslation).toHaveBeenCalledWith("en.sahih");
    expect(result).toEqual({ freedBytes: 3 * MB, failures: 0 });
  });

  it("clearAllTranslations deletes session artifacts but never counts their bytes as freed", async () => {
    workerMock.listArtifacts
      .mockResolvedValueOnce([
        artifact({ id: "en.sahih", sizeBytes: 3 * MB }),
        artifact({ id: "fr.hamid", sizeBytes: 2 * MB, store: "session" }),
      ])
      .mockResolvedValue([]);
    workerMock.deleteTranslation.mockResolvedValue(undefined);
    const report = createStorageReport();
    report.artifacts = [
      artifact({ id: "en.sahih", sizeBytes: 3 * MB }),
      artifact({ id: "fr.hamid", sizeBytes: 2 * MB, store: "session" }),
    ];
    const result = await report.clearAllTranslations([]);
    expect(workerMock.deleteTranslation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ freedBytes: 3 * MB, failures: 0 });
  });

  it("clearAllTranslations does not count artifacts another tab already evicted", async () => {
    workerMock.listArtifacts.mockResolvedValue([]);
    workerMock.deleteTranslation.mockResolvedValue(undefined);
    const report = createStorageReport();
    report.artifacts = [artifact({ id: "en.sahih", sizeBytes: 3 * MB })];
    const result = await report.clearAllTranslations([]);
    expect(workerMock.deleteTranslation).toHaveBeenCalledWith("en.sahih");
    expect(result).toEqual({ freedBytes: 0, failures: 0 });
  });

  it("clearAllTranslations refreshes once after the whole run, not per artifact", async () => {
    workerMock.listArtifacts
      .mockResolvedValueOnce([
        artifact({ id: "en.sahih" }),
        artifact({ id: "fr.hamid" }),
        artifact({ id: "ur.jalandhry" }),
      ])
      .mockResolvedValue([]);
    workerMock.deleteTranslation.mockResolvedValue(undefined);
    const report = createStorageReport();
    report.artifacts = [
      artifact({ id: "en.sahih" }),
      artifact({ id: "fr.hamid" }),
      artifact({ id: "ur.jalandhry" }),
    ];
    await report.clearAllTranslations([]);
    expect(workerMock.deleteTranslation).toHaveBeenCalledTimes(3);
    expect(workerMock.listArtifacts).toHaveBeenCalledTimes(3);
  });

  it("counts per-row failures without aborting the bulk run", async () => {
    workerMock.listArtifacts
      .mockResolvedValueOnce([
        artifact({ id: "en.sahih", sizeBytes: 2 * MB }),
        artifact({ id: "fr.hamid", sizeBytes: MB }),
      ])
      .mockResolvedValueOnce([artifact({ id: "en.sahih", sizeBytes: 2 * MB })])
      .mockResolvedValue([]);
    workerMock.deleteTranslation
      .mockRejectedValueOnce(new h.AdminErrorMock("busy"))
      .mockResolvedValue(undefined);
    const report = createStorageReport();
    report.artifacts = [artifact({ id: "en.sahih", sizeBytes: 2 * MB }), artifact({ id: "fr.hamid" })];
    const result = await report.clearAllTranslations([]);
    expect(result).toEqual({ freedBytes: MB, failures: 1 });
  });

  it("hydrate() re-syncs from worker truth on every entry, not only the first", async () => {
    workerMock.listArtifacts.mockResolvedValue([]);
    const report = createStorageReport();
    report.hydrate();
    await new Promise((r) => setTimeout(r, 0));
    expect(report.artifacts).toHaveLength(0);
    workerMock.listArtifacts.mockResolvedValue([artifact({ id: "en.sahih" })]);
    report.hydrate();
    await new Promise((r) => setTimeout(r, 0));
    expect(report.artifacts.map((a) => a.id)).toEqual(["en.sahih"]);
    report.dispose();
  });

  it("refreshes when the worker reports a status that changes storage truth", async () => {
    workerMock.listArtifacts.mockResolvedValue([]);
    const report = createStorageReport();
    report.hydrate();
    await new Promise((r) => setTimeout(r, 0));
    expect(report.artifacts).toHaveLength(0);
    const baseline = workerMock.listArtifacts.mock.calls.length;
    expect(baseline).toBe(1);

    emitStatus("downloading");
    await new Promise((r) => setTimeout(r, 0));
    expect(workerMock.listArtifacts.mock.calls.length).toBe(baseline);

    emitStatus("error");
    await new Promise((r) => setTimeout(r, 0));
    expect(workerMock.listArtifacts.mock.calls.length).toBe(baseline);

    workerMock.listArtifacts.mockResolvedValue([
      artifact({ id: "en.sahih" }),
      artifact({ id: "ur.jalandhry" }),
    ]);
    emitStatus("ready");
    await new Promise((r) => setTimeout(r, 0));
    expect(report.artifacts.map((a) => a.id)).toEqual(["en.sahih", "ur.jalandhry"]);
    expect(workerMock.listArtifacts.mock.calls.length).toBe(baseline + 1);

    emitStatus("translation-fetch-failed");
    await new Promise((r) => setTimeout(r, 0));
    expect(workerMock.listArtifacts.mock.calls.length).toBe(baseline + 2);
    report.dispose();
  });

  it("dispose detaches the worker status subscription", async () => {
    workerMock.listArtifacts.mockResolvedValue([]);
    const report = createStorageReport();
    report.hydrate();
    await new Promise((r) => setTimeout(r, 0));
    report.dispose();
    emitStatus("ready");
    await new Promise((r) => setTimeout(r, 0));
    const settled = workerMock.listArtifacts.mock.calls.length;
    expect(settled).toBeGreaterThan(0);
    emitStatus("ready");
    await new Promise((r) => setTimeout(r, 0));
    expect(workerMock.listArtifacts.mock.calls.length).toBe(settled);
  });

  it("hydrate re-subscribes the status listener after dispose", async () => {
    workerMock.listArtifacts.mockResolvedValue([]);
    const report = createStorageReport();
    report.hydrate();
    report.dispose();
    report.hydrate();
    await new Promise((r) => setTimeout(r, 0));
    const baseline = workerMock.listArtifacts.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);
    emitStatus("ready");
    await new Promise((r) => setTimeout(r, 0));
    expect(workerMock.listArtifacts.mock.calls.length).toBe(baseline + 1);
    report.dispose();
  });

  it("a stale in-flight listing cannot overwrite a newer refresh", async () => {
    let resolveStale!: (list: StorageArtifactInfo[]) => void;
    workerMock.listArtifacts
      .mockImplementationOnce(
        () =>
          new Promise<StorageArtifactInfo[]>((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValue([artifact({ id: "en.sahih" })]);
    const report = createStorageReport();
    const stale = report.refresh();
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveStale).toBeTypeOf("function");
    const fresh = report.refresh();
    await fresh;
    expect(report.artifacts.map((a) => a.id)).toEqual(["en.sahih"]);
    resolveStale([artifact({ id: "uthmani" })]);
    await stale;
    expect(report.artifacts.map((a) => a.id)).toEqual(["en.sahih"]);
  });

  it("a stale refresh cannot stamp a stale persisted value", async () => {
    let resolveStale!: (granted: boolean) => void;
    let resolveFresh!: (granted: boolean) => void;
    let persistedCalls = 0;
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {
        persisted: () =>
          new Promise<boolean>((resolve) => {
            persistedCalls += 1;
            if (persistedCalls === 1) resolveStale = resolve;
            else resolveFresh = resolve;
          }),
      },
      configurable: true,
      writable: true,
    });
    workerMock.listArtifacts.mockResolvedValue([]);
    const report = createStorageReport();
    const stale = report.refresh();
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveStale).toBeTypeOf("function");
    const fresh = report.refresh();
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveFresh).toBeTypeOf("function");
    expect(report.persisted).toBe(null);
    resolveStale(true);
    await stale;
    expect(report.persisted).toBe(null);
    resolveFresh(false);
    await fresh;
    expect(report.persisted).toBe(false);
  });

  it("requestPersist stores and returns a grant", async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { persist: async () => true },
      configurable: true,
      writable: true,
    });
    const report = createStorageReport();
    await expect(report.requestPersist()).resolves.toBe(true);
    expect(report.persisted).toBe(true);
  });

  it("requestPersist surfaces a persist() resolution of false and keeps persisted false", async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { persist: async () => false },
      configurable: true,
      writable: true,
    });
    const report = createStorageReport();
    await expect(report.requestPersist()).resolves.toBe(false);
    expect(report.persisted).toBe(false);
  });

  it("requestPersist collapses a persist() rejection to denied", async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {
        persist: async () => {
          throw new Error("denied");
        },
      },
      configurable: true,
      writable: true,
    });
    const report = createStorageReport();
    await expect(report.requestPersist()).resolves.toBe(false);
    expect(report.persisted).toBe(false);
  });

  it("requestPersist reports unsupported storage without touching persisted", async () => {
    // SAFETY: navigator.storage is optional at runtime; cast drops the beforeEach stub.
    const nav = globalThis.navigator as { storage?: unknown };
    delete nav.storage;
    const report = createStorageReport();
    await expect(report.requestPersist()).resolves.toBe(false);
    expect(report.persisted).toBe(null);
  });
});

describe("stackStorageLayers residual math", () => {
  it("splits arabic vs translations by id and adds the estimate residual", () => {
    const layers = stackStorageLayers({
      artifacts: [
        artifact({ id: "uthmani", sizeBytes: 2 * MB }),
        artifact({ id: "en.sahih", sizeBytes: 1 * MB }),
      ],
      packBytes: MB,
      pagesBytes: MB,
      dataBytes: 0.5 * MB,
      usage: 6.5 * MB,
    });
    const byId = new Map(layers.map((l) => [l.id, l.bytes]));
    expect(byId.get("arabic")).toBe(2 * MB);
    expect(byId.get("translations")).toBe(1 * MB);
    expect(byId.get("pack")).toBe(MB);
    expect(byId.get("other")).toBe(1 * MB);
  });

  it("floors the residual at 0 and hides it when the estimate under-reports", () => {
    const layers = stackStorageLayers({
      artifacts: [artifact({ id: "en.sahih", sizeBytes: 5 * MB })],
      packBytes: MB,
      pagesBytes: MB,
      dataBytes: MB,
      usage: 2 * MB,
    });
    expect(layers.find((l) => l.id === "other")).toBeUndefined();
    expect(layerTotal(layers)).toBe(8 * MB);
  });

  it("omits pages/data layers when SW stats are unavailable", () => {
    const layers = stackStorageLayers({
      artifacts: [],
      packBytes: 0,
      pagesBytes: null,
      dataBytes: null,
      usage: null,
    });
    expect(layers.map((l) => l.id)).toEqual(["arabic", "translations", "pack"]);
  });

  it("still accounts the estimate gap when SW stats are unavailable", () => {
    const layers = stackStorageLayers({
      artifacts: [
        artifact({ id: "uthmani", sizeBytes: 1.5 * MB }),
        artifact({ id: "en.sahih", sizeBytes: 8.5 * MB }),
      ],
      packBytes: 0,
      pagesBytes: null,
      dataBytes: null,
      usage: 305.3 * MB,
    });
    expect(layers.map((l) => l.id)).toEqual(["arabic", "translations", "pack", "other"]);
    expect(layers.find((l) => l.id === "other")?.bytes).toBeCloseTo(295.3 * MB, 5);
  });
});

describe("threshold + segment helpers", () => {
  it("warns when translations pass 80% of the 256MB cap", () => {
    const hot = stackStorageLayers({
      artifacts: [artifact({ id: "en.sahih", sizeBytes: 0.81 * TRANSLATION_CAP_BYTES })],
      packBytes: 0,
      pagesBytes: null,
      dataBytes: null,
      usage: null,
    });
    const cold = stackStorageLayers({
      artifacts: [artifact({ id: "en.sahih", sizeBytes: 0.79 * TRANSLATION_CAP_BYTES })],
      packBytes: 0,
      pagesBytes: null,
      dataBytes: null,
      usage: null,
    });
    expect(isTranslationCapHigh(hot)).toBe(true);
    expect(isTranslationCapHigh(cold)).toBe(false);
  });

  it("keeps the store cap pinned to the worker retention cap", () => {
    expect(TRANSLATION_CAP_BYTES).toBe(CAP_BYTES);
  });

  it("warns when usage passes 90% of quota", () => {
    expect(isQuotaHigh(9.1 * MB, 10 * MB)).toBe(true);
    expect(isQuotaHigh(9 * MB, 10 * MB)).toBe(false);
    expect(isQuotaHigh(null, 10 * MB)).toBe(false);
    expect(isQuotaHigh(9.5 * MB, 0)).toBe(false);
  });

  it("bumps tiny layers to the min sliver and rescales when the slivers overflow the track", () => {
    const widths = layoutUsageSegments(400, [{ bytes: 1 }, { bytes: 0 }, { bytes: 2 }], 400);
    expect(widths[0]).toBeGreaterThanOrEqual(3);
    expect(widths[1]).toBe(0);
    const total = widths.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(400);

    const many = layoutUsageSegments(
      400,
      Array.from({ length: 200 }, () => ({ bytes: 1 })),
      400,
    );
    const manyTotal = many.reduce((a, b) => a + b, 0);
    expect(manyTotal).toBeLessThanOrEqual(400 + 1e-6);
    expect(many.every((w) => w > 0)).toBe(true);
  });
});
