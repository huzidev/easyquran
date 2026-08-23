export const SKIP_WAITING = "SKIP_WAITING" as const;
export const APP_READY = "APP_READY" as const;
export const UPDATE_TAKEOVER = "UPDATE_TAKEOVER" as const;
export const PREPARE_RELOAD = "PREPARE_RELOAD" as const;
export const PURGE_USER_CACHES = "PURGE_USER_CACHES" as const;
export const PURGE_ACK = "PURGE_ACK" as const;
export const STORAGE_STATS = "STORAGE_STATS" as const;
export const STORAGE_STATS_ACK = "STORAGE_STATS_ACK" as const;

export const SW_BROADCAST_CHANNEL = "easyquran-sw";
export const UPDATE_BROADCAST_CHANNEL = "easyquran-update";
export const PREPARE_RELOAD_EVENT = "easyquran-prepare-reload";

export interface StorageLayerStats {
  readonly entries: number;
  readonly bytes: number;
}

export type ClientToSwMessage =
  | { type: typeof SKIP_WAITING }
  | { type: typeof APP_READY }
  | { type: typeof PURGE_USER_CACHES }
  | { type: typeof STORAGE_STATS };

export type SwToClientMessage =
  | { type: typeof UPDATE_TAKEOVER; version: string }
  | { type: typeof PURGE_ACK }
  | { type: typeof STORAGE_STATS_ACK; pages: StorageLayerStats; data: StorageLayerStats };

export type ClientToClientMessage = { type: typeof PREPARE_RELOAD };

export type UpdateMessage = SwToClientMessage | ClientToClientMessage;

const DEFAULT_PURGE_TIMEOUT_MS = 5000;

export function purgeUserCaches(timeoutMs: number = DEFAULT_PURGE_TIMEOUT_MS): Promise<void> {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- navigator is a browser-only global; this file is imported by both client and service-worker bundles, so importing $app/environment (the usual SSR guard) would break SW bundling.
  if (typeof navigator === "undefined") return Promise.resolve();
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const channel = new MessageChannel();
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        channel.port1.close();
      } catch {}
      try {
        channel.port2.close();
      } catch {}
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    channel.port1.onmessage = (): void => finish();
    try {
      ctrl.postMessage({ type: PURGE_USER_CACHES }, [channel.port2]);
    } catch {
      finish();
    }
  });
}

const DEFAULT_STATS_TIMEOUT_MS = 5000;

export function requestStorageStats(
  timeoutMs: number = DEFAULT_STATS_TIMEOUT_MS,
): Promise<{ pages: StorageLayerStats; data: StorageLayerStats } | null> {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- navigator is a browser-only global; this file is imported by both client and service-worker bundles, so importing $app/environment would break SW bundling
  if (typeof navigator === "undefined") return Promise.resolve(null);
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const channel = new MessageChannel();
    const finish = (
      value: { pages: StorageLayerStats; data: StorageLayerStats } | null,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        channel.port1.close();
      } catch {}
      try {
        channel.port2.close();
      } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<unknown>): void => {
      const msg = event.data;
      // eslint-disable-next-line anti-slop/no-runtime-typeof -- SW postMessage boundary; the runtime object check is the only discriminator before the type/field reads below
      if (!msg || typeof msg !== "object") return;
      // SAFETY: msg is narrowed to a non-null object; the cast only exposes the ack fields for validation.
      // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SW reply bag; each field is checked before use
      const m = msg as Record<string, unknown>;
      if (m.type !== STORAGE_STATS_ACK) return;
      const pages = decodeLayerStats(m.pages);
      const data = decodeLayerStats(m.data);
      if (!pages || !data) return;
      finish({ pages, data });
    };
    try {
      ctrl.postMessage({ type: STORAGE_STATS }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- boundary decoder: raw is the untyped SW reply field; this function IS the parser that validates the layer stats shape
function decodeLayerStats(raw: unknown): StorageLayerStats | null {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- SW postMessage boundary: typeof-object discriminates a non-null object before per-field validation
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // SAFETY: raw is narrowed to a non-null object by the guard above; the cast only exposes fields for the checks below.
  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SW reply bag; each field is checked before use
  const obj = raw as Record<string, unknown>;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- SW postMessage boundary field check: entries must be a number
  if (typeof obj.entries !== "number" || !Number.isFinite(obj.entries)) return null;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- SW postMessage boundary field check: bytes must be a number
  if (typeof obj.bytes !== "number" || !Number.isFinite(obj.bytes)) return null;
  return { entries: obj.entries, bytes: obj.bytes };
}
