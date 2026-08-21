export const QuranSourceId = {
  TanzilUthmani: "uthmani",
  TanzilSimpleClean: "simple-clean",
} as const;
export type QuranSourceId = (typeof QuranSourceId)[keyof typeof QuranSourceId];
export const QURAN_SOURCE_IDS = Object.freeze(Object.values(QuranSourceId));

function isOneOf(values: readonly string[], value: string): boolean {
  return values.includes(value);
}
export const isQuranSourceId = (value: string): value is QuranSourceId =>
  isOneOf(QURAN_SOURCE_IDS, value);

export type QuranReaderSource = string;

export const isArabicSourceId = isQuranSourceId;

export const QuranScript = {
  Uthmani: "uthmani",
  SimpleClean: "simple-clean",
  IndoPak: "indopak",
  Tajweed: "tajweed",
  Translation: "translation",
} as const;
export type QuranScript = (typeof QuranScript)[keyof typeof QuranScript];
export const QURAN_SCRIPTS = Object.freeze(Object.values(QuranScript));
export const isQuranScript = (value: string): value is QuranScript => isOneOf(QURAN_SCRIPTS, value);

export const OpenerKind = {
  Verse: "verse",
  Header: "header",
  None: "none",
} as const;
export type OpenerKind = (typeof OpenerKind)[keyof typeof OpenerKind];
export const OPENER_KINDS = Object.freeze(Object.values(OpenerKind));
export const isOpenerKind = (value: string): value is OpenerKind => isOneOf(OPENER_KINDS, value);

export const OpenerPackaging = {
  NumberedAyah: "numbered-ayah",
  EmbeddedPrefix: "embedded-prefix",
  ChapterFlag: "chapter-flag",
  SeparateRow: "separate-row",
  Absent: "absent",
} as const;
export type OpenerPackaging = (typeof OpenerPackaging)[keyof typeof OpenerPackaging];
export const OPENER_PACKAGING_VALUES = Object.freeze(Object.values(OpenerPackaging));
export const isOpenerPackaging = (value: string): value is OpenerPackaging =>
  isOneOf(OPENER_PACKAGING_VALUES, value);

export interface PrefixCut {
  openerEndScalar: number;
  bodyStartScalar: number;
}

export interface SurahNormalization extends PrefixCut {
  surah: number;
  sourceId: QuranReaderSource;
  script: QuranScript;
  sourceProfile: string;
  packaging: OpenerPackaging;
  openerKind: OpenerKind;
  openerText: string | null;
}

export interface QuranSurahText {
  sourceId: QuranReaderSource;
  script: QuranScript;
  verses: string[];
  normalization: SurahNormalization;
}

export type Place = "meccan" | "medinan";

export const Bismillah = {
  FirstAyah: "first-ayah",
  None: "none",
  EmbeddedPrefix: "embedded-prefix",
} as const;
export type Bismillah = (typeof Bismillah)[keyof typeof Bismillah];

export type SajdaKind = "recommended" | "obligatory";

export type VerseKey = string;

export interface CatalogEntry {
  num: number;
  slug: string;
  name: string;
  arabic: string;
  transliteration: string;
  meaning: string;
  place: Place;
  ayahCount: number;
  revelationOrder: number;
  rukus: number;
  openerKind: OpenerKind;
  bismillah: Bismillah;
  startGlobal: number;
}

export interface CanonicalSurahCoordinates {
  readonly surah: number;
  readonly startGlobal: number;
  readonly ayahCount: number;
}

export interface CanonicalQuranCoordinates {
  readonly rowCount: number;
  readonly surahs: readonly CanonicalSurahCoordinates[];
}

export type SurahRenderMetadata = Pick<
  CatalogEntry,
  "num" | "slug" | "name" | "arabic" | "place" | "ayahCount"
>;

export type SurahLink = Pick<CatalogEntry, "num" | "slug" | "name" | "arabic">;

export interface LoadedSurah extends SurahRenderMetadata, QuranSurahText {}

export interface RangeEntry {
  index: number;
  startGlobal: number;
  endGlobal: number;
  first: VerseKey;
  last: VerseKey;
}

export interface SajdaEntry {
  index: number;
  surah: number;
  ayah: number;
  globalIndex: number;
  kind: SajdaKind;
}

export interface DownloadableSpec {
  id: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface ArtifactSpec extends DownloadableSpec {
  id: QuranSourceId;
}

export type TranslationDirection = "rtl" | "ltr";

export interface TranslationCatalogueEntry {
  readonly id: string;
  readonly language: string;
  readonly languageCode: string;
  readonly direction: TranslationDirection;
  readonly name: string;
  readonly translator: string | null;
  readonly sizeBytes: number;
  readonly downloadUrl: string;
}

export const SourceKind = {
  Arabic: "arabic",
  Translation: "translation",
} as const;
export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

export interface DownloadProgress {
  script: QuranReaderSource;
  loaded: number;
  total: number;
}

export interface Ayah {
  key: VerseKey;
  surah: number;
  ayah: number;
  globalIndex: number;
  text: string;
}

export interface StackedTranslation {
  readonly sourceId: string;
  readonly translator: string | null;
  readonly language: string;
  readonly languageCode: string;
  readonly direction: TranslationDirection;
  readonly text: string;
}

export type StackedTranslationsByVerse = ReadonlyMap<VerseKey, readonly StackedTranslation[]>;

export type StackedSourceState = "loading" | "ready" | "error";

export interface StackedTranslationsState {
  readonly byVerse: StackedTranslationsByVerse;
  readonly order: readonly string[];
  readonly status: ReadonlyMap<string, StackedSourceState>;
}

export const STACKED_MAX_EXTRAS = 5;

export interface QuranRangeText {
  ayahs: Ayah[];
  normalizations: SurahNormalization[];
}

export interface SurahLocalPage {
  surah: number;
  localPage: number;
  globalPage: number;
  startGlobal: number;
  endGlobal: number;
  startAyah: number;
  endAyah: number;
  first: VerseKey;
  last: VerseKey;
}

export interface SurahLocalPageData {
  surah: SurahRenderMetadata;
  page: SurahLocalPage;
  pageCount: number;
  ayahs: Ayah[];
  normalization: SurahNormalization;
}

export interface SurahLocalPageLink {
  localPage: number;
  href: `/app/${string}`;
}

export interface SurahRouteData {
  pageData: SurahLocalPageData;
  previousPage: SurahLocalPageLink | null;
  nextPage: SurahLocalPageLink | null;
  previousSurah: SurahLink | null;
  nextSurah: SurahLink | null;
  readingPreviousHref: `/app/${string}` | null;
  readingNextHref: `/app/${string}` | null;
}

export type SurahRouteContext =
  | { readonly kind: "arabic" }
  | { readonly kind: "translation"; readonly lang: string; readonly translator: string };

export interface RangePageData {
  kind: "juz" | "page";
  index: number;
  label: string;
  startGlobal: number;
  endGlobal: number;
  first: VerseKey;
  last: VerseKey;
  ayahs: Ayah[];
  normalizations: SurahNormalization[];
  surahs: SurahLink[];
}
