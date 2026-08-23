# EasyQuran — Search system (design)

Design doc for three search enhancements: **(1)** typo- and dialect-tolerant surah-name matching (`bakarah` → Al-Baqarah), **(2)** richer keyword/alias matching (nicknames like *tabarak*, *amma*; translation/translator lookup), **(3)** full-text search over the user's already-cached offline translation DBs.

**Status: proposed — not implemented.** Every claim about current behavior below was verified against code (paths are real). Settled design decisions are stated as decisions; owner calls left open are collected in Part 8. When this ships, `docs/quran-system.md` Part 1 ("No FTS. Search = normalize + substring-scan the 6236 Uthmani rows") and `docs/remaining/feature-gap-catalogue.md` D01 must be amended — see Part 7.

Related: `docs/quran-system.md` (normalization parity contract, integrity rules), `docs/remaining/feature-gap-catalogue.md` D01 (search backlog).

---

# Part 0 — The three failures (verified)

**`bakarah` finds nothing.** `web/src/lib/search/palette/sources/quran-surahs.ts` ranks every surah by `max(scoreFields([name, transliteration, meaning, slug], needle), scoreArabic(arabic, arabicNeedle))`. The ladder in `web/src/lib/search/palette/scoring.ts` is exact 1 > prefix 0.9 > word-boundary substring 0.8 > plain substring 0.6 > ordered subsequence 0.3. Surah 2's fields are `Al-Baqarah` / `Al-Baqara` / `The Cow` / `al-baqarah` — none contains a `k`, so substring, word-boundary, and subsequence all fail; Arabic scoring ignores Latin input. Result: no matches anywhere.

**Spelling variance defeats the catalogue.** The baked catalogue already carries *two* Latin spellings per surah (`name` = `Al-Baqarah`, `transliteration` = `Al-Baqara` — Tanzil long-vowel style: `Al-Faatiha`, `Ar-Rahmaan`, `Nooh`, `Al-Ikhlaas`), and they disagree (surah 40: name `Ghafir`, transliteration `Al-Ghaafir`). User spellings vary far more: `baqara`, `yaseen`, `mariam`, `meryem`, `fatiha`, `rahmaan`, `el-baqara`, `albaqarah`. Today `yasin` only scores 0.3 (subsequence), `yaseen` works only because surah 36's `meaning` field happens to be the literal string `Yaseen`, and `mariam`/`meryem`/`rahmaan`/`teen` find nothing.

**Translation DBs are cached but unsearchable.** The worker already downloads, caches (OPFS-first, id-keyed), and opens translation SQLite DBs (`translationRunner` LRU, cap 7) — but only for surah/range reads. The `search` worker message has no source parameter; the worker search corpus is built exclusively from the Arabic source plan (`DEFAULT_QURAN_SOURCE_PLAN.search` = uthmani); the Rust `GET /quran/search` is Arabic-only too. Searching an English translation for "mercy" is impossible anywhere in the product.

What already works and must not regress: `cow` → Al-Baqarah at 0.8 (word-boundary on `meaning`), `mulk`/`kahf` at 0.8, `90:2` → reference source, `baqarah 255` → JumpTo verse promotion, `juz amma`-adjacent coordinates (`juz 30`), Arabic-name search through `normalizeArabic`.

---

# Part 1 — Current state (inventory)

## Palette (cmdk-style, lazy)

`web/src/lib/search/palette/` — engine (`engine.svelte.ts`: sync sources per keystroke, async sources debounced 140 ms + AbortController, catalogue loaded once on first open), registry (`index.ts` `BUILTIN_PALETTE_SOURCES` order: quranReference, quranSurahs, quranText, quranRanges, settingsRoutes, siteRoutes, appActions; `registry.ts` Map + dedupe by `entry.id` and `dedupeKey` — vocabulary `ayah:S:A`, `surah:S`, `juz:N`, `page:N`, `opener:S`, `href:PATH`; first registration wins ties), scoring (`scoring.ts` shared 0–1 ladder), query parsing (`query.ts`: leading keyword, trailing numeric ref with Arabic-Indic/Persian digit folding, `residualText` gates async sources), keyword aliases (`aliases.ts`: SURAH/JUZ/PAGE lists, exact-match only), navigation (`quran-nav.ts` — all hrefs through the ctx-preserving `surah*For` family), groups (`groups.ts` orders 10/20/30/40/55/90/100; 50–89 nominally reserved). Palette is lazy-loaded; guard test `web/src/lib/components/search/__tests__/lazy-palette.test.ts` fails if anything outside the loader imports it.

## Full-text search (Arabic only)

`web/src/lib/quran/search.ts` — ladder: worker (`SearchProvider.Worker`) → API (`SearchProvider.Api`, `GET {apiBase}/search`) → `nameNumberFallback` (`SearchProvider.Names`; matches `name`/`arabic`/number only — weaker than the palette's field set). Worker corpus: `web/src/lib/quran/search/corpus.ts` builds opener + ayah units from `all` rows of the uthmani plan with `matchNorm` (normalizeArabic) + UTF-16 offset maps; `searchCanonicalCorpus` = substring filter + mushaf-order slice. Bounds: `MIN_QUERY_LEN` 3, `MAX_QUERY_LEN` 64, limit ≤ 50, offset ≤ 500 (shared constants in `search/normalize.ts`).

Normalization (`search/normalize.ts`, `normalizeArabicWithMap`): strips harakat U+064B–0658, tatweel U+0640, U+0670, U+06DD; folds `آأإٱ→ا`, `ى→ي`, `ة→ه`; collapses whitespace; emits an offset map for highlights. **Parity contract:** byte-identical rules in `rust/backend/api/src/quran/normalize.rs`, proven by shared `web/src/lib/quran/__fixtures__/parity.json`. A rule change ships Rust + web together.

## Offline translation layer

- Catalogue: `web/src/lib/data/translations.json` (115 rows, 8-tuple `[id, language, languageCode, direction, name, translator, filePath, sizeBytes]`), decoded by `web/src/lib/data/translations.ts`; `web/src/lib/quran/catalogue.ts` adds `downloadUrl` (`/_quran/tanzil/translations/...`, same-origin). Sizes: min 0.79 MB, median ~1.25 MB, max 13 MB.
- Cache: `web/src/lib/workers/opfs-cache.ts` — OPFS-first (`easyquran/<id>/<id>.sqlite` + IDB pointer), IDB fallback, session Map last resort; integrity = exact `sizeBytes` match + staged content asserts (6236 contiguous rows, schema probe) on download; **no hashes, no ETag, no conditional requests** (machine-guarded by `web/src/lib/quran/__tests__/catalogue-sha-guard.test.ts` scanning ~20 files for `/sha256/i`).
- Runtime: `web/src/lib/workers/quran.worker.ts` — `@sqlite.org/sqlite-wasm` 3.53.0-build1, `sqlite3_deserialize` READONLY (whole DB resident in the WASM heap; no VFS). Translation DBs share the Arabic schema (`quran_text("index", sura, aya, text)` + `idx(sura,aya)` — no FTS tables anywhere; DBs are built by `db/quran/translations/scripts/sql-to-sqlite.ts` and are immutable). Queries flow through frozen literals in `web/src/lib/quran/sql.ts` (`TANZIL_QURAN_DATABASE`: count / coordinates / firstAyahs / surah / range / all — no LIKE, no user SQL). Open-DB LRU `translationDbs` cap `TRANSLATION_DB_CAP = 7` (`STACKED_MAX_EXTRAS + 2`); concurrent fetches deduped (`pendingTranslationRunners`); `forgetTranslations`/evict hooks exist.
- Protocol (`web/src/lib/quran/protocol.ts`): init / readSurah / readRange / **search (no source param)** / hasTranslation / ensureTranslation / setPinnedTranslations / listArtifacts / deleteArtifact. Client `worker-client.ts` with per-call timeouts + hedged API fallback for reads.

## Server

`rust/backend/api/src/quran/search.rs` — boot-built arena of normalized Uthmani text, memmem substring scan, no ranking (global verse order), no Latin handling, no translation scope. `/quran/search` carries its own 30 req/60 s limiter; ETag folds a sha-256 digest of the **normalized query** (user input — the one sanctioned runtime sha). Translation corpora are memory-resident server-side (`translation_pool.rs`) for read serving only. **`SearchHitKind::Opener` exists in the DTO but is never emitted.**

---

# Part 2 — Non-goals (v1)

- **No server changes.** `/quran/search` stays Arabic-only, exact-substring. Translation search and fuzzy matching are client-side. Rationale: the 30/60 s search rate-limit budget, the parity contract, and the fact that the client already holds the bytes. Revisit in Part 9.
- **No FTS.** No FTS5 tables, no `MATCH`, no tokenization/relevance engine. (FTS5 *is* compiled into the shipped `sqlite3.wasm` — `ENABLE_FTS5`/`fts5_api` symbols present, verified via `strings`; it is unusable on deserialized READONLY DBs anyway, and building a writable sidecar index would double stored bytes for text the client already has. Recorded as an escape hatch, not used.)
- **No Arabic-script typo tolerance.** `normalizeArabic` covers diacritics/alef forms; letter-level Arabic edit distance (البقصرة) is deferred — it needs its own key design (hamza/alef families, ta-marbuta already folded) and has different collision behavior. Scoped out, not forgotten (Part 9).
- **No changes to the reader search drawer** (`web/src/routes/(application)/app/_reader/Results.svelte`) — palette-first; drawer integration follows D01's pagination/URL-state work.
- **No keyword fuzzy-matching machinery.** `hasKeyword` stays exact-equality over the alias lists; mistyped keywords (`surh baqarah`) are handled by per-word folded needles (Part 3.4), not by fuzzy keyword recognition.
- **No localization of new palette copy in v1** — matches the palette today (group labels are hardcoded English; the palette is locale-blind). Follow-up listed in Part 9.

---

# Part 3 — Design A: typo-tolerant surah matching (fold + bounded distance)

Two error classes need different handling:

1. **Systematic dialect variance** (conventions, not typos): `yaseen/yasin`, `baqara/baqarah`, `rahmaan/rahman`, `qaf/kaaf`, `al-baqarah/el-baqara/albaqarah`. Deterministic spelling rules → a **fold key** collapses each family to equality. Raw edit distance cannot: `baqarah` vs `al-baqara` is 4 edits.
2. **Random typos**: `bakarah` (k-for-q), `mariam` (i-for-y), `mryam` (drop). **Bounded edit distance** on fold keys catches these.

## 3.1 `translitKey()` — new shared module

**Location: `web/src/lib/quran/search/translit.ts`** — sibling of `normalize.ts` in the shared lexical home, not inside the palette tree. Import direction stays palette → `$lib/quran/search`, so the lazy-palette guard holds (nothing outside the loader imports the palette), and the worker / a future mobile client can reuse the module without dragging palette code. It is a **presentation-layer transform that sits above normalization** — never part of the wire query, never part of the parity contract, no Rust counterpart needed.

Pure, total, deterministic (no locale calls beyond `toLowerCase`, capped loops, no `Date`/random). Applied symmetrically to queries and indexed fields:

1. `toLowerCase()`, NFD-strip `\p{M}`, NFC (Latin diacritics: `ā→a`, `ī→i`, `ū→u`, `é→e` — no hand table).
2. Fold separators: `[\s'’`._-]+` → single space; trim.
3. **Multi-token article drop:** if >1 token remains and token[0] ∈ `ARTICLE_TOKENS`, drop it. `ARTICLE_TOKENS = ["al","aal","el","an","ar","as","at","az","ad","adh","ash","ath"]` — derived from the actual slug census (surah-field article prefixes across all 114 slugs are exactly `aal, ad, adh, al, an, ar, as, ash, at, az, ath`; `el` added query-side for el-baqara spellings).
4. Join tokens with no separator (`ya sin` → `yasin`).
5. **Single-token bare-article strip:** if the result is one token starting `al` or `aal` and the remainder is ≥ 3 chars, strip it (`albaqarah` → `baqarah`). Only these two prefixes — `an`/`ar`/`as`… would eat real names (`ankabut`, `anfal`, `araf`); the ≥ 3 guard protects `alaq`/`alim`.
6. **Vowel-length collapse**, left-to-right pass, iterated to fixpoint capped at 3: `aa→a`, `ee→i`, `ii→i`, `oo→u`, `ou→u`, `uu→u`.
7. **`q→k`.** The one systematic consonant pair (Quran/Koran). Consonant digraphs (`kh`, `gh`, `th`, `dh`, `sh`) **stay distinct** — see rejected alternatives.
8. **Trailing `ah→a`** (ta-marbuta): `baqarah→baqara`, `fatihah→fatiha`. Deliberately narrower than "any vowel + h": `Nooh`/`nuh` keep their h (it is the letter هـ, pronounced), `Al-Fath` keeps its h (after a consonant). Only the feminine-ending `ah` folds.
9. Output is `[a-z]`-only; any input that folds to fewer than 3 letters (incl. Arabic/digit input → empty) is inert — callers gate on it.

**Verified against the actual catalogue** (`web/static/quran-meta/quran-data.json`):

| Input(s) | Key |
|---|---|
| `Al-Baqarah`, `Al-Baqara`, `baqarah`, `baqara`, `bakarah`, `el-baqara`, `albaqarah` | `bakara` |
| `Ya-Sin`, `Yaseen`, `yasin`, `yaseen`, `ya seen` | `yasin` |
| `Al-Fatihah`, `fatihah`, `fatiha`, `fathiha` | `fatiha` |
| `Al-Fath` | `fath` (≠ `fatiha`; distance 3 > cap — correctly no match) |
| `Ar-Rahman`, `Ar-Rahmaan`, `rahman`, `rahmaan` | `rahman` |
| `Qaf`, `Qaaf`, `qaf`, `kaaf` | `kaf` |
| `Al-Ikhlaas`, `ikhlas` | `ikhlas` |
| `At-Tin`, `teen` | `tin` |
| `Al-'Ankabut`, `Al-Ankaboot`, `ankabut` | `ankabut` |
| `Aal-i-Imraan`, `imran`, `aal imran` | `imran` |
| `An-Nur`, `An-Noor`, `nur`, `noor` | `nur` |
| `Ad-Duha`, `Ad-Dhuhaa`, `duha`, `dhuha` | `duha` |
| `Ta-Ha`, `Taa-Haa`, `taha` | `taha` |
| `Nooh`, `nuh` | `nuh` |
| `Maryam` | `maryam` (`mariam` = distance 1, not key-equal — by design) |

## 3.2 `osaDistance()` — banded optimal string alignment

Restricted Damerau-Levenshtein (sub/ins/del cost 1, adjacent transposition cost 1), three rolling rows, band `[i−max, i+max]`, early exit when a row minimum exceeds `max`. Key length ≤ 14 → ≤ ~42 cells per call.

**Edit budget** (`maxEditsFor(len)`, len = longer of the two keys): `< 3 → 0` (tier off), `3–5 → 1`, `≥ 6 → 2`. Hard cap 2 — distance 3 is where noise starts; known 3-edit pairs (`zilzal`/`zalzala` is exactly 2 and covered; `rahim`/`rahman` is 2) belong to the alias table if they matter.

## 3.3 Score ladder (settled)

The research pass produced two conflicting bands (folded-exact at 0.55 under substring vs 0.85 above word-boundary). **Decision: normalized evidence ranks *below* raw evidence but a full-name normalized equality ranks *above* an incidental substring.** Curated aliases outrank derived folds. Merged ladder:

| Tier | Score | Kind |
|---|---|---|
| exact | 1.0 | raw (existing) |
| prefix | 0.9 | raw (existing) |
| word-boundary substring | 0.8 | raw (existing) |
| **curated alias exact** | **0.75** | new |
| **fold key-exact** | **0.70** | new |
| plain substring | 0.6 | raw (existing) |
| **fold distance-1** | **0.50** | new |
| **fold distance-2** | **0.40** | new |
| subsequence | 0.3 | raw (existing) |
| no match | 0 | — |

Consequences, spelled out:

- A correctly-typed query keeps its raw score (`baqarah` stays 0.8 word-boundary — fold's 0.70 loses the `max`). No visible reordering for correct input.
- A mistyped query (`bakarah`) gets fold key-exact 0.70 — above any *other* surah's incidental 0.6 substring, below every raw word-boundary hit. The target ranks first.
- `scoring.ts` stays **byte-identical**. New tiers live in `translit.ts`; `quran-surahs.ts` merges with `Math.max`. The shared-ladder contract other sources rely on is untouched, and `sources.test.ts` (which pins labels/hrefs/enabled/idle-zero — not numeric tiers) needs only additive cases.
- Fold tiers apply to **name, transliteration, slug** keys and **alias keys** only. `meaning` stays on the raw ladder — English meanings at edit distance ≤ 2 are noise factories (`cow`/`cows`, `son`/"The Sun"), and meaning matching already works well raw.

## 3.4 Scorer shape

```ts
export interface TranslitKey { key: string; kind: "field" | "alias" }
export function translitKey(raw: string): string;
export function osaDistance(a: string, b: string, max: number): number;
export function maxEditsFor(len: number): number;
export function makeTranslitScorer(rawQuery: string):
  ((keys: readonly TranslitKey[]) => number) | null;   // null ⇒ key < 3 ⇒ tier off
export function surahTranslitKeys(surahs: readonly CatalogEntry[]):
  readonly (readonly TranslitKey[])[];                  // memoized on array identity
```

- The scorer computes the query key once. **Per-word needles:** for multi-word queries the scorer also folds each whitespace-separated word ≥ 3 chars and takes the max over {whole key, word keys} — this is what rescues mistyped keywords (`surh baqarah` → keyword `surh` unrecognized → free text → word needle `baqarah` still scores).
- Per key: kind `alias` exact → 0.75; kind `field` exact → 0.70; then `maxEditsFor` distance on either kind → 0.50 / 0.40. No prefix/substring tiers on keys — a partial key match is already served better by the raw ladder.
- `surahTranslitKeys` builds once per catalogue load (114 × 3 folds + alias keys), memo keyed by array reference (the engine loads one process-wide catalogue).

## 3.5 Alias tables — new `web/src/lib/search/palette/surah-aliases.ts`

**Curation rule: an alias earns a row only if `translitKey` cannot derive it from name/transliteration/slug/meaning.** `bakarah`, `yasin`, `duha`, `taha`, `fatiha`, `nur` are all fold-derived — no rows. Non-derivable circulation nicknames:

```ts
const SURAH_KEYWORDS: readonly (readonly [alias: string, surahNum: number])[] = [
  ["tabarak", 67], ["tbarak", 67],
  ["yaroiatak", 75], // expand from owner review — see Part 8
];
const JUZ_KEYWORDS: readonly (readonly [alias: string, juzNum: number])[] = [
  ["qad sama", 28], ["qadsama", 28],
  ["tabarak", 29],
  ["amma", 30], ["ama", 30],
  ["mubarak", 29],
];
```

Plain TS consts inside the palette tree (shipped in the already-lazy palette chunk; ~15 rows don't justify a JSON static file + decode layer). Module-init derived `Map<string, number>` keyed by `translitKey(alias)`; **init-time throw if two aliases fold to the same key with different targets** (fail in tests, never silently at runtime). Note `tabarak` legitimately maps to *both* surah 67 (alias tier) and juz 29 (ranges routing) — different tables, both correct, both surface (see integration).

`cow`-class queries need no alias — meaning matching works today and stays.

## 3.6 Integration

**`quran-surahs.ts`** (only `rank()` changes):

```ts
const scorer = makeTranslitScorer(needle);
const keyTable = surahTranslitKeys(quranData.surahs);
// inside the loop:
const translit = scorer ? scorer(keyTable[surah.num - 1]) : 0;
const score = Math.max(scoreFields([...], needle), scoreArabic(...), translit);
```

`namedAyahEntry` promotion inherits the fix for free: `bakarah 255` and `surah bakarah 255` (keyword stripped by `termsFor`, trailing ref parsed) both promote the folded top match to the JumpTo `Al-Baqarah 2:255` row.

**`quran-ranges.ts`** (juz nicknames): `enabled()` extends with a folded-residual check against the juz keyword map; `entries()` prepends one entry `{ label: "Juz 30 (Amma)", score: 0.8, href: juzHref(ctx, 30), dedupeKey: "juz:30" }` when the residual maps. `juz:30` is existing dedupe vocabulary, so `quran.reference` still wins ties once a number is present. Bare `amma` (no keyword) routes through the same check.

**Untouched on purpose:** `scoring.ts`, `query.ts`, `aliases.ts` (keyword lists stay exact-match), engine/registry/groups, the whole worker/API search chain.

## 3.7 Rejected alternatives (with reasons, so they stay rejected)

- **Lossy consonant-digraph folds** (`th→t`, `sh→s`, `kh→k`, `dh→d`, `gh→g`): merge distinct names (`sheen`/`seen` classes); unnecessary — digraph variance barely occurs in surah names, and `kh/gh/th/dh/sh` spellings are stable across conventions. Rejected for collisions.
- **Phonetic skeleton keys** (consonant-only soundex-style): provably unsafe on this corpus — `Al-Fatihah` and `Al-Fath` both reduce to `fth`. Vowel deletion destroys the discriminator.
- **Trigram/Jaccard**: `bakarah`/`albaqarah` Dice ≈ 0.33 — mushy thresholds, no "≤ 2 typos guaranteed" semantics, still needs verification, no win at N = 456 keys.
- **SymSpell delete-2**: correct but its only advantage (query cost independent of dictionary size) is irrelevant at 114 surahs; 1–5 MB of delete-index vs ~20 KB of fold keys. Named scale-up path if a hadith/tafsir corpus pushes the string set past ~10k — the `makeTranslitScorer` contract is written so only the scan internals would change.
- **BM25-lite over surah names**: zero signal on one-to-three-token names; does not address typos.

---

# Part 4 — Design B: full-text search over cached translation DBs

**Architecture: mirror the Arabic path.** Lazy per-translation corpus built once in the worker from the already-cached DB via the existing frozen `all` SELECT, then pure JS substring scan with highlight offset maps. No new artifacts, no persistence, no FTS, no protocol breakage beyond one additive message.

## 4.1 New pure modules

- **`web/src/lib/quran/search/normalize-latin.ts`** — `normalizeLatin(text)`: trim, `toLowerCase`, NFD-strip `\p{M}`, fold curly quotes/dashes to ASCII, collapse whitespace; `normalizeLatinWithMap` with the **same contract as `normalizeArabicWithMap`** (normalized + starts/ends arrays) so the existing highlight pipeline is reused. Plus `containsArabicScript(text)` for script-mode detection. Reuses the shared bounds (`MIN_QUERY_LEN`/`MAX_QUERY_LEN`/limit/offset constants from `normalize.ts`).
- **`web/src/lib/quran/search/translation-corpus.ts`**:

```ts
export interface TranslationSearchUnit {
  surah: number; ayah: number; globalIndex: number;   // 1..6236, catalogue-validated
  norm: string;                                        // normalizeLatin(text) — match surface
  starts: readonly number[]; ends: readonly number[];  // norm char → original UTF-16
}
export function buildTranslationSearchCorpus(rows: readonly CanonicalQuranRow[]): TranslationSearchUnit[];
export function searchTranslationCorpus(units, query, opts): { total; limit; offset; results };
```

Same semantics as `searchCanonicalCorpus`: eligibility gate, es-toolkit `clamp` on limit/offset, `units.filter(u => u.norm.includes(normalized))`, mushaf-order slice, per-hit highlight spans via the offset map. No openers, no views — translation text *is* the display text.

Wire type added to `search/types.ts`, **separate from `SearchResponse`** (different provenance, worker-only, no API tier): `TranslationSearchResponse { query, sourceId, total, limit, offset, results, source: "worker" }`, `TranslationSearchHit { kind: "ayah", sourceId, ayah: {key, surah, ayah, globalIndex, text}, highlights }`.

## 4.2 Worker + protocol

- Protocol (`protocol.ts`) + `worker-client.ts`: one new request `searchTranslation { sourceId, query, opts }`. Additive; older/newer bundle mismatch is not a concern (worker chunk ships with the app shell it serves).
- Worker state: `translationSearchCorpora: Map<string, TranslationSearchUnit[]>` + `pendingTranslationCorpora` (dedupes concurrent builds, mirroring `pendingTranslationRunners`). **Cap 3, LRU-evicted** (~4 MB corpus each — budget below).
- Build: `translationRunner(sourceId)` (inherits download/staged-validation/open-LRU unchanged) → `runQuery(runner, TANZIL_QURAN_DATABASE.queries.all)` → `buildTranslationSearchCorpus(rows)` → cache. The runner is not held beyond the build.
- **Eviction hook:** `forgetTranslations(ids)` additionally deletes corpora entries — corpora never outlive their DB (LRU evict, retention prune, `deleteArtifact` all flow through it).
- Errors propagate to the client → the palette source throws → the engine records it in `failedSources` (existing failure surface). No silent-empty path except the deliberate not-cached case below.

## 4.3 Palette source

New `web/src/lib/search/palette/sources/translation-text.ts`, async, registered after `quranTextSource`:

- **Group:** new `PaletteGroups.TranslationText { id: "translation-text", label: "Translation", order: 25 }` — between QuranText (20) and Surahs (30); the registry's conflicting-order throw enforces uniqueness.
- **Scope** (which translation), resolved per query, no picker UI: `query.routeContext` is `{kind: "translation", lang, translator}` on translated reader routes (existing `routeContextFromParams` — verified `web/src/lib/data/quran.ts:104`); else the reader's `lastRead` sourceId if it is a translation id; else the first pinned translation (the same list `app/+layout.svelte` pushes via `setPinnedTranslations`); else the source is disabled. **UiLocale never participates in source selection** (independent-axes rule).
- **Eligibility:** residual free text ≥ `MIN_QUERY_LEN` **and** no Arabic script in it (`containsArabicScript`) — Arabic queries belong to `quran.text`; mixed queries sit out v1. Scope translation must be `direction === "ltr"` in v1 (RTL-script tafsir defer — `normalizeArabic` reuse is the natural v2 path).
- **Keyword:** `TRANSLATION_ALIASES = ["translation", "translations"]` added to `aliases.ts`; `translation mercy` strips the keyword and searches `mercy`.
- **Not-cached behavior:** `search()` first awaits `hasTranslation(scope)`; on miss it fires `void ensureTranslation(scope)` and returns `[]` this round — never blocks a keystroke path on a multi-MB download, never strands the worker message loop (the cold-read hazard that motivated `hedgeAfterMs`). Next query finds the DB cached and answers from it.
- **Entries:** `label` = `${surah.name} ${num}:${ayah}`, `detail` = translation display name (`peekTranslationName`), `preview` = `{ text, highlights }`, `score` 0.7 flat (same as quran.text — ranking is D01 follow-up), `href` via `ayahHref(query.routeContext, ...)` (ctx-preserving; results open in the same translation; nav-guard green), **`dedupeKey: "tayah:<sourceId>:S:A"`** — deliberately distinct from `ayah:S:A` so an Arabic hit and a translation hit on the same verse both survive cross-source dedupe.
- **Rendering:** `HighlightedArabic.svelte` hardcodes `dir=rtl` + Arabic font; new minimal `HighlightedText.svelte` (same `highlightSegments` + `<mark>` styling, no Arabic font class, `dir` from the catalogue `direction` field), imported only inside the palette tree.

## 4.4 Budgets (median 1.25 MB, worst 13 MB translation)

- **Memory:** corpus ≈ normalized text × 2 (UTF-16) + ~100 B/unit metadata ≈ **~4 MB per searched translation** (display text is *not* stored — re-fetched per hit via the existing `range` query, top-8 only). Cap 3 → ≤ ~12 MB. DB residency is already paid by reading.
- **Build:** one `all` SELECT (6236 rows, the identical readout the Arabic corpus does) + normalize-with-map pass ≈ **50–100 ms on the worker thread, first search only**. Estimate — benchmark during implementation (Part 8).
- **Scan:** 6236 × `String.includes` over pre-normalized strings ≈ **5–15 ms**, inside the 140 ms debounce, cancellable by the next keystroke.
- **Concurrency:** build is awaited in the handler like any op; `pendingTranslationCorpora` dedupes; delete's existing rejecting pending-runner gate blocks corpus builds against a being-deleted id (corpus path goes through `translationRunner`).

## 4.5 Lifecycle: derive-on-first-search, never persist

Rebuild is ~once per session; persisting would add 2–4 MB/translation of duplicate storage, a second id-keyed atomic-swap lifecycle, and invalidation coupling — for zero user-visible win. Matches the Arabic corpus precedent (`ensureSearchCorpus` is a module-var cache, never persisted). No new R2 objects, no catalogue growth, nothing under `db/`, no hashes anywhere.

## 4.6 Deferred decisions (recorded, not solved)

- **Corpus LRU (3) vs open-DB LRU (7, shared with the reader stack):** searching while reading 5 stacked extras can evict reader DBs. Accepted for v1 (corpus build releases the runner; thrash is bounded); revisit with data.
- **Flat 0.7 + mushaf order:** common-word queries (`lord`) fill the 8-hit cap with early surahs. Ranking/grouping/per-surah caps = D01 follow-up.
- **`en.transliteration` romanization DB as a fold-key full-text corpus** (phrase-level `bakarah` matching across all ayat) — the natural bridge between Design A and Design B; v2, and it should reuse `translitKey` from Part 3 (which is why that module lives in `$lib/quran/search`).
- **Translation/translator-name palette search** (`pickthall`, `sahih`): cheap follow-up — tiny sync source over the in-memory `TRANSLATIONS` list (`scoreFields` on name/translator/language/id), href via `surahPathFor` with a translation route context. Listed in Part 8 for owner triage.

---

# Part 5 — Files to touch

**Phase 1 (fuzzy names + keywords) — web only, no wire/worker changes:**

| File | Change |
|---|---|
| `web/src/lib/quran/search/translit.ts` | NEW — key fold, OSA distance, scorer, memoized key table |
| `web/src/lib/search/palette/surah-aliases.ts` | NEW — curated nickname tables + folded lookup maps |
| `web/src/lib/search/palette/sources/quran-surahs.ts` | EDIT — `rank()` gains the `max()` fold tier |
| `web/src/lib/search/palette/sources/quran-ranges.ts` | EDIT — juz-nickname routing |
| `web/src/lib/search/palette/__tests__/translit.test.ts` | NEW — unit + census tests (Part 6) |
| `web/src/lib/search/palette/__tests__/sources.test.ts` | EDIT — additive cases |

**Phase 2 (translation full-text):**

| File | Change |
|---|---|
| `web/src/lib/quran/search/normalize-latin.ts` | NEW — Latin normalize + offset map + script detect |
| `web/src/lib/quran/search/translation-corpus.ts` | NEW — build + scan |
| `web/src/lib/quran/search/types.ts` | EDIT — translation wire types |
| `web/src/lib/quran/protocol.ts`, `worker-client.ts` | EDIT — `searchTranslation` message + client fn |
| `web/src/lib/workers/quran.worker.ts` | EDIT — corpus cache + handler + eviction hook |
| `web/src/lib/quran/wire.ts` | EDIT — `decodeTranslationSearchResponse` (coordinate-validated) |
| `web/src/lib/search/palette/sources/translation-text.ts` | NEW — async source |
| `web/src/lib/search/palette/groups.ts`, `aliases.ts`, `index.ts` | EDIT — group, keyword, registration |
| `web/src/lib/components/text/HighlightedText.svelte` | NEW — LTR highlight rendering |
| tests (Part 6) | NEW/EDIT — normalize-latin, corpus, worker (real-wasm pattern), wire, sources |

**Docs when shipped:** `docs/quran-system.md` (Part 1 search statement + web search inventory), `docs/remaining/feature-gap-catalogue.md` D01.

---

# Part 6 — Test plan

**`translit.test.ts`** (new):
- Key table: every row of the Part 3.1 table, exact assertions. Idempotence `fold(fold(x)) === fold(x)` over the whole case list.
- Gates: `112` → key < 3 → inert; `البقرة` → empty; `ali` stays `ali` (single-token strip guard); `albaqarah` → `bakara` (bare-article strip); `ankabut` untouched by `an`-prefix (guard proof).
- `osaDistance` units: `mariam/maryam` = 1; `ab/ba` = 1 (transposition); `zilzal/zalzala` = 2; length-diff pre-reject; banded implementation ≡ unbanded reference over a fixed 30-pair list.
- `maxEditsFor` boundaries: 2→0, 5→1, 6→2.
- Scorer: `makeTranslitScorer("al")` → null; constants 0.75/0.70/0.50/0.40; `max()` never lowers a raw-tier score.
- **Census test (the safety net):** over all 114 entries — (a) every transliteration key unique across surahs, real collisions listed explicitly in an `EXPECTED_KEY_COLLISIONS` const (documented, not silently tolerated); (b) every first token of a multi-token transliteration is in `ARTICLE_TOKENS` or an explicit `ARTICLE_EXCEPTIONS` list — this verifies the hand-derived token list against the whole catalogue; (c) two builds from the same catalogue → identical arrays (determinism). Fold-collision and token-census claims are *assertions to establish*, not facts — this test is what turns them into facts.

**`sources.test.ts` (additive):**
- `bakarah` → first Surahs entry "2. Al-Baqarah", score 0.70. `bakarah 255` / `surah bakarah 255` → JumpTo `2:255` (`ayah:2:255`).
- `yaseen`/`yasin` → Ya-Sin at 0.70 (today 1.0-by-accident via meaning / 0.3 — pin the new deterministic value). `mariam` → 0.50; `meryem` → 0.40; `rahmaan` → 0.70; `teen` → At-Tin 0.70; `qaf`/`kaaf` → Qaf 0.70.
- `fatiha` → Al-Fatihah present **and** Al-Fath absent (the collision guard).
- `tabarak` → surah 67 at 0.75 (alias) *and* "Juz 29" ranges entry at 0.8 — cross-group coexistence. `amma`, `juz amma` → "Juz 30" entry, `dedupeKey: "juz:30"`; `juz 30` still resolves via reference and wins dedupe.
- `surh baqarah` → Al-Baqarah present (per-word needle).
- Frozen regressions: `baqarah` (0.8 raw wins over 0.70), `cow` (0.8 meaning), `mulk`, Arabic queries, idle suggestions, `2:255`/`juz 5`/`112` — identical output to today.

**Translation-search tests:**
- `normalize-latin.test.ts`: case fold; `mécréant`→`mecreant`; curly-quote fold; whitespace collapse; map contract (starts/ends index-match normalized, highlight the right original spans — mirror the Arabic map tests); `containsArabicScript`.
- `translation-corpus.test.ts` (synthetic rows, no DB): build throws on non-contiguous globalIndex; substring semantics incl. phrase queries; multi-occurrence highlight = two spans; limit/offset clamps; ineligible query (<3, >64) → empty; result order = globalIndex order.
- `quran-worker-search-translation.test.ts` — **real wasm** pattern (same as `web/src/lib/workers/__tests__/quran-worker-validator-sqlite.test.ts`): build a `quran_text` DB with sqlite-wasm, serialize, inject, send `searchTranslation`, assert hits + spans; corpus cache reuse (second call: no re-read); `deleteArtifact` drops corpus + DB.
- `wire.test.ts` additions: decode accepts well-formed payload, rejects wrong globalIndex (coordinate validator), rejects malformed highlights.
- `sources.test.ts` additions: enabled only for Latin residual ≥ 3; Arabic residual disables; `translation mercy` strips keyword; not-cached scope → `[]` + fire-and-forget ensure (mocked client); cached scope → `tayah:` dedupeKeys, detail = translation name, ctx-correct href; group order 25 slots between 20 and 30; `ayah:2:255` and `tayah:en.sahih:2:255` both survive dedupe.

**Gates:** `pnpm check` (`--fail-on-warnings`; `noUncheckedIndexedAccess` — non-null assertions on indexed access, house style), `pnpm lint` (`--deny-warnings`; no nested ternaries — lookup tables + early returns throughout, no ternary needed at all), `pnpm test`. New files under scanned paths stay sha-free (catalogue-sha-guard scans `quran.worker.ts`, `wire.ts`, etc. — this design hashes nothing). Verify palette behavior in `pnpm preview`, not just dev (dev-only async-effect regression memory).

---

# Part 7 — Constraint compliance

- **Immutable DBs / no writes:** fold keys are derived JS; translation corpora are derived JS; DBs stay READONLY; no DDL, no migrations, no new artifacts.
- **id-not-hash:** corpora and caches keyed by translation id; integrity = existing staged validation; nothing new digests content; catalogue-sha-guard untouched by construction.
- **Normalization parity contract untouched:** `translitKey` and `normalizeLatin` sit *above* normalization as separate pre-query/presentation transforms — the escape quran-system.md explicitly allows; they never enter the wire query, the worker's Arabic path, or `/quran/search`; `parity.json` unchanged. (Stated here so the change is not misread as a parity-contract change requiring a Rust ship.)
- **"No FTS" statement stays true:** substring scan over derived corpora; FTS5 present-in-wasm but unused is recorded as an escape hatch. Amend quran-system.md's wording (search is no longer Arabic-only once Phase 2 lands) when shipping.
- **Baked metadata only:** scope resolution via `TRANSLATION_BY_ID` + reader context + user pins; no `/sources` call, no remote metadata.
- **ctx-preserving hrefs:** all new hrefs via `surahHref`/`ayahHref`/`juzHref` (quran-nav) — nav-guard green by construction; no hand-built `/app/` strings.
- **UiLocale independence:** never touches source selection.
- **Lazy palette:** all new modules imported only by palette sources / the palette tree; `translit.ts` under `$lib/quran/search` is imported *by* the palette (direction preserves laziness). `lazy-palette.test.ts` green.
- **No new deps; es-toolkit `clamp` for limits; no nested ternaries; comments: doc-comments on exports only.**
- **Worker concurrency:** corpus builds deduped; deletion's pending-runner gate inherited.

---

# Part 8 — Open decisions (owner calls)

1. **Alias content:** the curated tables in 3.5 are seeds (`tabarak`, `amma`, `qad sama`…). Expand/finalize the list — every entry is a product decision (which nicknames does EasyQuran recognize?). Include `yaroiatak`-style regional nicknames or keep to pan-Arab circulation names?
2. **Juz nickname breadth:** juz 28–30 only, or all 30 (qad samaha, tabarak, amma are the only widely-used ones)?
3. **Translation-search drawer surface:** palette-only v1 confirmed, or is the reader drawer (`Results.svelte`) a must-have before ship? (D01 couples it with pagination/URL state.)
4. **Translator/translation-name search** (4.6): include in Phase 1 as a tiny sync source, Phase 2, or skip?
5. **Mistyped-keyword UX:** per-word needles cover the common case silently; an explicit "did you mean surah …" hint is possible later — wanted?
6. **Ranking for translation hits** (flat 0.7 + mushaf order): accept for v1 and iterate on feedback, or pre-design a per-surah cap now?

## Deliverables that turn estimates into facts (implementation-time, not pre-work)

- Fold-collision + article-token census test (Part 6) — run before merge.
- Corpus-build benchmark on a median (1.25 MB) and the max (13 MB) translation — the 50–100 ms figure is an estimate from the Arabic corpus precedent, not a measurement.
- Latin-eligibility enumeration: the `direction === "ltr"` gate admits Cyrillic/Greek etc. where matching is plain case-folded substring (fine) and Turkish dotless-ı (known wrinkle — `toLowerCase` mishandles `İ`/`ı` pairs); decide whether to special-case or document.

---

# Part 9 — Deferred / future

- **Arabic-script typo tolerance** (letter-level edit distance over `normalizeArabic` output; needs its own key design — hamza/alef families behave differently from Latin).
- **Server-side translation search / fuzzy search** (rate-limit budget, ETag carve-out reuse, parity fixtures for `normalizeLatin` if it ever crosses the API — currently worker-only by design).
- **`en.transliteration` romanization corpus** with fold keys (phrase-level translit full-text — the bridge between Designs A and B).
- **Reader drawer surface + pagination/URL state/share routes** (D01).
- **Relevance ranking** for full-text (both corpora) — D01.
- **Recent queries** (privacy-gated, D01).
- **Mobile:** consume `translitKey` from the shared `$lib/quran/search` home per the same pattern as the normalization contract (TS now; a native port mirrors the rules + shared fixtures, no wire coupling since it never crosses the API).
- **Localization of palette copy** (group labels, "downloading translation" hint) — own namespace per the auth-modal precedent if/when the palette localizes.
- **Multi-translation batch search** (search N cached translations concurrently, merged sections) — protocol shape sketched in 4.2 extends naturally.

---

# Appendix — Research provenance

This doc synthesizes a 6-reader code audit (palette, quran-search, offline-cache, surah-data, backend, docs-guards) + 3 independent design proposals (minimal-curated, algorithmic, offline-fts) + an adversarial completeness pass. Claims flagged by the adversarial pass and resolved here: the sources test suite pins labels/order/idle-zero, **not** numeric tier scores (fold tiers cannot break existing pins); FTS5 symbols were independently verified present in the shipped `sqlite3.wasm` (and are moot for deserialized READONLY DBs); palette `routeContext` already carries translation identity (`routeContextFromParams`, `quran.ts:104`), so translation scoping needs no new reader plumbing; the two designs' conflicting score bands are settled once in Part 3.3. Claims that remain estimates until Part 8's deliverables run: fold-key uniqueness across all 114 surahs, the article-token census, and corpus-build timing.
