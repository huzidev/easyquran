import type { VerseKey } from "$lib/data/quran";
import type { ArabicFontId, TranslationFamily } from "$lib/config/reader-fonts";
import { SvelteMap } from "svelte/reactivity";

export const BrowseMode = {
  Surah: "surah",
  Ayah: "ayah",
  Juz: "juz",
  Page: "page",
} as const;
export type BrowseMode = (typeof BrowseMode)[keyof typeof BrowseMode];
export type ReaderMode = "verse" | "reading";

export interface LastReadAnchor {
  verseKey: string;
  localPage: number;
  ratio: number;
}
export interface RecentsEntry {
  num: number;
  n: number;
  sourceId?: string;
  ts: number;
}
export interface SurahProgress {
  furthestAyah: number;
  ts: number;
}

export interface Persisted {
  v: number;
  current: number;
  fontSize: number;
  arabicFont: ArabicFontId;
  translationSize: number;
  mode: ReaderMode;
  bookmarks: Record<VerseKey, boolean>;
  notes: Record<VerseKey, string>;
  lastRead: { num: number; n: number; sourceId?: string } | null;
  lastReadAnchor: LastReadAnchor | null;
  recents: RecentsEntry[];
  progress: Record<number, SurahProgress>;
}

export interface ReaderState extends Persisted {
  translationFamily: TranslationFamily;
  query: string;
  browse: BrowseMode;
  openNote: VerseKey | null;
  pendingAnchor: LastReadAnchor | null;
}

export const READER_SCHEMA_VERSION = 3;

export const ARABIC_FONT_MIN = 22;
export const ARABIC_FONT_MAX = 56;
export const ARABIC_FONT_STEP = 3;

export const TRANSLATION_FONT_MIN = 13;
export const TRANSLATION_FONT_MAX = 28;
export const TRANSLATION_FONT_STEP = 1;

export const NOTE_PERSIST_DEBOUNCE_MS = 400;

const READER_MODES: readonly ReaderMode[] = ["verse", "reading"];

export const READER_DEFAULTS: ReaderState = {
  v: READER_SCHEMA_VERSION,
  current: 1,
  fontSize: 33,
  arabicFont: "amiri",
  translationSize: 17,
  translationFamily: "sans",
  mode: "verse",
  bookmarks: {},
  notes: {},
  lastRead: null,
  lastReadAnchor: null,
  recents: [],
  progress: {},
  pendingAnchor: null,
  query: "",
  browse: BrowseMode.Surah,
  openNote: null,
};

export interface NavToken {
  readonly token: number;
  bump(): void;
}

export interface ReaderCore {
  readonly s: ReaderState;
  readonly verseTextBySurah: Map<number, Map<number, string>>;
  readonly verseVersionBySurah: SvelteMap<number, number>;
  readonly nav: NavToken;
}

export function createReaderCore(): ReaderCore {
  const s = $state<ReaderState>({ ...READER_DEFAULTS });
  const verseTextBySurah = new Map<number, Map<number, string>>();
  const verseVersionBySurah = new SvelteMap<number, number>();
  let navToken = 0;
  const nav: NavToken = {
    get token() {
      return navToken;
    },
    bump() {
      navToken += 1;
    },
  };
  return { s, verseTextBySurah, verseVersionBySurah, nav };
}

export const SURAH_COUNT = 114;
export const READER_MODE_VALUES: readonly ReaderMode[] = READER_MODES;
