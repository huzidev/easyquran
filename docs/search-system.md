# EasyQuran — Search system

Canonical contract for shipped search behavior. Implemented August 2026. Search is
client-first except for the existing Arabic Quran API endpoint.

[`quran-system.md`](./quran-system.md) owns Quran-source immutability, Arabic normalization
parity, API contracts, artifact delivery, and cache safety. This document owns discovery,
ranking, translation search, palette behavior, and dedicated search-page behavior.

---

## 1. Boundaries

Search has three independent paths:

1. Surah/reference/range discovery in the lazy command palette.
2. Arabic ayah substring search: worker first, Rust API fallback.
3. Translation ayah substring search over translation DBs already available to the worker.

Hard boundaries:

- Rust `GET /quran/search` remains Arabic-only exact substring search over normalized Uthmani.
  No fuzzy surah matching or translation scope is added server-side.
- No FTS tables, `MATCH`, tokenization engine, or persisted derived index. FTS5 may exist in
  shipped WASM but is unused.
- Quran DBs remain read-only and unmodified. All indexes are derived JavaScript state keyed by
  source id and rebuilt per session.
- Arabic parity normalization remains byte-equivalent between Rust and web. Latin
  transliteration and translation-text normalization are separate presentation transforms.
- UI locale never chooses search source. Quran route context, last-read source, or pinned
  translation state chooses it.
- Palette remains dynamically loaded. Search modules must not pull palette code into initial
  app bundle.
- Every result href uses context-preserving reader navigation helpers. Never hand-build
  `/app/` paths.

---

## 2. Palette discovery

Palette engine runs synchronous sources per keystroke and debounced asynchronous sources with
abort support. Registry deduplicates by stable ids/dedupe keys; lower group order renders first.

Current sources cover:

- Quran coordinates and references.
- Surah names, meanings, transliterations, and curated aliases.
- Arabic Quran text.
- Cached translation text.
- Juz/page ranges and circulated juz nicknames.
- Settings/site routes and app actions.

Existing raw string scoring stays:

| Evidence | Score |
|---|---:|
| Exact | 1.00 |
| Prefix | 0.90 |
| Word-boundary substring | 0.80 |
| Plain substring | 0.60 |
| Ordered subsequence | 0.30 |

Derived transliteration evidence supplements raw scoring; `Math.max` ensures fuzzy logic never
lowers a stronger raw match.

Reference promotion remains intact: a trailing verse number can promote the top matching surah
to a direct ayah result (`bakarah 255` → `2:255`). Arabic-name and coordinate matching do not
use Latin folding.

---

## 3. Typo- and dialect-tolerant surah matching

`web/src/lib/quran/search/translit.ts` owns deterministic Latin fold keys and bounded optimal
string-alignment distance. It is shared lexical code imported by the lazy palette, not part of
the Rust/web Arabic normalization contract.

`translitKey()`:

1. Lowercases and removes Latin combining marks.
2. Collapses separators and recognized leading Arabic articles.
3. Joins remaining tokens.
4. Collapses common long-vowel spellings.
5. Folds `q → k`.
6. Folds trailing feminine `ah → a`.
7. Rejects results shorter than three Latin letters.

This makes common variants equivalent without using a phonetic skeleton:

- `Al-Baqarah`, `baqara`, `bakarah`, `el-baqara` → `bakara`.
- `Ya-Sin`, `yasin`, `yaseen` → `yasin`.
- `Ar-Rahmaan`, `rahman` → `rahman`.
- `Qaf`, `kaaf` → `kaf`.
- `At-Tin`, `teen` → `tin`.

Consonant digraphs such as `kh`, `gh`, `th`, `dh`, and `sh` remain distinct. Aggressive
consonant-only or soundex-style folding is forbidden because it merges real surah names.

Bounded restricted Damerau-Levenshtein catches insertion, deletion, substitution, and adjacent
transposition errors:

- 3–5 character key: at most one edit.
- 6+ character key: at most two edits.
- Hard cap: two edits.
- Two-edit candidates with length difference of two or more are rejected, protecting pairs
  such as `fatiha` and `fath`.

Derived score tiers:

| Evidence | Score |
|---|---:|
| Curated alias exact | 0.75 |
| Fold-key exact | 0.70 |
| Fold distance 1 | 0.50 |
| Fold distance 2 | 0.40 |

Fold tiers apply to name, transliteration, slug, and curated alias keys. English meaning keeps
raw scoring only. Per-word fold needles preserve results when another query word is a mistyped
keyword.

Curated aliases exist only when folding cannot derive them. Surah and juz alias tables are
separate, so `tabarak` may legitimately return both Surah 67 and Juz 29. Fold-key collision and
article-prefix census tests guard all 114 surahs.

---

## 4. Arabic ayah search

Arabic search normalizes query and Uthmani corpus with the parity contract in
[`quran-system.md`](./quran-system.md): diacritics/presentation marks strip, letter variants
fold, searchable Quranic ornaments remain, and highlight offset maps point back to verbatim
text.

Client ladder:

1. Search worker's boot-built Uthmani corpus.
2. Rust `/quran/search` through the shared circuit breaker.
3. Name/number fallback when content paths are unavailable.

Results stay in mushaf order and support bounded limit/offset. Plain normalized queries require
3–64 Unicode scalars; searchable ornament-only queries remain valid. Rust search keeps its
30-per-minute limiter underneath the general Quran limiter.

---

## 5. Translation full-text search

`normalize-latin.ts` lowercases, removes combining marks, normalizes quotes/dashes, collapses
whitespace, and emits UTF-16 highlight maps. `translation-corpus.ts` derives one ayah unit per
row from the immutable translation DB.

Worker protocol exposes `searchTranslation { sourceId, query, opts }`:

- `translationRunner(sourceId)` opens or downloads the validated source through existing
  artifact machinery.
- Frozen `all` query reads 6,236 rows.
- Worker builds one normalized in-memory corpus per source, deduplicating concurrent builds.
- Search uses `String.includes`, returns mushaf order, and maps highlights to original text.
- Corpus cache is LRU-capped at three and removed whenever its translation artifact is
  forgotten/deleted.
- Derived corpora are never persisted or uploaded.

Translation result wire types remain separate from Arabic `SearchResponse`. Each result carries
source id, ayah coordinates, verbatim text, highlights, and `source: "worker"`.

Palette translation scope resolves in this order:

1. Current translated-reader route source.
2. Last-read translation source.
3. First pinned translation.
4. Disabled when none exists.

Palette searches only eligible non-Arabic residual text against LTR translation sources. On a
cold source it starts background caching and returns no results for that keystroke; it never
blocks palette interaction on a multi-megabyte download.

Translation results use `tayah:<sourceId>:<surah>:<ayah>` dedupe keys, allowing Arabic and
translation hits for the same ayah to coexist. Result href context always matches searched
translation source.

Dedicated `/app/search` supports multi-translation batch search, per-source sections,
shareable query/source state, and load-more pagination. Reader drawer integration, richer
relevance ranking, and recent-query history remain separate product work.

---

## 6. Resource and lifecycle limits

- Translation corpus contains normalized text plus packed `Uint16Array` highlight maps; display
  text is not duplicated in the corpus.
- Measured payload: about 7.9 MiB for median translation and 36.3 MiB for largest tested shape.
- Budget tests enforce median below 9 MiB and maximum shape below 42 MiB.
- First build measured about 250 ms median and 1.9 s maximum shape on Node 24; worker thread keeps
  main UI responsive.
- Typical scan is a few milliseconds over 6,236 normalized rows.
- Corpus LRU cap is three; open translation DB LRU remains seven. Corpus build releases runner
  ownership after derivation.
- Delete and eviction flow through worker serialization; derived corpus never outlives its DB.

---

## 7. Required guards

Search changes keep these contracts green:

- Arabic Rust/web normalization parity fixtures.
- Transliteration key, edit-distance, collision, and catalogue-census tests.
- Translation normalization/highlight-map and corpus memory-budget tests.
- Real-WASM worker translation-search tests and wire coordinate validation.
- Palette source ordering, dedupe, lazy-loading, and navigation guards.
- Quran catalogue no-hash guard.
- `pnpm check`, `pnpm lint`, and `pnpm test`.

---

## 8. Known limits

- Arabic-script typo tolerance is not implemented.
- Translation substring hits use mushaf order; relevance scoring remains limited.
- Palette searches one resolved translation source at a time.
- Cold translation palette search requires a later keystroke after background download.
- RTL-script translation search and Turkish dotted/dotless-i handling need dedicated rules.
- Palette copy/localized group labels remain incomplete.
