import type { VerseKey } from "$lib/data/quran";
import type { ArabicFontId, TranslationFamily } from "$lib/config/reader-fonts";

import { createAnnotations } from "./annotations.svelte";
import {
  type BrowseMode,
  type LastReadAnchor,
  type ReaderMode,
  type RecentsEntry,
  createReaderCore,
} from "./reader-core.svelte";
import { createReaderPersistence } from "./reader-persistence.svelte";
import { createReaderSession } from "./reader-session.svelte";
import { createReaderSettings } from "./reader-settings.svelte";
import { createReaderShare } from "./reader-share.svelte";
import { createVerseCache } from "./verse-cache.svelte";

export { BrowseMode } from "./reader-core.svelte";
export type { ReaderMode } from "./reader-core.svelte";

export interface ReaderApi {
  hydrate(modeOverride?: ReaderMode): void;
  dispose(): void;
  readonly query: string;
  readonly hasQuery: boolean;
  setQuery(v: string): void;
  clearQuery(): void;
  readonly browseMode: BrowseMode;
  readonly browseSurah: boolean;
  readonly browseAyah: boolean;
  readonly browseJuz: boolean;
  readonly browsePage: boolean;
  setBrowse(browse: BrowseMode): void;
  readonly openNote: VerseKey | null;
  toggleNote(key: VerseKey): void;
  setCurrent(num: number): void;
  openVerse(num: number, n: number, sourceId?: string): void;
  markRead(num: number, n: number, sourceId?: string): void;
  clearReadingPosition(): void;
  readonly arabicSizePx: string;
  bigger(): void;
  smaller(): void;
  readonly arabicFont: ArabicFontId;
  setArabicFont(id: ArabicFontId): void;
  readonly translationSizePx: string;
  growTranslation(): void;
  shrinkTranslation(): void;
  readonly translationFamily: TranslationFamily;
  setTranslationFamily(family: TranslationFamily): void;
  readonly mode: ReaderMode;
  readonly isVerseMode: boolean;
  readonly isReadingMode: boolean;
  setMode(mode: ReaderMode): void;
  isBookmarked(key: VerseKey): boolean;
  toggleBookmark(key: VerseKey): void;
  getNote(key: VerseKey): string;
  setNote(key: VerseKey, v: string): void;
  readonly lastRead: { num: number; n: number; sourceId?: string } | null;
  readonly hasLastRead: boolean;
  readonly lastReadRef: string;
  readonly lastReadAnchor: LastReadAnchor | null;
  setLastReadAnchor(anchor: LastReadAnchor | null): void;
  readonly pendingAnchor: LastReadAnchor | null;
  setPendingAnchor(anchor: LastReadAnchor | null): void;
  consumePendingAnchor(): LastReadAnchor | null;
  readonly recentReads: readonly RecentsEntry[];
  progressFor(num: number): number | null;
  versesFor(num: number): string[];
  seedAyahs(ayahs: readonly { key: VerseKey; text: string }[]): void;
  refreshFromWorker(num: number): Promise<void>;
  copyVerse(key: VerseKey, text: string): Promise<boolean>;
  shareVerse(key: VerseKey, text: string): Promise<"shared" | "copied" | "failed">;
}

export function createReader(): ReaderApi {
  const core = createReaderCore();
  const persistence = createReaderPersistence(core);
  const session = createReaderSession(core, persistence);
  const settings = createReaderSettings(core, persistence);
  const annotations = createAnnotations(core, persistence);
  const verseCache = createVerseCache(core);
  const share = createReaderShare();

  return {
    hydrate: (modeOverride?: ReaderMode) => persistence.hydrate(modeOverride),
    dispose: () => persistence.dispose(),

    get query() {
      return session.query;
    },
    get hasQuery() {
      return session.hasQuery;
    },
    setQuery: (v: string) => session.setQuery(v),
    clearQuery: () => session.clearQuery(),

    get browseMode() {
      return session.browseMode;
    },
    get browseSurah() {
      return session.browseSurah;
    },
    get browseAyah() {
      return session.browseAyah;
    },
    get browseJuz() {
      return session.browseJuz;
    },
    get browsePage() {
      return session.browsePage;
    },
    setBrowse: (browse: BrowseMode) => session.setBrowse(browse),

    get openNote() {
      return session.openNote;
    },
    toggleNote: (key: VerseKey) => session.toggleNote(key),

    setCurrent: (num: number) => session.setCurrent(num),
    openVerse: (num: number, n: number, sourceId?: string) => session.openVerse(num, n, sourceId),
    markRead: (num: number, n: number, sourceId?: string) => session.markRead(num, n, sourceId),
    clearReadingPosition: () => session.clearReadingPosition(),

    get arabicSizePx() {
      return settings.arabicSizePx;
    },
    bigger: () => settings.bigger(),
    smaller: () => settings.smaller(),
    get arabicFont() {
      return settings.arabicFont;
    },
    setArabicFont: (id: ArabicFontId) => settings.setArabicFont(id),
    get translationSizePx() {
      return settings.translationSizePx;
    },
    growTranslation: () => settings.growTranslation(),
    shrinkTranslation: () => settings.shrinkTranslation(),
    get translationFamily() {
      return settings.translationFamily;
    },
    setTranslationFamily: (family: TranslationFamily) => settings.setTranslationFamily(family),
    get mode() {
      return settings.mode;
    },
    get isVerseMode() {
      return settings.isVerseMode;
    },
    get isReadingMode() {
      return settings.isReadingMode;
    },
    setMode: (mode: ReaderMode) => settings.setMode(mode),

    isBookmarked: (key: VerseKey) => annotations.isBookmarked(key),
    toggleBookmark: (key: VerseKey) => annotations.toggleBookmark(key),
    getNote: (key: VerseKey) => annotations.getNote(key),
    setNote: (key: VerseKey, v: string) => annotations.setNote(key, v),
    get lastRead() {
      return annotations.lastRead;
    },
    get hasLastRead() {
      return annotations.hasLastRead;
    },
    get lastReadRef() {
      return annotations.lastReadRef;
    },
    get lastReadAnchor() {
      return annotations.lastReadAnchor;
    },
    setLastReadAnchor: (anchor: LastReadAnchor | null) => session.setLastReadAnchor(anchor),
    get pendingAnchor() {
      return session.pendingAnchor;
    },
    setPendingAnchor: (anchor: LastReadAnchor | null) => session.setPendingAnchor(anchor),
    consumePendingAnchor: () => session.consumePendingAnchor(),
    get recentReads() {
      return annotations.recentReads;
    },
    progressFor: (num: number) => annotations.progressFor(num),

    versesFor: (num: number) => verseCache.versesFor(num),
    seedAyahs: (ayahs) => verseCache.seedAyahs(ayahs),
    refreshFromWorker: (num: number) => verseCache.refreshFromWorker(num),

    copyVerse: (key: VerseKey, text: string) => share.copyVerse(key, text),
    shareVerse: (key: VerseKey, text: string) => share.shareVerse(key, text),
  };
}

export const reader: ReaderApi = createReader();
