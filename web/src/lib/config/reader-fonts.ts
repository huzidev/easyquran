export type ArabicFontId = "amiri" | "scheherazade-new" | "noto-naskh-arabic";
export type TranslationFamily = "sans" | "serif";

export interface ArabicFontDef {
  readonly id: ArabicFontId;
  readonly family: string;
  readonly stack: string;
  readonly file?: () => Promise<string>;
}

export interface TranslationFamilyDef {
  readonly id: TranslationFamily;
  readonly stack: string;
}

export const ARABIC_FONT_IDS: readonly ArabicFontId[] = [
  "amiri",
  "scheherazade-new",
  "noto-naskh-arabic",
];

export const DEFAULT_ARABIC_FONT: ArabicFontId = "amiri";
export const DEFAULT_TRANSLATION_FAMILY: TranslationFamily = "sans";

const ARABIC_FALLBACKS = `"Traditional Arabic", "Geeza Pro", serif`;

export const ARABIC_FONTS: readonly ArabicFontDef[] = [
  {
    id: "amiri",
    family: "Amiri",
    stack: `"Amiri", "Scheherazade New", ${ARABIC_FALLBACKS}`,
  },
  {
    id: "scheherazade-new",
    family: "Scheherazade New",
    stack: `"Scheherazade New", "Amiri", ${ARABIC_FALLBACKS}`,
    file: () =>
      import("@fontsource/scheherazade-new/files/scheherazade-new-arabic-400-normal.woff2?url").then(
        (m) => m.default,
      ),
  },
  {
    id: "noto-naskh-arabic",
    family: "Noto Naskh Arabic",
    stack: `"Noto Naskh Arabic", "Amiri", ${ARABIC_FALLBACKS}`,
    file: () =>
      import("@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-400-normal.woff2?url").then(
        (m) => m.default,
      ),
  },
];

export const TRANSLATION_FAMILIES: readonly TranslationFamilyDef[] = [
  { id: "sans", stack: "var(--font-sans)" },
  { id: "serif", stack: `ui-serif, Georgia, "Times New Roman", serif` },
];

export function arabicFontDef(id: ArabicFontId): ArabicFontDef {
  const def = ARABIC_FONTS.find((f) => f.id === id);
  return def ?? ARABIC_FONTS[0]!;
}

export function arabicFontStack(id: ArabicFontId): string {
  return arabicFontDef(id).stack;
}

export function translationFamilyStack(id: TranslationFamily): string {
  const def = TRANSLATION_FAMILIES.find((f) => f.id === id);
  return def?.stack ?? "var(--font-sans)";
}
