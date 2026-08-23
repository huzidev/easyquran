import type { PaletteGroup } from "./types";

/**
 * Group order for the built-in domains. Orders are spaced so future domains —
 * hadith, tafsir, duas, lessons — can register between them without renumbering
 * anything: 50–89 is deliberately left free.
 */
export const PaletteGroups = {
  JumpTo: { id: "jump-to", label: "Jump to", order: 10 },
  QuranText: { id: "quran-text", label: "Quran text", order: 20 },
  Surahs: { id: "surahs", label: "Surahs", order: 30 },
  Ranges: { id: "ranges", label: "Juz & pages", order: 40 },
  Settings: { id: "settings", label: "Settings", order: 55 },
  Site: { id: "site", label: "Pages", order: 90 },
  Actions: { id: "actions", label: "Actions", order: 100 },
} as const satisfies Record<string, PaletteGroup>;
