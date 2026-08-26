# Print-exact Mushaf rendering — research report (2026-08-24)

Goal: render the printed 604-page Madani mushaf (King Fahd Complex, Hafs) **exactly as printed** — same page boundaries, line breaks, glyphs, justification — in the easyquran web app.

Method: 6 parallel research lenses (QUL/Quran Foundation, KFGQPC official, image CDNs, OSS implementations, rendering tech, repo context) → synthesis → adversarial critique → 2 local follow-up verifications (604-font enumeration; quran-assets license). All URLs fetched live 2026-08-24.

---

## Verdict

Adopt the **QCF V2 glyph pipeline** — the proven quran.com recipe:
- Per-word QPC V2 glyph codepoints (PUA; one glyph = one whole word), grouped into the 15 printed lines from a layout dataset.
- One woff2 font **per page** (`p{1..604}.woff2`); the font's baked advance widths reproduce the printed justification. No layout engine, no browser justify, no coordinate dataset needed (none exists publicly anyway).
- Reach it through a 3–4 day spike (below). One legal item gates ship: KFGQPC no-modify EULA vs self-hosting woff2 — email the Complex for written permission, in parallel.

## Ground truths

1. **No public dataset has per-word x/y page coordinates.** QUL layout = line membership + `is_centered` + first/last_word_id only; quran.com API = per-word `line_number` + `code_v2`; quran-assets JSON = same granularity. Exact spacing must come from the font.
2. **Browser kashida justification does not exist** (WebKit 6203/99945, Mozilla 276079 open for ~2 decades; HarfBuzz refuses it). CSS justify on Arabic only varies word spacing → text route is print-exact ONLY via baked font advances (QCF per-page fonts do exactly this).
3. **Repo already has the right geometry.** `globalPage` = 604-page KFQC pagination (verified: page 1 = al-Fatihah + 2:1–5, page 2 starts 2:6); `/{en,ar}/app/page/{1..604}` routes exist + prerender; Rust API has `/quran/pages/{page}/ayahs`. Missing: line-level data + any print font. Current reader = Amiri reflow, `line-height: 2.35`.
4. **Three print editions:** QCF V1 = 1405H, V2 = 1421H (quran.com default), V4/QCF4 = 1441H (newest, refined letterforms, color-tajweed). Same 604 page boundaries, different calligraphy. Product decision.
5. **Hard rules bind the dataset:** identity = id + baked sizeBytes (never SHA-256 — sha-guards), `db/` untracked → R2 + quran-init provisioning, translated routes SSR-only, Arabic SSG reads sqlite via `node:sqlite` (Node build-only), nav via `surah*For(ctx,…)` helpers.

## Technique inventory

| Technique | Exactness | Select/search | Full-set payload | Licensing | Effort | Maturity |
|---|---|---|---|---|---|---|
| **QCF V2 per-page glyph fonts** (recommended) | glyph-pixel-exact 1421H (official fidelity at font scales 1–3) | DOM words (PUA); copy/search via parallel Unicode field | **93.2 MB fonts (verified)** + ~5 MB data; per-visit 1 font ≈158 KB avg | fonts © KFGQPC free-use/no-modify; redistribution gray (§Licensing) | medium | quran.com production; ask-786/quran-reader = SvelteKit+SQLite precedent |
| QCF V4 tajweed color fonts (COLRv1 + OT-SVG) | glyph-exact 1441H | same | ≈2–3× V2 (p1: COLRv1 27 KB, OT-SVG 101 KB); Firefox needs OT-SVG | same owner; channel quran.com/QF | med-high | quran.com flagship since Sep 2024 |
| QCF4 47-font repack (`npm quran-qcf4`) | glyph-exact 1441H | same | 35.65 MB fonts + 19 MB JSON | **weak**: Telegram-sourced 3rd-party fonts, unread license | low | small npm + demo — spike vehicle only |
| MushafDatabase ligature-based SVG (= QUL 569) | pixel-exact incl. ornaments; word-level `data-*` groups | not text; word id via attrs | unverified, est. 60–200 MB | **explicit permissive** ("Sadaqa-e-Jaria", incl. commercial) | low-med | young (spec V1.01 2026-03) |
| quranpedia/quran-svg + ayah polygons | pixel-exact; ayah-level click | not text; ayah-level only | ≈60 MB brotli | overlay CC0; artwork = same Complex question | low | multi-qiraat, small |
| Raster pages + glyph-bounds overlay (quran_android model) | pixel-identical incl. furniture | none (bounds = hit-targets) | 45–65 MB PNG/set, ~half as WebP | GPL sets unusable (closed-source product); scans unclear | low/med | quran_android, decade at scale |
| Server-side render: Rust + rustybuzz + tiny-skia → WebP/AVIF on R2 | pixel-exact (shaping once, server-side) | none w/o overlay DB | 40–100 KB/page on demand | same font rights | medium | unproven; reuses existing Rust+R2+provisioner |
| Unicode + official Uthmanic Hafs + line data | **not print-exact** (QPC disclaims page fidelity; no kashida) | **full text** select/search/copy | ≈1–9 MB — smallest | cleanest (unmodified official TTF) | low | common; current reader is half of this |
| Digital Khatt WASM typesetter | line-exact, real justification engine | real text | ≈5 MB runtime | MIT code | high | digitalkhatt.org only |
| Rejected | — | — | — | QF runtime API (docs say don't store fonts locally + OAuth → breaks offline/immutable); PDF.js archive.org scan (no license); ayah-crop CDNs (wrong granularity); misraj (CC BY-NC); batoulapps (408 MB, stale) | — | — |

## Data sources (verified live)

- **Layout:** QUL mushaf-layout **resource 10** — KFGQPC V2 1421H, 604 pages × 15 lines, SQLite. Schema: `page_number, line_number, line_type(ayah|surah_name|basmallah), is_centered, first_word_id, last_word_id, surah_number`. Free login, no API: `qul.tarteel.ai/resources/mushaf-layout/10`
- **Glyph text:** QUL quran-script **resource 61** — "QPC V2 Glyph - Word by Word", `code_v2` PUA codes, sqlite/json (same login). Public fallback `TarteelAI/quran-assets/pages/*.json` (~23 KB/page) is **UNLICENSED (verified: no LICENSE file, last push 2022-02-20)** — spike use only, never ship.
- **Fonts:** `verses.quran.foundation/fonts/quran/hafs/v2/woff2/p{n}.woff2` (CORS `*`, ~296-day cache) or quran.com frontend repo `public/fonts/quran/hafs/v2/`. Mirror once → R2.
- **Official first-party option for line data:** `qurancomplex.gov.sa/quran-dev/` — per-ayah page + line_start/line_end, free, checksummed (checksums manual-audit only per hard rules). Was unreachable this session; retry off-network (S5).

## Build (recommended path)

1. One-time Node script: QUL sqlite → `mushaf-qcf2.sqlite` (`pages` + `words(word_id, surah, ayah, position, page, line, glyph, text_uthmani)`, ~77–86k rows, est. 4–6 MB) + per-page compact JSON for prerender (~8–15 KB gz/page).
2. Validate: 604 pages, 15-line invariant, page-1/2 boundaries == repo's decoded `quran-data.json` deltas, word counts vs `quran-uthmani.sqlite` (bismillah rows = the trap), pagination equality across ALL 604 pages.
3. Fonts → R2 as ONE tarball, single `{id, sizeBytes}` entry; quran-init gains ~10-line unpack; serve same-origin `font/woff2` immutable. No hashing anywhere.
4. Render: 3rd value of existing `?mode=` (`reading|verse|mushaf`); Arabic-only → prerendered pages bake glyph payload; translated SSR routes keep reflow. Per page: 15 RTL line divs, `text-align: center` (never justify), glyph codes via innerHTML (textContent renders wrong — quran.com finding), `data-w` per word, FontFace `p{n}-v2` + Unicode fallback swap. Port quran.com's `$line-width-map` fixed-width idea if lines mis-justify at non-native scale.
5. PWA: new SW bucket `eq-mushaf-fonts-v1`, cache-first; prefetch ±1 page; "download whole mushaf" = `Cache.addAll` 604 URLs = 93.2 MB (iOS Safari quota/eviction must be tested; `navigator.storage.persist()`).
6. Search/copy stay on Tanzil corpus via in-repo ayah→page geometry; copy uses per-word Unicode field. Rust API optional `GET /quran/mushaf/{page}`.

### Bidi hazard (from adversarial review)

QCF PUA codepoints default to bidi class L (strong LTR) — naive RTL div can render word runs visually reversed. Test line-level `dir`/isolation in S2/S3; quran.com's output = reference.

## Spike plan (3–4 d)

- **S1 — DONE.** 604-font enumeration: **93.2 MB total, avg 158 KB, min 41 KB (p1), max 227 KB**. (Left: repeat for V4 if tajweed in scope.)
- **S2 (1 d):** prototype on branch: `npm i quran-qcf4`, gitignored static copy (35 MB never enters git), `/app/page/50`, shared line renderer + FontFace + fallback swap. Test iOS Safari/Firefox/low-end Android: FOUT, CLS, bidi, scroll.
- **S3 (0.5 d):** render QUL/quran-assets glyph codes under mirrored `p{n}.woff2`; visual diff vs `quran.ksu.edu.sa/ayat/safahat1/{n}.png`. Pass = identical line breaks, no tofu, justification + word order match.
- **S4 (0.5 d):** join glyph words to `quran-uthmani.sqlite` by (surah, aya, position) on bismillah-heavy pages 1/2/50/562; classify mismatches.
- **S5 (0.5 d):** QUL login; download layout 10 + script 61 + font 249; capture per-dataset license text; retry quran-dev off-network.
- **Gate:** side-by-side pages 1/50/604 vs scans on device; `pnpm check && pnpm lint && pnpm test` green.

## Licensing (blocks ship — run in parallel with spike)

- **KFGQPC EULA** (first-hand page unreachable): free use/copy/distribute, bans modification → woff2 conversion + R2 mirroring gray. quran.com/QUL/mirrors all redistribute publicly. App has commercial trajectory → **email the Complex for written display permission** (routinely granted to Quran apps).
- **quran-assets: no license** (verified) → all-rights-reserved; spike only.
- **QUL per-dataset license text never published** — capture in S5; repo code MIT ≠ dataset terms.
- **GPL image sets unusable** — product is free but not open source.
- **quranpedia CC0 = overlay/metadata only**; artwork = same Complex question.
- Data and fonts trace to the same KFGQPC rights chain — "MIT repo" never clears the underlying assets.

## Verification ledger

- **Verified:** everything in "Data sources", quran.com mechanics (`groupLinesByVerses.ts`, `fontFaceHelper.ts`, `useQcfFont.ts`, centered-line CSS), live API `by_page` shape, font CDN CORS/cache, QCF4 npm contents + demo, ask-786/quran-reader stack, quran_android image scheme (no CORS; 301 → files.quran.app), KSU paths, QuranHub ≈ KSU png_big, kashida absence, full-set 93.2 MB, quran-assets unlicensed, all repo facts (routes, provisioner, SW buckets, OPFS asserts, prerender split, 604-page geometry).
- **Estimate:** sqlite/prerender payload sizes, raster totals, MushafDatabase SVG sizes.
- **Unverified:** KFGQPC first-hand terms, QUL dataset license, glyph-code↔font-build compatibility (S3), full-604 pagination equality (S4), iOS Safari 93 MB Cache-Storage behavior, quran-qcf4 LICENSE.md full text.

## Later toggles on the same architecture

- V4 color-tajweed mode (COLRv1 + OT-SVG; storage ×2–3; Firefox OT-SVG).
- quranpedia CC0 SVG ornament layer for full-furniture facsimile mode (frames/medallions/surah headers — QCF text route renders text lines only).
- Word-timing highlight for audio sync (roadmap): QCF word spans = native fit; ayah-polygons = ayah-only; raster+bounds = needs rebuilt DB. Selection criterion if audio matters.
