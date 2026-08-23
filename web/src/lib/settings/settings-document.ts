import {
  ARABIC_FONT_IDS,
  DEFAULT_ARABIC_FONT,
  type ArabicFontId,
  type TranslationFamily,
} from "$lib/config/reader-fonts";
import { ACCENTS, DEFAULTS, SURFACES, type ThemeMode } from "$lib/config/site";
import { asLiteral, asNumber, asObject, asString } from "$lib/storage";
import type { CustomSeeds } from "$lib/theme/derive";
import { consent, decodeConsent, type ConsentFlags } from "$lib/stores/consent.svelte";
import { prefs, type Prefs } from "$lib/stores/prefs.svelte";
import {
  ARABIC_FONT_MAX,
  ARABIC_FONT_MIN,
  READER_DEFAULTS,
  READER_MODE_VALUES,
  TRANSLATION_FONT_MAX,
  TRANSLATION_FONT_MIN,
  type ReaderMode,
} from "$lib/stores/reader-core.svelte";
import { applyReaderPresentation } from "$lib/stores/reader-presentation";
import { reader } from "$lib/stores/reader.svelte";

export const SETTINGS_DOC_VERSION = 1;

export interface SettingsReadingDoc {
  fontSize: number;
  mode: ReaderMode;
  arabicFont: ArabicFontId;
  translationSize: number;
}

export interface SettingsDoc {
  v: number;
  appearance: Prefs;
  reading: SettingsReadingDoc;
  privacy: ConsentFlags;
  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- reserved is the forward-compat keyspace: opaque passthrough values by design (unknown fields must survive decode untouched for future doc versions)
  reserved?: Readonly<Record<string, unknown>>;
}

export interface SettingsPrefsPort {
  readonly current: Readonly<Prefs>;
  set(patch: Partial<Prefs>): void;
  apply(): void;
}

export interface SettingsConsentPort {
  readonly current: Readonly<ConsentFlags>;
  set(patch: Partial<ConsentFlags>): void;
}

export interface SettingsReaderPort {
  readonly mode: ReaderMode;
  readonly arabicFont: ArabicFontId;
  readonly translationFamily: TranslationFamily;
  readonly arabicSizePx: string;
  readonly translationSizePx: string;
  setMode(mode: ReaderMode): void;
  setArabicFont(id: ArabicFontId): void;
  bigger(): void;
  smaller(): void;
  growTranslation(): void;
  shrinkTranslation(): void;
  setFontSize?(px: number): void;
  setTranslationSize?(px: number): void;
}

export interface SettingsDocStores {
  readonly prefs: SettingsPrefsPort;
  readonly consent: SettingsConsentPort;
  readonly reader: SettingsReaderPort;
}

const KNOWN_DOC_KEYS = new Set(["v", "appearance", "reading", "privacy"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SEED_KEYS = ["bg", "accent", "pop"] as const;
const STEP_LIMIT = 64;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the untyped persisted JSON boundary; this function is the parser (asObject + per-seed hex validation)
function decodeCustom(raw: unknown): CustomSeeds {
  const out: CustomSeeds = {};
  const stored = asObject(raw);
  if (!stored) return out;
  for (const key of SEED_KEYS) {
    const value = asString(stored[key]);
    if (value !== undefined && HEX_COLOR.test(value)) out[key] = value;
  }
  return out;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the untyped persisted JSON boundary; this function is the parser (asObject + allowlist validation)
function decodeAppearance(raw: unknown): Prefs {
  const fallback: Prefs = { ...DEFAULTS, instantResume: false, custom: {} };
  const stored = asObject(raw);
  if (!stored) return fallback;
  const surface = asString(stored.surface);
  const accent = asString(stored.accent);
  return {
    theme: asLiteral<ThemeMode>(stored.theme, ["dark", "light"]) ?? fallback.theme,
    surface: SURFACES.find((s) => s.id === surface)?.id ?? fallback.surface,
    accent: ACCENTS.find((a) => a.id === accent)?.id ?? fallback.accent,
    custom: decodeCustom(stored.custom),
    instantResume: stored.instantResume === true,
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the untyped persisted JSON boundary; this function is the parser (asObject + bounds/allowlist validation)
function decodeReading(raw: unknown): SettingsReadingDoc {
  const fallback: SettingsReadingDoc = {
    fontSize: READER_DEFAULTS.fontSize,
    mode: READER_DEFAULTS.mode,
    arabicFont: DEFAULT_ARABIC_FONT,
    translationSize: READER_DEFAULTS.translationSize,
  };
  const stored = asObject(raw);
  if (!stored) return fallback;
  return {
    fontSize: asNumber(stored.fontSize, ARABIC_FONT_MIN, ARABIC_FONT_MAX) ?? fallback.fontSize,
    mode: asLiteral<ReaderMode>(stored.mode, READER_MODE_VALUES) ?? fallback.mode,
    arabicFont: asLiteral<ArabicFontId>(stored.arabicFont, ARABIC_FONT_IDS) ?? fallback.arabicFont,
    translationSize:
      asNumber(stored.translationSize, TRANSLATION_FONT_MIN, TRANSLATION_FONT_MAX) ??
      fallback.translationSize,
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the untyped persisted JSON boundary; this function is the parser (asObject + per-section decoders)
export function decodeSettingsDoc(raw: unknown): SettingsDoc | null {
  const stored = asObject(raw);
  if (!stored) return null;
  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- reserved is the forward-compat keyspace: opaque passthrough values by design (unknown fields must survive decode untouched)
  const reserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!KNOWN_DOC_KEYS.has(key)) reserved[key] = value;
  }
  const doc: SettingsDoc = {
    v: asNumber(stored.v, 1, Number.POSITIVE_INFINITY) ?? SETTINGS_DOC_VERSION,
    appearance: decodeAppearance(stored.appearance),
    reading: decodeReading(stored.reading),
    privacy: decodeConsent(stored.privacy),
  };
  if (Object.keys(reserved).length > 0) doc.reserved = reserved;
  return doc;
}

export function toSettingsDoc(stores: SettingsDocStores = { prefs, consent, reader }): SettingsDoc {
  const appearance = stores.prefs.current;
  return {
    v: SETTINGS_DOC_VERSION,
    appearance: { ...appearance, custom: { ...appearance.custom } },
    reading: {
      fontSize: Number.parseFloat(stores.reader.arabicSizePx),
      mode: stores.reader.mode,
      arabicFont: stores.reader.arabicFont,
      translationSize: Number.parseFloat(stores.reader.translationSizePx),
    },
    privacy: { ...stores.consent.current },
  };
}

function stepTo(target: number, current: () => number, up: () => void, down: () => void): void {
  let previous = current();
  for (let i = 0; i < STEP_LIMIT; i += 1) {
    if (previous === target) return;
    const distance = Math.abs(previous - target);
    if (previous < target) up();
    else down();
    const next = current();
    if (next === previous) return;
    if (Math.abs(next - target) >= distance) {
      if (previous < target) down();
      else up();
      return;
    }
    previous = next;
  }
}

function applyFontSize(store: SettingsReaderPort, target: number): void {
  if (store.setFontSize) {
    store.setFontSize(target);
    return;
  }
  stepTo(
    target,
    () => Number.parseFloat(store.arabicSizePx),
    () => store.bigger(),
    () => store.smaller(),
  );
}

function applyTranslationSize(store: SettingsReaderPort, target: number): void {
  if (store.setTranslationSize) {
    store.setTranslationSize(target);
    return;
  }
  stepTo(
    target,
    () => Number.parseFloat(store.translationSizePx),
    () => store.growTranslation(),
    () => store.shrinkTranslation(),
  );
}

export function applySettingsDoc(
  doc: SettingsDoc,
  stores: SettingsDocStores = { prefs, consent, reader },
): void {
  stores.prefs.set({ ...doc.appearance, custom: { ...doc.appearance.custom } });
  stores.consent.set({ ...doc.privacy });
  stores.reader.setMode(doc.reading.mode);
  stores.reader.setArabicFont(doc.reading.arabicFont);
  applyFontSize(stores.reader, doc.reading.fontSize);
  applyTranslationSize(stores.reader, doc.reading.translationSize);
  stores.prefs.apply();
  applyReaderPresentation(
    stores.reader.mode,
    Number.parseFloat(stores.reader.arabicSizePx),
    stores.reader.arabicFont,
    Number.parseFloat(stores.reader.translationSizePx),
    stores.reader.translationFamily,
  );
}
