import type { CatalogEntry } from "$lib/data/quran-types";

export interface TranslitKey {
  key: string;
  kind: "field" | "alias";
}

export const ARTICLE_TOKENS: readonly string[] = [
  "al",
  "aal",
  "el",
  "an",
  "ar",
  "as",
  "at",
  "az",
  "ad",
  "adh",
  "ash",
  "ath",
];

const ARTICLE_TOKEN_SET = new Set(ARTICLE_TOKENS);
const SEPARATOR_RUN = /[\s'’`._-]+/g;
const NON_LETTERS = /[^a-z]/g;
const VOWEL_FOLDS: readonly (readonly [string, string])[] = [
  ["aa", "a"],
  ["ee", "i"],
  ["ii", "i"],
  ["oo", "u"],
  ["ou", "u"],
  ["uu", "u"],
];
const MAX_VOWEL_PASSES = 3;
const BARE_ARTICLE_PREFIXES: readonly (readonly [prefix: string, width: number])[] = [
  ["aal", 3],
  ["al", 2],
];
const MIN_BARE_ARTICLE_REMAINDER = 3;

function stripBareArticle(joined: string): string {
  for (const [prefix, width] of BARE_ARTICLE_PREFIXES) {
    if (joined.startsWith(prefix) && joined.length - width >= MIN_BARE_ARTICLE_REMAINDER) {
      return joined.slice(width);
    }
  }
  return joined;
}

function collapseVowels(joined: string): string {
  let folded = joined;
  for (let pass = 0; pass < MAX_VOWEL_PASSES; pass += 1) {
    let next = folded;
    for (const [from, to] of VOWEL_FOLDS) next = next.replaceAll(from, to);
    if (next === folded) break;
    folded = next;
  }
  return folded;
}

export function translitKey(raw: string): string {
  const lowered = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
  const tokens = lowered
    .replace(SEPARATOR_RUN, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0);
  const kept =
    tokens.length > 1 && ARTICLE_TOKEN_SET.has(tokens[0]!) ? tokens.slice(1) : tokens;
  let key = kept.join("");
  key = stripBareArticle(key);
  key = collapseVowels(key);
  key = key.replaceAll("q", "k");
  if (key.endsWith("ah")) key = `${key.slice(0, -2)}a`;
  return key.replace(NON_LETTERS, "");
}

export function osaDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const bLength = b.length;
  let previousPrevious = Array.from({ length: bLength + 1 }, () => Infinity);
  let previous = Array.from({ length: bLength + 1 }, () => Infinity);
  for (let j = 0; j <= Math.min(bLength, max); j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    const current = Array.from({ length: bLength + 1 }, () => Infinity);
    if (i <= max) current[0] = i;
    const low = Math.max(1, i - max);
    const high = Math.min(bLength, i + max);
    let rowMinimum = current[0]!;
    for (let j = low; j <= high; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = previous[j]! + 1;
      const insertion = current[j - 1]! + 1;
      let cell = Math.min(substitution, deletion, insertion);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        const transposition = previousPrevious[j - 2]! + 1;
        if (transposition < cell) cell = transposition;
      }
      current[j] = cell;
      if (cell < rowMinimum) rowMinimum = cell;
    }
    if (rowMinimum > max) return max + 1;
    previousPrevious = previous;
    previous = current;
  }
  const distance = previous[bLength]!;
  return distance > max ? max + 1 : distance;
}

const MAX_FOLD_EDITS = 2;
const MAX_TWO_EDIT_LENGTH_DELTA = 1;

export function maxEditsFor(len: number): number {
  if (len < 3) return 0;
  if (len <= 5) return 1;
  return MAX_FOLD_EDITS;
}

const ALIAS_EXACT_SCORE = 0.75;
const FIELD_EXACT_SCORE = 0.7;
const DISTANCE_ONE_SCORE = 0.5;
const DISTANCE_TWO_SCORE = 0.4;
const MIN_KEY_LENGTH = 3;

function needleScore(needle: string, entry: TranslitKey): number {
  if (entry.key === needle) {
    return entry.kind === "alias" ? ALIAS_EXACT_SCORE : FIELD_EXACT_SCORE;
  }
  const max = maxEditsFor(Math.max(needle.length, entry.key.length));
  if (max === 0) return 0;
  if (
    max === MAX_FOLD_EDITS &&
    Math.abs(needle.length - entry.key.length) > MAX_TWO_EDIT_LENGTH_DELTA
  ) {
    return 0;
  }
  const distance = osaDistance(needle, entry.key, max);
  if (distance > max) return 0;
  return distance === 1 ? DISTANCE_ONE_SCORE : DISTANCE_TWO_SCORE;
}

export function makeTranslitScorer(
  rawQuery: string,
): ((keys: readonly TranslitKey[]) => number) | null {
  const queryKey = translitKey(rawQuery);
  if (queryKey.length < MIN_KEY_LENGTH) return null;
  const needles = new Set([queryKey]);
  for (const word of rawQuery.split(/\s+/)) {
    const wordKey = translitKey(word);
    if (wordKey.length >= MIN_KEY_LENGTH) needles.add(wordKey);
  }
  return (keys) => {
    let best = 0;
    for (const entry of keys) {
      for (const needle of needles) {
        const score = needleScore(needle, entry);
        if (score > best) best = score;
      }
    }
    return best;
  };
}

let keysForCatalogue: readonly (readonly TranslitKey[])[] | undefined;
let keysCatalogue: readonly CatalogEntry[] | undefined;

export function surahTranslitKeys(
  surahs: readonly CatalogEntry[],
): readonly (readonly TranslitKey[])[] {
  if (keysCatalogue === surahs && keysForCatalogue) return keysForCatalogue;
  const table = Object.freeze(
    surahs.map((surah) => {
      const keys: TranslitKey[] = [];
      for (const field of [surah.name, surah.transliteration, surah.slug]) {
        const key = translitKey(field);
        if (!keys.some((existing) => existing.key === key)) {
          keys.push(Object.freeze({ key, kind: "field" }));
        }
      }
      return Object.freeze(keys);
    }),
  );
  keysCatalogue = surahs;
  keysForCatalogue = table;
  return table;
}
