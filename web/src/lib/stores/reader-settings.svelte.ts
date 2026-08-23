import { browser } from "$app/environment";
import {
  asObject,
  asString,
  isFutureSchema,
  onStorageKey,
  readJSON,
  writeJSON,
} from "$lib/storage";

import type { ArabicFontId, TranslationFamily } from "$lib/config/reader-fonts";
import {
  ARABIC_FONT_MAX,
  ARABIC_FONT_MIN,
  ARABIC_FONT_STEP,
  TRANSLATION_FONT_MAX,
  TRANSLATION_FONT_MIN,
  TRANSLATION_FONT_STEP,
  type ReaderCore,
  type ReaderMode,
} from "./reader-core.svelte";
import type { ReaderPersistence } from "./reader-persistence.svelte";
import { applyReaderPresentation } from "./reader-presentation";

export function createReaderSettings(core: ReaderCore, persistence: ReaderPersistence) {
  const present = () => {
    applyReaderPresentation(
      core.s.mode,
      core.s.fontSize,
      core.s.arabicFont,
      core.s.translationSize,
      core.s.translationFamily,
    );
  };
  return {
    get arabicSizePx(): string {
      return `${core.s.fontSize}px`;
    },
    bigger(): void {
      core.s.fontSize = Math.min(ARABIC_FONT_MAX, core.s.fontSize + ARABIC_FONT_STEP);
      present();
      persistence.writeNow();
    },
    smaller(): void {
      core.s.fontSize = Math.max(ARABIC_FONT_MIN, core.s.fontSize - ARABIC_FONT_STEP);
      present();
      persistence.writeNow();
    },

    get arabicFont(): ArabicFontId {
      return core.s.arabicFont;
    },
    setArabicFont(id: ArabicFontId): void {
      if (core.s.arabicFont === id) return;
      core.s.arabicFont = id;
      present();
      persistence.writeNow();
    },
    get translationSizePx(): string {
      return `${core.s.translationSize}px`;
    },
    growTranslation(): void {
      core.s.translationSize = Math.min(
        TRANSLATION_FONT_MAX,
        core.s.translationSize + TRANSLATION_FONT_STEP,
      );
      present();
      persistence.writeNow();
    },
    shrinkTranslation(): void {
      core.s.translationSize = Math.max(
        TRANSLATION_FONT_MIN,
        core.s.translationSize - TRANSLATION_FONT_STEP,
      );
      present();
      persistence.writeNow();
    },
    get translationFamily(): TranslationFamily {
      return core.s.translationFamily;
    },
    setTranslationFamily(family: TranslationFamily): void {
      if (core.s.translationFamily === family) return;
      core.s.translationFamily = family;
      present();
    },

    get mode(): ReaderMode {
      return core.s.mode;
    },
    get isVerseMode(): boolean {
      return core.s.mode === "verse";
    },
    get isReadingMode(): boolean {
      return core.s.mode === "reading";
    },
    setMode(mode: ReaderMode): void {
      if (core.s.mode === mode) return;
      core.s.mode = mode;
      present();
      persistence.writeNow();
    },
  };
}

const SOURCE_STORAGE_KEY = "easyquran.reader.source";
const SOURCE_SCHEMA_VERSION = 1;

interface PersistedSource {
  v: number;
  sourceId: string | null;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the untyped localStorage JSON boundary (readJSON → JSON.parse); this function is the parser (isFutureSchema/asObject/asString validate fields)
function decodeSource(raw: unknown): PersistedSource {
  const fallback: PersistedSource = { v: SOURCE_SCHEMA_VERSION, sourceId: null };
  if (isFutureSchema(raw, SOURCE_SCHEMA_VERSION)) return fallback;
  const stored = asObject(raw);
  if (!stored) return fallback;
  const id = asString(stored.sourceId);
  return { v: SOURCE_SCHEMA_VERSION, sourceId: id ?? null };
}

class ReaderSourceStore {
  #sourceId = $state<string | null>(null);
  #teardown: (() => void) | null = null;

  constructor() {
    if (!browser) return;
    this.#sourceId = decodeSource(readJSON(SOURCE_STORAGE_KEY)).sourceId;
    this.#teardown = onStorageKey(SOURCE_STORAGE_KEY, () => {
      const next = decodeSource(readJSON(SOURCE_STORAGE_KEY)).sourceId;
      if (next !== this.#sourceId) this.#sourceId = next;
    });
  }

  dispose(): void {
    this.#teardown?.();
    this.#teardown = null;
  }

  get sourceId(): string | null {
    return this.#sourceId;
  }

  setSourceId(id: string | null): void {
    if (this.#sourceId === id) return;
    this.#sourceId = id;
    if (browser) writeJSON(SOURCE_STORAGE_KEY, { v: SOURCE_SCHEMA_VERSION, sourceId: id });
  }
}

export const readerSource = new ReaderSourceStore();
