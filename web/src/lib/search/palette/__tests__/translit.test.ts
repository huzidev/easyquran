import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createQuranData, type QuranData } from "$lib/data/quran-data";
import {
  ARTICLE_TOKENS,
  makeTranslitScorer,
  maxEditsFor,
  osaDistance,
  surahTranslitKeys,
  translitKey,
  type TranslitKey,
} from "$lib/quran/search/translit";

const DATA_PATH = [
  path.resolve(process.cwd(), "static/quran-meta/quran-data.json"),
  path.resolve(process.cwd(), "web/static/quran-meta/quran-data.json"),
].find((candidate) => existsSync(candidate));
if (!DATA_PATH) throw new Error("missing quran-data.json fixture");
const QURAN: QuranData = createQuranData(JSON.parse(readFileSync(DATA_PATH, "utf8")));

const KEY_CASES: readonly (readonly [raw: string, key: string])[] = [
  ["Al-Baqarah", "bakara"],
  ["Al-Baqara", "bakara"],
  ["baqarah", "bakara"],
  ["baqara", "bakara"],
  ["bakarah", "bakara"],
  ["el-baqara", "bakara"],
  ["albaqarah", "bakara"],
  ["Ya-Sin", "yasin"],
  ["Yaseen", "yasin"],
  ["yasin", "yasin"],
  ["yaseen", "yasin"],
  ["ya seen", "yasin"],
  ["Al-Fatihah", "fatiha"],
  ["fatihah", "fatiha"],
  ["fatiha", "fatiha"],
  ["Al-Fath", "fath"],
  ["Ar-Rahman", "rahman"],
  ["Ar-Rahmaan", "rahman"],
  ["rahman", "rahman"],
  ["rahmaan", "rahman"],
  ["Qaf", "kaf"],
  ["Qaaf", "kaf"],
  ["qaf", "kaf"],
  ["kaaf", "kaf"],
  ["Al-Ikhlaas", "ikhlas"],
  ["ikhlas", "ikhlas"],
  ["At-Tin", "tin"],
  ["teen", "tin"],
  ["Al-'Ankabut", "ankabut"],
  ["Al-Ankaboot", "ankabut"],
  ["ankabut", "ankabut"],
  ["Aal-i-Imraan", "imran"],
  ["imran", "imran"],
  ["aal imran", "imran"],
  ["An-Nur", "nur"],
  ["An-Noor", "nur"],
  ["nur", "nur"],
  ["noor", "nur"],
  ["Ad-Duha", "duha"],
  ["duha", "duha"],
  ["Ta-Ha", "taha"],
  ["Taa-Haa", "taha"],
  ["taha", "taha"],
  ["Nooh", "nuh"],
  ["nuh", "nuh"],
  ["Maryam", "maryam"],
  ["fathiha", "fathiha"],
  ["Ad-Dhuhaa", "dhuha"],
  ["dhuha", "dhuha"],
];

const GATE_CASES: readonly (readonly [raw: string, key: string])[] = [
  ["112", ""],
  ["البقرة", ""],
  ["ali", "ali"],
  ["ankabut", "ankabut"],
];

function catalogueTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .replace(/[\s'’`._-]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0);
}

function osaReference(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = 0; i <= a.length; i += 1) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let cell = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        const transposition = rows[i - 2]![j - 2]! + 1;
        if (transposition < cell) cell = transposition;
      }
      rows[i]![j] = cell;
    }
  }
  return rows[a.length]![b.length]!;
}

const DISTANCE_PAIRS: readonly (readonly [string, string])[] = [
  ["bakara", "bakara"],
  ["bakara", "bakarah"],
  ["mariam", "maryam"],
  ["ab", "ba"],
  ["zilzal", "zalzala"],
  ["yasin", "yaseen"],
  ["fatiha", "fathiha"],
  ["duha", "dhuha"],
  ["nur", "noor"],
  ["taha", "taaha"],
  ["nuh", "nooh"],
  ["kaf", "qaf"],
  ["kaaf", "qaf"],
  ["ikhlas", "ikhlaas"],
  ["ankabut", "ankaboot"],
  ["imran", "imraan"],
  ["rahman", "rahmaan"],
  ["maryam", "mariam"],
  ["meryem", "maryam"],
  ["sajda", "sajdah"],
  ["falak", "falaq"],
  ["takwir", "takathir"],
  ["ghafir", "ghaafir"],
  ["mulk", "malak"],
  ["fath", "fatihah"],
  ["alaq", "alaaq"],
  ["maida", "maaidah"],
  ["naba", "nabaa"],
  ["baqara", "bakara"],
  ["kuraysh", "quraysh"],
];

const field = (key: string): TranslitKey => ({ key, kind: "field" });
const alias = (key: string): TranslitKey => ({ key, kind: "alias" });

describe("translitKey", () => {
  it("folds the spec 3.1 verification table", () => {
    for (const [raw, key] of KEY_CASES) expect(translitKey(raw), raw).toBe(key);
  });

  it("keeps dh and th digraphs distinct from the spec table's duha/fatiha rows", () => {
    expect(osaDistance("dhuha", "duha", 1)).toBe(1);
    expect(osaDistance("fathiha", "fatiha", 1)).toBe(1);
  });

  it("gates short, numeric and Arabic input to inert keys", () => {
    for (const [raw, key] of GATE_CASES) expect(translitKey(raw), raw).toBe(key);
  });

  it("is idempotent over every case", () => {
    for (const [raw] of [...KEY_CASES, ...GATE_CASES]) {
      const once = translitKey(raw);
      expect(translitKey(once), raw).toBe(once);
    }
  });

  it("keeps the alaq and alim prefixes under the bare-article remainder guard", () => {
    expect(translitKey("alaq")).toBe("alak");
    expect(translitKey("alim")).toBe("alim");
  });
});

describe("osaDistance", () => {
  it("prices substitution, transposition and the known two-edit pair", () => {
    expect(osaDistance("mariam", "maryam", 1)).toBe(1);
    expect(osaDistance("ab", "ba", 1)).toBe(1);
    expect(osaDistance("zilzal", "zalzala", 2)).toBe(2);
  });

  it("pre-rejects on length difference beyond the cap", () => {
    expect(osaDistance("nuh", "bakara", 2)).toBeGreaterThan(2);
    expect(osaDistance("fath", "fatihah", 1)).toBeGreaterThan(1);
    expect(osaDistance("abc", "abc", 0)).toBe(0);
    expect(osaDistance("abc", "abd", 0)).toBeGreaterThan(0);
  });

  it("matches the unbanded reference over the fixed pair list at every cap", () => {
    for (const [a, b] of DISTANCE_PAIRS) {
      const reference = osaReference(a, b);
      for (const max of [1, 2, 3]) {
        const banded = osaDistance(a, b, max);
        if (reference <= max) {
          expect(banded, `${a}/${b}@${max}`).toBe(reference);
        } else {
          expect(banded, `${a}/${b}@${max}`).toBeGreaterThan(max);
        }
      }
    }
  });
});

describe("maxEditsFor", () => {
  it("returns 0 under three letters, 1 through five, 2 from six", () => {
    expect(maxEditsFor(0)).toBe(0);
    expect(maxEditsFor(2)).toBe(0);
    expect(maxEditsFor(3)).toBe(1);
    expect(maxEditsFor(5)).toBe(1);
    expect(maxEditsFor(6)).toBe(2);
    expect(maxEditsFor(14)).toBe(2);
  });
});

describe("makeTranslitScorer", () => {
  it("returns null when the folded query is under three letters", () => {
    expect(makeTranslitScorer("al")).toBeNull();
    expect(makeTranslitScorer("112")).toBeNull();
    expect(makeTranslitScorer("")).toBeNull();
    expect(makeTranslitScorer("ali")).not.toBeNull();
  });

  it("scores alias and field exact keys at 0.75 and 0.70", () => {
    const scorer = makeTranslitScorer("bakarah");
    expect(scorer).not.toBeNull();
    expect(scorer!([field("bakara")])).toBe(0.7);
    expect(scorer!([alias("bakara")])).toBe(0.75);
  });

  it("scores distance one at 0.50 and distance two at 0.40", () => {
    expect(makeTranslitScorer("mariam")!([field("maryam")])).toBe(0.5);
    expect(makeTranslitScorer("meryem")!([field("maryam")])).toBe(0.4);
  });

  it("folds per-word needles for multi-word queries", () => {
    expect(makeTranslitScorer("surh baqarah")!([field("bakara")])).toBe(0.7);
    expect(makeTranslitScorer("surah yaseen")!([field("yasin")])).toBe(0.7);
  });

  it("returns zero for unrelated keys and never lowers a raw score under max()", () => {
    expect(makeTranslitScorer("baqarah")!([field("nur")])).toBe(0);
    const translit = makeTranslitScorer("baqarah")!([field("bakara")]);
    expect(Math.max(0.8, translit)).toBe(0.8);
  });

  it("pre-rejects two-edit keys at length delta two or more and accepts delta one", () => {
    expect(makeTranslitScorer("fatiha")!([field("fath")])).toBe(0);
    expect(makeTranslitScorer("fatiha")!([field("fatiha")])).toBe(0.7);
    expect(makeTranslitScorer("zilzal")!([field("zalzala")])).toBe(0.4);
  });
});

const EXPECTED_KEY_COLLISIONS: readonly string[] = [];
const ARTICLE_EXCEPTIONS: readonly string[] = ["taa"];

describe("catalogue census", () => {
  it("keeps transliteration keys unique across all 114 surahs", () => {
    const ownersByKey = new Map<string, number[]>();
    for (const surah of QURAN.surahs) {
      const key = translitKey(surah.transliteration);
      const owners = ownersByKey.get(key) ?? [];
      owners.push(surah.num);
      ownersByKey.set(key, owners);
    }
    const collisions = [...ownersByKey.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([key]) => key)
      .sort();
    expect(collisions).toEqual(EXPECTED_KEY_COLLISIONS);
  });

  it("starts every multi-token transliteration with a known article token or exception", () => {
    const allowed = new Set([...ARTICLE_TOKENS, ...ARTICLE_EXCEPTIONS]);
    const offenders: string[] = [];
    for (const surah of QURAN.surahs) {
      const tokens = catalogueTokens(surah.transliteration);
      if (tokens.length > 1 && !allowed.has(tokens[0]!)) offenders.push(`${surah.num}:${tokens[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("builds identical tables from two decodes of the same catalogue", () => {
    const second = createQuranData(JSON.parse(readFileSync(DATA_PATH, "utf8")));
    expect(surahTranslitKeys(second.surahs)).toEqual(surahTranslitKeys(QURAN.surahs));
  });
});

describe("surahTranslitKeys", () => {
  it("memoizes on the catalogue array reference", () => {
    expect(surahTranslitKeys(QURAN.surahs)).toBe(surahTranslitKeys(QURAN.surahs));
  });

  it("folds name, transliteration and slug into deduped field keys", () => {
    const table = surahTranslitKeys(QURAN.surahs);
    expect(table).toHaveLength(114);
    const baqarah = table[1]!;
    expect(baqarah.every((entry) => entry.kind === "field")).toBe(true);
    expect(baqarah.map((entry) => entry.key)).toEqual(["bakara"]);
    const duha = table[92]!;
    expect(duha.map((entry) => entry.key)).toEqual(["duha", "dhuha"]);
  });
});
