import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$app/environment", () => ({
  browser: false,
  dev: false,
}));
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const presentation = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("$lib/stores/reader-presentation", () => ({
  applyReaderPresentation: presentation.apply,
}));

import { DEFAULTS } from "$lib/config/site";
import type { ArabicFontId, TranslationFamily } from "$lib/config/reader-fonts";
import { createConsent } from "$lib/stores/consent.svelte";
import type { Prefs } from "$lib/stores/prefs.svelte";
import {
  ARABIC_FONT_MAX,
  ARABIC_FONT_MIN,
  ARABIC_FONT_STEP,
  TRANSLATION_FONT_MAX,
  TRANSLATION_FONT_MIN,
  TRANSLATION_FONT_STEP,
  type ReaderMode,
} from "$lib/stores/reader-core.svelte";
import { createReader } from "$lib/stores/reader.svelte";
import {
  applySettingsDoc,
  decodeSettingsDoc,
  SETTINGS_DOC_VERSION,
  toSettingsDoc,
  type SettingsPrefsPort,
  type SettingsReaderPort,
} from "../settings-document";

function fakePrefs(initial: Prefs): SettingsPrefsPort & { applied: () => number } {
  let current: Prefs = { ...initial, custom: { ...initial.custom } };
  let applied = 0;
  return {
    get current() {
      return current;
    },
    set(patch: Partial<Prefs>) {
      current = { ...current, ...patch, custom: { ...current.custom, ...patch.custom } };
    },
    apply() {
      applied += 1;
    },
    applied: () => applied,
  };
}

interface FakeReader extends SettingsReaderPort {
  calls: () => readonly string[];
}

function fakeReader(): FakeReader {
  const calls: string[] = [];
  let mode: ReaderMode = "verse";
  let arabicFont: ArabicFontId = "amiri";
  let family: TranslationFamily = "sans";
  let fontSize = 33;
  let translationSize = 17;
  return {
    calls: () => calls,
    get mode() {
      return mode;
    },
    get arabicFont() {
      return arabicFont;
    },
    get translationFamily() {
      return family;
    },
    get arabicSizePx() {
      return `${fontSize}px`;
    },
    get translationSizePx() {
      return `${translationSize}px`;
    },
    setMode(next) {
      mode = next;
    },
    setArabicFont(next) {
      arabicFont = next;
    },
    bigger() {
      calls.push("bigger");
      fontSize = Math.min(ARABIC_FONT_MAX, fontSize + ARABIC_FONT_STEP);
    },
    smaller() {
      calls.push("smaller");
      fontSize = Math.max(ARABIC_FONT_MIN, fontSize - ARABIC_FONT_STEP);
    },
    growTranslation() {
      calls.push("grow");
      translationSize = Math.min(TRANSLATION_FONT_MAX, translationSize + TRANSLATION_FONT_STEP);
    },
    shrinkTranslation() {
      calls.push("shrink");
      translationSize = Math.max(TRANSLATION_FONT_MIN, translationSize - TRANSLATION_FONT_STEP);
    },
  };
}

describe("decodeSettingsDoc", () => {
  it("returns null for non-object input", () => {
    expect(decodeSettingsDoc(null)).toBeNull();
    expect(decodeSettingsDoc("nope")).toBeNull();
    expect(decodeSettingsDoc(undefined)).toBeNull();
    expect(decodeSettingsDoc(7)).toBeNull();
  });

  it("preserves a fully valid doc", () => {
    const doc = {
      v: 1,
      appearance: {
        theme: "light",
        surface: "slate",
        accent: "azure",
        custom: { bg: "#101014", accent: "#2f7f5f" },
        instantResume: true,
      },
      reading: {
        fontSize: 36,
        mode: "reading",
        arabicFont: "scheherazade-new",
        translationSize: 15,
      },
      privacy: { analytics: false, performance: true, advertising: true },
    };
    expect(decodeSettingsDoc(doc)).toEqual(doc);
  });

  it("defaults every missing or invalid field", () => {
    expect(decodeSettingsDoc({})).toEqual({
      v: SETTINGS_DOC_VERSION,
      appearance: { ...DEFAULTS, instantResume: false, custom: {} },
      reading: { fontSize: 33, mode: "verse", arabicFont: "amiri", translationSize: 17 },
      privacy: { analytics: true, performance: true, advertising: false },
    });
    const out = decodeSettingsDoc({
      v: 1,
      appearance: { theme: "blue", surface: "wood", accent: 4, custom: { bg: "red" }, instantResume: 1 },
      reading: { fontSize: 999, mode: "scrolled", arabicFont: "times", translationSize: 2 },
      privacy: { analytics: "yes", performance: null, advertising: "no" },
    });
    expect(out?.appearance).toEqual({ ...DEFAULTS, instantResume: false, custom: {} });
    expect(out?.reading).toEqual({
      fontSize: 33,
      mode: "verse",
      arabicFont: "amiri",
      translationSize: 17,
    });
    expect(out?.privacy).toEqual({ analytics: true, performance: true, advertising: false });
  });

  it("keeps unknown top-level fields alive in reserved", () => {
    const out = decodeSettingsDoc({ v: 1, futureSection: { a: 1 }, decorations: ["x"] });
    expect(out?.reserved).toEqual({ futureSection: { a: 1 }, decorations: ["x"] });
    const clean = decodeSettingsDoc({ v: 1, reading: { fontSize: 30 } });
    expect(clean?.reserved).toBeUndefined();
  });

  it("decodes a future-version doc tolerantly, keeping its version", () => {
    const out = decodeSettingsDoc({ v: 99, reading: { fontSize: 42, mode: "reading" } });
    expect(out?.v).toBe(99);
    expect(out?.reading.fontSize).toBe(42);
    expect(out?.reading.mode).toBe("reading");
  });
});

describe("toSettingsDoc / applySettingsDoc", () => {
  it("round-trips a live snapshot onto fresh stores", () => {
    const sourcePrefs = fakePrefs({
      theme: "light",
      surface: "slate",
      accent: "azure",
      custom: { accent: "#112233" },
      instantResume: true,
    });
    const sourceConsent = createConsent();
    sourceConsent.set({ analytics: false, advertising: true });
    const sourceReader = createReader();
    sourceReader.bigger();
    sourceReader.setMode("reading");
    sourceReader.setArabicFont("scheherazade-new");
    sourceReader.shrinkTranslation();
    sourceReader.shrinkTranslation();

    const doc = toSettingsDoc({
      prefs: sourcePrefs,
      consent: sourceConsent,
      reader: sourceReader,
    });
    expect(doc).toEqual({
      v: SETTINGS_DOC_VERSION,
      appearance: {
        theme: "light",
        surface: "slate",
        accent: "azure",
        custom: { accent: "#112233" },
        instantResume: true,
      },
      reading: { fontSize: 36, mode: "reading", arabicFont: "scheherazade-new", translationSize: 15 },
      privacy: { analytics: false, performance: true, advertising: true },
    });

    const targetPrefs = fakePrefs({ ...DEFAULTS, instantResume: false, custom: {} });
    const targetConsent = createConsent();
    const targetReader = createReader();
    applySettingsDoc(doc, {
      prefs: targetPrefs,
      consent: targetConsent,
      reader: targetReader,
    });
    expect(targetPrefs.applied()).toBe(1);
    expect(
      toSettingsDoc({ prefs: targetPrefs, consent: targetConsent, reader: targetReader }),
    ).toEqual(doc);
  });

  it("fans reading fields out through the reader setters", () => {
    const store = fakeReader();
    applySettingsDoc(
      {
        v: SETTINGS_DOC_VERSION,
        appearance: { ...DEFAULTS, instantResume: false, custom: {} },
        reading: { fontSize: 36, mode: "reading", arabicFont: "noto-naskh-arabic", translationSize: 19 },
        privacy: { analytics: true, performance: true, advertising: false },
      },
      { prefs: fakePrefs({ ...DEFAULTS, instantResume: false, custom: {} }), consent: createConsent(), reader: store },
    );
    expect(store.mode).toBe("reading");
    expect(store.arabicFont).toBe("noto-naskh-arabic");
    expect(store.arabicSizePx).toBe("36px");
    expect(store.translationSizePx).toBe("19px");
    expect(store.calls()).toEqual(["bigger", "grow", "grow"]);
  });

  it("applies reader presentation from the settled reader state after fanning out", () => {
    presentation.apply.mockClear();
    const store = fakeReader();
    applySettingsDoc(
      {
        v: SETTINGS_DOC_VERSION,
        appearance: { ...DEFAULTS, instantResume: false, custom: {} },
        reading: { fontSize: 36, mode: "reading", arabicFont: "noto-naskh-arabic", translationSize: 19 },
        privacy: { analytics: true, performance: true, advertising: false },
      },
      { prefs: fakePrefs({ ...DEFAULTS, instantResume: false, custom: {} }), consent: createConsent(), reader: store },
    );
    expect(presentation.apply).toHaveBeenCalledTimes(1);
    expect(presentation.apply).toHaveBeenCalledWith("reading", 36, "noto-naskh-arabic", 19, "sans");
  });

  it("terminates bounded when a stepped font size cannot land exactly on target", () => {
    const store = fakeReader();
    applySettingsDoc(
      {
        v: SETTINGS_DOC_VERSION,
        appearance: { ...DEFAULTS, instantResume: false, custom: {} },
        reading: { fontSize: 23, mode: "verse", arabicFont: "amiri", translationSize: 17 },
        privacy: { analytics: true, performance: true, advertising: false },
      },
      { prefs: fakePrefs({ ...DEFAULTS, instantResume: false, custom: {} }), consent: createConsent(), reader: store },
    );
    const landed = Number.parseFloat(store.arabicSizePx);
    expect(landed).toBeGreaterThanOrEqual(ARABIC_FONT_MIN);
    expect(landed).toBeLessThanOrEqual(ARABIC_FONT_MAX);
    expect(Math.abs(landed - 23)).toBeLessThanOrEqual(ARABIC_FONT_STEP - 1);
  });

  it("prefers exact numeric size setters and never steps when they exist", () => {
    const store = fakeReader();
    const exact: string[] = [];
    store.setFontSize = (px: number) => {
      exact.push(`fontSize:${px}`);
    };
    store.setTranslationSize = (px: number) => {
      exact.push(`translationSize:${px}`);
    };
    applySettingsDoc(
      {
        v: SETTINGS_DOC_VERSION,
        appearance: { ...DEFAULTS, instantResume: false, custom: {} },
        reading: { fontSize: 25, mode: "verse", arabicFont: "amiri", translationSize: 22 },
        privacy: { analytics: true, performance: true, advertising: false },
      },
      { prefs: fakePrefs({ ...DEFAULTS, instantResume: false, custom: {} }), consent: createConsent(), reader: store },
    );
    expect(exact).toEqual(["fontSize:25", "translationSize:22"]);
    expect(store.calls()).toEqual([]);
  });
});
