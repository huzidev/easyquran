import { browser } from "$app/environment";
import { clearActivePack, getActivePack, setActivePack } from "$lib/offline/meta";
import { decodePack } from "$lib/offline/pack";
import { readJSON, writeJSON } from "$lib/storage";

const MIRROR_KEY = "easyquran.offline.pack";

export type OfflineStatus = "idle" | "downloading" | "staging" | "active" | "error";

interface PackMirror {
  packId: string;
  entries: number;
  bytes: number;
  savedAt: number;
}

interface OfflineManifest {
  pack: string;
  bytes: number;
  entries: number;
  appVersion?: string;
}

function extractPackId(packPath: string): string | null {
  const match = /pack\.([A-Za-z0-9_-]+)\.json$/u.exec(packPath);
  return match?.[1] ?? null;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- boundary decoder: raw is the untyped JSON value read back from localStorage; this function IS the parser that validates it.
function decodeMirror(raw: unknown): PackMirror | null {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- localStorage JSON boundary: typeof-object is the only honest way to discriminate a non-null object before per-field validation.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // SAFETY: preceding null/typeof-object/!Array.isArray guards proved raw is a non-null object with unknown JSON fields.
  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- localStorage JSON bag; each field is validated by name below before use.
  const obj = raw as Record<string, unknown>;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- localStorage JSON field check: packId must be a string.
  if (typeof obj.packId !== "string") return null;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- localStorage JSON field check: entries must be a number.
  if (typeof obj.entries !== "number") return null;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- localStorage JSON field check: bytes must be a number.
  if (typeof obj.bytes !== "number") return null;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- localStorage JSON field check: savedAt must be a number.
  if (typeof obj.savedAt !== "number") return null;
  return { packId: obj.packId, entries: obj.entries, bytes: obj.bytes, savedAt: obj.savedAt };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- boundary decoder: raw is the untyped manifest JSON from fetch; this function IS the parser that validates it.
function decodeOfflineManifest(raw: unknown): OfflineManifest | null {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- fetch JSON boundary: typeof-object discriminates a non-null object before per-field validation.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // SAFETY: preceding null/typeof-object/!Array.isArray guards proved raw is a non-null object with unknown JSON fields.
  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- fetch JSON bag; each field is validated by name below before use.
  const o = raw as Record<string, unknown>;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- fetch JSON field check: pack must be a string.
  if (typeof o.pack !== "string") return null;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- fetch JSON field check: bytes must be a finite number.
  if (typeof o.bytes !== "number" || !Number.isFinite(o.bytes)) return null;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- fetch JSON field check: entries must be a finite number.
  if (typeof o.entries !== "number" || !Number.isFinite(o.entries)) return null;
  const manifest: OfflineManifest = {
    pack: o.pack,
    bytes: o.bytes,
    entries: o.entries,
  };
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- fetch JSON field check: optional appVersion must be a string when present.
  if (typeof o.appVersion === "string") manifest.appVersion = o.appVersion;
  return manifest;
}

class OfflineStore {
  #status = $state<OfflineStatus>("idle");
  #progress = $state(0);
  #usage = $state<number | null>(null);
  #quota = $state<number | null>(null);
  #activePack = $state.raw<PackMirror | null>(null);
  #busy = $state(false);
  #hydrated = false;
  #reconcilePending = false;
  #generation = 0;

  get status(): OfflineStatus {
    return this.#status;
  }
  get progress(): number {
    return this.#progress;
  }
  get usage(): number | null {
    return this.#usage;
  }
  get quota(): number | null {
    return this.#quota;
  }
  get activePack(): PackMirror | null {
    return this.#activePack;
  }
  get busy(): boolean {
    return this.#busy;
  }
  get pct(): number {
    return Math.round(this.#progress * 100);
  }

  hydrate(): void {
    if (this.#hydrated || !browser) return;
    this.#hydrated = true;

    const mirror = decodeMirror(readJSON(MIRROR_KEY));
    if (mirror) {
      this.#activePack = mirror;
      this.#status = "active";
    }

    void this.refreshEstimate();
    void this.#reconcile();
  }

  async refreshEstimate(): Promise<void> {
    if (!browser || !navigator.storage?.estimate) return;
    try {
      const estimate = await navigator.storage.estimate();
      this.#usage = estimate.usage ?? null;
      this.#quota = estimate.quota ?? null;
    } catch {}
  }

  #mirror(): void {
    if (!browser) return;
    writeJSON(MIRROR_KEY, this.#activePack);
  }

  async #reconcile(): Promise<void> {
    const generation = this.#generation;
    const active = await getActivePack();
    if (!active) {
      if (generation !== this.#generation) return;
      if (this.#activePack) {
        this.#activePack = null;
        this.#mirror();
        this.#status = "idle";
      }
      return;
    }
    const cacheName = `eq-pack-${active.packId}`;
    let state: "unknown" | "intact" | "incomplete" = "unknown";
    try {
      state = (await caches.has(cacheName)) ? "intact" : "incomplete";
      if (state === "intact") {
        const staged = await caches.open(cacheName);
        if ((await staged.keys()).length !== active.entries) state = "incomplete";
      }
    } catch {}
    if (state === "unknown") {
      if (!this.#reconcilePending) {
        this.#reconcilePending = true;
        setTimeout(() => {
          this.#reconcilePending = false;
          void this.#reconcile();
        }, 30_000);
      }
      return;
    }
    if (generation !== this.#generation) return;
    if (state === "incomplete") {
      if ((await getActivePack())?.packId === active.packId) {
        await clearActivePack().catch(() => {});
      }
      await caches.delete(cacheName).catch(() => {});
      if (generation !== this.#generation) return;
      this.#activePack = null;
      this.#mirror();
      this.#status = "idle";
      return;
    }
    if (!this.#activePack || this.#activePack.packId !== active.packId) {
      this.#activePack = active;
      this.#mirror();
    }
    this.#status = "active";
    void this.#bootCheck();
  }

  async #bootCheck(): Promise<void> {
    try {
      const response = await fetch("/offline/manifest.json", { cache: "no-store" });
      if (!response.ok) return;
      const manifest = decodeOfflineManifest(await response.json());
      if (!manifest) return;
      const packId = extractPackId(manifest.pack);
      if (packId && this.#activePack && packId !== this.#activePack.packId) {
        void this.#enable(manifest);
      }
    } catch {}
  }

  enable(): Promise<void> {
    return this.#enable(null);
  }

  async #enable(existingManifest: OfflineManifest | null): Promise<void> {
    if (!browser || this.#busy) return;
    this.#busy = true;
    const previousPackId = this.#activePack?.packId ?? null;
    let targetPackId: string | null = null;
    try {
      let manifest = existingManifest;
      if (!manifest) {
        const manifestResponse = await fetch("/offline/manifest.json", { cache: "no-store" });
        if (!manifestResponse.ok) throw new Error(`manifest ${manifestResponse.status}`);
        manifest = decodeOfflineManifest(await manifestResponse.json());
        if (!manifest) throw new Error("manifest malformed");
      }
      targetPackId = extractPackId(manifest.pack);
      if (!targetPackId) throw new Error("manifest missing pack id");
      const totalBytes = manifest.bytes;
      const totalEntries = manifest.entries;

      if (previousPackId === targetPackId) {
        this.#status = "active";
        this.#progress = 1;
        return;
      }

      this.#status = "downloading";
      this.#progress = 0;
      const packResponse = await fetch(`/offline/pack.${targetPackId}.json`, { cache: "no-store" });
      if (!packResponse.ok || !packResponse.body)
        throw new Error(`pack fetch ${packResponse.status}`);

      const received = await this.#streamAccumulate(packResponse.body, totalBytes);
      if (received.byteLength !== totalBytes) {
        throw new Error(`pack size ${received.byteLength} != ${totalBytes}`);
      }
      const text = new TextDecoder().decode(received);

      this.#status = "staging";
      const { entries, bodies } = decodePack(text);

      const cache = await caches.open(`eq-pack-${targetPackId}`);
      const keys = Object.keys(entries);
      let staged = 0;
      for (const key of keys) {
        const bodyIndex = entries[key];
        const body = bodyIndex === undefined ? undefined : bodies[bodyIndex];
        // A malformed pack must fail staging, never cache an empty response over a Quran route.
        if (body === undefined) throw new Error(`pack entry ${key} has no body`);
        await cache.put(
          new Request(key),
          new Response(body, { headers: { "content-type": "application/json" } }),
        );
        staged += 1;
        this.#progress = 0.9 + 0.1 * (staged / keys.length);
      }
      if (staged !== keys.length) throw new Error(`staged ${staged} != ${keys.length}`);
      if (staged !== totalEntries)
        throw new Error(`staged count ${staged} != manifest ${totalEntries}`);

      const record: PackMirror = {
        packId: targetPackId,
        entries: totalEntries,
        bytes: totalBytes,
        savedAt: Date.now(),
      };
      await setActivePack(record);
      if (previousPackId && previousPackId !== targetPackId) {
        await caches.delete(`eq-pack-${previousPackId}`).catch(() => {});
      }
      this.#activePack = record;
      this.#mirror();
      this.#status = "active";
      this.#progress = 1;
      void this.refreshEstimate();
    } catch (err) {
      console.warn("[offline] enable failed:", err);
      if (targetPackId) await caches.delete(`eq-pack-${targetPackId}`).catch(() => {});
      this.#status = previousPackId ? "active" : "error";
    } finally {
      this.#busy = false;
      this.#generation += 1;
    }
  }

  async #streamAccumulate(
    body: ReadableStream<Uint8Array>,
    totalBytes: number,
  ): Promise<Uint8Array> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        this.#progress = totalBytes > 0 ? Math.min(0.9, (received / totalBytes) * 0.9) : 0;
      }
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  async disable(): Promise<void> {
    if (!browser || this.#busy) return;
    const packId = this.#activePack?.packId ?? null;
    this.#busy = true;
    try {
      await clearActivePack();
      if (packId) await caches.delete(`eq-pack-${packId}`).catch(() => {});
      this.#activePack = null;
      this.#mirror();
      this.#status = "idle";
      this.#progress = 0;
      void this.refreshEstimate();
    } catch (err) {
      console.warn("[offline] disable failed:", err);
      this.#status = "error";
    } finally {
      this.#busy = false;
      this.#generation += 1;
    }
  }
}

export function createOfflineStore(): OfflineStore {
  return new OfflineStore();
}

export const offline = createOfflineStore();
