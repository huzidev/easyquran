import { MAX_QUERY_LEN, MIN_QUERY_LEN, scalarLength } from "./normalize.ts";

const MARK = /\p{M}/u;
const WHITESPACE = /\s/u;
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;

const ASCII_FOLD: ReadonlyMap<string, string> = new Map([
  ["‘", "'"],
  ["’", "'"],
  ["‚", "'"],
  ["‛", "'"],
  ["“", "\""],
  ["”", "\""],
  ["„", "\""],
  ["‟", "\""],
  ["‐", "-"],
  ["‑", "-"],
  ["‒", "-"],
  ["–", "-"],
  ["—", "-"],
  ["―", "-"],
  ["−", "-"],
  ["ς", "σ"],
]);

export const MAX_LATIN_UNIT_OFFSET = 0xffff;

export interface NormalizedLatinMap {
  normalized: string;
  starts: Uint16Array;
  ends: Uint16Array;
}

export function normalizeLatinWithMap(input: string): NormalizedLatinMap {
  const values: { value: string; start: number; end: number }[] = [];
  let utf16 = 0;
  for (const scalar of input) {
    const start = utf16;
    utf16 += scalar.length;
    for (const lowered of scalar.toLowerCase()) {
      for (const decomposed of lowered.normalize("NFD")) {
        if (MARK.test(decomposed)) {
          const previous = values.at(-1);
          if (previous) previous.end = utf16;
          continue;
        }

        let value = ASCII_FOLD.get(decomposed) ?? decomposed;
        if (WHITESPACE.test(value)) {
          if (values.length === 0) continue;
          if (values.at(-1)?.value === " ") {
            values.at(-1)!.end = utf16;
            continue;
          }
          value = " ";
        }
        values.push({ value, start, end: utf16 });
      }
    }
  }
  if (values.at(-1)?.value === " ") values.pop();

  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (const value of values) {
    if (value.end > MAX_LATIN_UNIT_OFFSET) {
      throw new Error(
        `[normalize-latin] unit exceeds the ${MAX_LATIN_UNIT_OFFSET} utf-16 offset map capacity`,
      );
    }
    parts.push(value.value);
    for (let i = 0; i < value.value.length; i++) {
      starts.push(value.start);
      ends.push(value.end);
    }
  }
  return {
    normalized: parts.join(""),
    starts: Uint16Array.from(starts),
    ends: Uint16Array.from(ends),
  };
}

export function normalizeLatin(input: string): string {
  return normalizeLatinWithMap(input).normalized;
}

export function isEligibleLatinQuery(norm: string): boolean {
  const len = scalarLength(norm);
  return len >= MIN_QUERY_LEN && len <= MAX_QUERY_LEN;
}

export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}
