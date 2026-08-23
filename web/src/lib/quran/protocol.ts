import type {
  CanonicalQuranCoordinates,
  DownloadProgress,
  ArtifactSpec,
  QuranReaderSource,
  TranslationCatalogueEntry,
} from "$lib/data/quran-types";

import type { SearchOpts } from "./search/types";

export type WorkerStatus = "init" | "downloading" | "ready" | "error" | "translation-fetch-failed";

export interface StorageArtifactInfo {
  readonly id: string;
  readonly store: "opfs" | "idb" | "session";
  readonly tag: string;
  readonly sizeBytes: number;
  readonly lastUsed: number | null;
}

export type WorkerRequest =
  | {
      id: number;
      type: "init";
      artifacts: readonly ArtifactSpec[];
      coordinates: CanonicalQuranCoordinates;
      catalogue?: readonly TranslationCatalogueEntry[];
    }
  | { id: number; type: "readSurah"; num: number; source?: QuranReaderSource }
  | { id: number; type: "readRange"; from: number; to: number; source?: QuranReaderSource }
  | { id: number; type: "search"; query: string; opts?: SearchOpts }
  | { id: number; type: "hasTranslation"; source: QuranReaderSource }
  | { id: number; type: "ensureTranslation"; source: QuranReaderSource }
  | { id: number; type: "setPinnedTranslations"; ids: readonly string[] }
  | { id: number; type: "listArtifacts" }
  | { id: number; type: "deleteArtifact"; sourceId: string };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export type WorkerEvent =
  | { type: "status"; status: WorkerStatus; detail?: string }
  | { type: "fatal"; error: string }
  | ({ type: "progress" } & DownloadProgress);

export type WorkerOutbound = WorkerResponse | WorkerEvent;
