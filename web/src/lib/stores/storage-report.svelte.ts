import { browser } from "$app/environment";
import { isArabicSourceId } from "$lib/data/quran-types";
import { requestStorageStats, type StorageLayerStats } from "$lib/offline/messages";
import { offline } from "$lib/offline/offline-store.svelte";
import {
  quranWorker,
  StorageAdminError,
  type StorageAdminFailure,
} from "$lib/quran/worker-client";
import type { StorageArtifactInfo } from "$lib/quran/protocol";
import { sumBy } from "es-toolkit";

export const TRANSLATION_CAP_BYTES = 256 * 1024 * 1024;

export type StorageReportPhase = "boot" | "ready" | "error";

export type StorageLayerId = "arabic" | "translations" | "pack" | "pages" | "data" | "other";

export interface StorageLayer {
  readonly id: StorageLayerId;
  readonly bytes: number;
}

export interface StackLayersInput {
  readonly artifacts: readonly StorageArtifactInfo[];
  readonly packBytes: number;
  readonly pagesBytes: number | null;
  readonly dataBytes: number | null;
  readonly usage: number | null;
}

export const TRANSLATION_CAP_WARNING_RATIO = 0.8;
export const QUOTA_WARNING_RATIO = 0.9;

function sumArtifacts(
  artifacts: readonly StorageArtifactInfo[],
  arabic: boolean,
): number {
  return sumBy(artifacts, (a) => (isArabicSourceId(a.id) === arabic ? a.sizeBytes : 0));
}

export function stackStorageLayers(input: StackLayersInput): StorageLayer[] {
  const layers: StorageLayer[] = [
    { id: "arabic", bytes: sumArtifacts(input.artifacts, true) },
    { id: "translations", bytes: sumArtifacts(input.artifacts, false) },
    { id: "pack", bytes: input.packBytes },
  ];
  if (input.pagesBytes !== null) layers.push({ id: "pages", bytes: input.pagesBytes });
  if (input.dataBytes !== null) layers.push({ id: "data", bytes: input.dataBytes });
  if (input.usage !== null) {
    const owned = sumBy(layers, (layer) => layer.bytes);
    const residual = Math.max(0, input.usage - owned);
    if (residual > 0) layers.push({ id: "other", bytes: residual });
  }
  return layers;
}

export function layerTotal(layers: readonly StorageLayer[]): number {
  return sumBy(layers, (layer) => layer.bytes);
}

export function isTranslationCapHigh(layers: readonly StorageLayer[]): boolean {
  const translations = layers.find((layer) => layer.id === "translations");
  if (!translations) return false;
  return translations.bytes > TRANSLATION_CAP_BYTES * TRANSLATION_CAP_WARNING_RATIO;
}

export function isQuotaHigh(usage: number | null, quota: number | null): boolean {
  if (usage === null || quota === null || quota <= 0) return false;
  return usage > quota * QUOTA_WARNING_RATIO;
}

export function layoutUsageSegments(
  trackUnits: number,
  segments: readonly { bytes: number }[],
  quotaBytes: number,
  minUnits = 3,
): number[] {
  if (quotaBytes <= 0 || trackUnits <= 0) return segments.map(() => 0);
  const raw = segments.map((s) =>
    s.bytes > 0 ? Math.min(trackUnits, (s.bytes / quotaBytes) * trackUnits) : 0,
  );
  const floored = raw.map((w) => (w > 0 ? Math.max(w, minUnits) : 0));
  let total = 0;
  for (const w of floored) total += w;
  if (total <= trackUnits) return floored;
  const scale = trackUnits / total;
  return floored.map((w) => w * scale);
}

export interface ClearAllResult {
  readonly freedBytes: number;
  readonly failures: number;
}

function deletedTranslationBytes(
  before: readonly StorageArtifactInfo[],
  after: readonly StorageArtifactInfo[],
  skipped: ReadonlySet<string>,
): number {
  const remaining = new Set(after.map((artifact) => artifact.id));
  return sumBy(before, (artifact) => {
    if (isArabicSourceId(artifact.id) || skipped.has(artifact.id)) return 0;
    if (remaining.has(artifact.id) || artifact.store === "session") return 0;
    return artifact.sizeBytes;
  });
}

export type DeleteOutcome = "ok" | StorageAdminFailure | "error";

class StorageReportStore {
  artifacts = $state<readonly StorageArtifactInfo[]>([]);
  swPages = $state<StorageLayerStats | null>(null);
  swData = $state<StorageLayerStats | null>(null);
  persisted = $state<boolean | null>(null);
  phase = $state<StorageReportPhase>("boot");
  #hydrated = false;
  #refreshSeq = 0;
  #statusDetach: (() => void) | null = null;

  get usage(): number | null {
    return offline.usage;
  }
  get quota(): number | null {
    return offline.quota;
  }
  get packBytes(): number {
    return offline.activePack?.bytes ?? 0;
  }

  get layers(): StorageLayer[] {
    return stackStorageLayers({
      artifacts: this.artifacts,
      packBytes: this.packBytes,
      pagesBytes: this.swPages ? this.swPages.bytes : null,
      dataBytes: this.swData ? this.swData.bytes : null,
      usage: this.usage,
    });
  }

  hydrate(): void {
    if (!browser) return;
    if (!this.#hydrated) {
      this.#hydrated = true;
      this.#statusDetach =
        quranWorker.onStatus?.((status) => {
          if (status === "ready" || status === "translation-fetch-failed") void this.refresh();
        }) ?? null;
    }
    void this.refresh();
  }

  dispose(): void {
    this.#statusDetach?.();
    this.#statusDetach = null;
    this.#hydrated = false;
  }

  async refresh(): Promise<void> {
    if (!browser) return;
    const seq = ++this.#refreshSeq;
    try {
      await quranWorker.whenReady();
      if (seq !== this.#refreshSeq) return;
    } catch {
      if (seq === this.#refreshSeq) this.phase = "error";
      return;
    }
    const [artifacts, sw] = await Promise.all([
      quranWorker.listArtifacts().catch(() => null),
      requestStorageStats(),
      offline.refreshEstimate(),
    ]);
    if (seq !== this.#refreshSeq) return;
    if (artifacts === null) {
      this.phase = "error";
      return;
    }
    const persisted = await readPersisted();
    if (seq !== this.#refreshSeq) return;
    this.artifacts = artifacts;
    this.swPages = sw ? sw.pages : null;
    this.swData = sw ? sw.data : null;
    this.persisted = persisted;
    this.phase = "ready";
  }

  async deleteArtifact(id: string): Promise<DeleteOutcome> {
    try {
      await quranWorker.deleteTranslation(id);
    } catch (e) {
      if (e instanceof StorageAdminError) return e.failure;
      return "error";
    }
    await this.refresh();
    return "ok";
  }

  async clearAllTranslations(skip: readonly string[]): Promise<ClearAllResult> {
    const skipped = new Set(skip);
    const targets = this.artifacts.filter(
      (artifact) => !isArabicSourceId(artifact.id) && !skipped.has(artifact.id),
    );
    const before = await quranWorker.listArtifacts().catch(() => null);
    let failures = 0;
    for (const artifact of targets) {
      try {
        await quranWorker.deleteTranslation(artifact.id);
      } catch {
        failures++;
      }
    }
    const after = await quranWorker.listArtifacts().catch(() => null);
    await this.refresh();
    const freedBytes =
      before !== null && after !== null ? deletedTranslationBytes(before, after, skipped) : 0;
    return { freedBytes, failures };
  }

  async requestPersist(): Promise<boolean> {
    if (!browser || !navigator.storage?.persist) return false;
    let granted = false;
    try {
      granted = await navigator.storage.persist();
    } catch {
      granted = false;
    }
    this.persisted = granted;
    return granted;
  }
}

async function readPersisted(): Promise<boolean | null> {
  if (!browser || !navigator.storage?.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

export function createStorageReport(): StorageReportStore {
  return new StorageReportStore();
}

export const storageReport = new StorageReportStore();
