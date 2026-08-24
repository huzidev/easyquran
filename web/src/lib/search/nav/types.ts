export type NavTarget =
  | { readonly kind: "ayah"; readonly surah: number; readonly ayah: number }
  | { readonly kind: "surah"; readonly surah: number }
  | { readonly kind: "juz"; readonly juz: number }
  | { readonly kind: "page"; readonly page: number }
  | {
      readonly kind: "sajda";
      readonly surah: number;
      readonly ayah: number;
      readonly index: number;
      readonly sajdaKind: "recommended" | "obligatory";
    }
  | { readonly kind: "place"; readonly place: "meccan" | "medinan"; readonly surahCount: number };

export interface NavMatch {
  /** Unique across the list — `ayah:2:255`, `juz:5`, `sajda:7:206`, `place:meccan`. */
  readonly id: string;
  /** Relevance in `[0, 1]`; ties keep insertion order after the stable sort. */
  readonly score: number;
  readonly target: NavTarget;
}
