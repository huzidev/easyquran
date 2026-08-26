# EasyQuran — Quran system

Canonical contract for shipped Quran data, API, delivery, caching, UI locale handling, web
auth isolation, and Rust ingress. Code owns implementation detail; this document records
boundaries that must survive refactors.

Related subsystem docs:

- [`search-system.md`](./search-system.md) owns client search behavior and ranking.
- [`settings-system.md`](./settings-system.md) owns settings, storage administration, and
  reader presentation preferences.
- [`my-plan-raw.md`](./my-plan-raw.md) is owner-authored intent, not delivered architecture.

Parts 1–5 are settled contracts. Part 6 lists current gaps and product decisions.

---

# Part 1 — Hard rules and Quran delivery

## Hard rules

- Quran databases are immutable Tanzil.net source material. Never modify or version them.
- `db/` is gitignored. Databases live in R2 and are provisioned onto disk; nothing required
  after a fresh clone may live under `db/`.
- Database identity is its id (`uthmani`, `simple-clean`, `en.sahih`, …), never a digest.
- SHA-256 over Quran data is manual audit only: `just quran-audit`, `pnpm audit:arabic`, and
  `pnpm verify` inside `db/quran/translations`. Build, boot, runtime, ETag, cache, and catalogue
  paths never hash Quran data. Cryptographic use for CSRF, HMAC, Argon2, PKCE, and normalized
  search-query variance is unrelated.
- Ayah text remains verbatim from SQLite through API, SSG, and display. Never normalize,
  trim, split, reorder, or “repair” source text.
- Boot fails on missing/corrupt sources, invalid XML, broken tiling, invalid coordinates, or
  opener-packaging failure. Runtime integrity uses content and shape assertions, never hashes.
- Arabic reader routes use SSG. Translated reader routes use SSR plus a seven-day disk cache;
  they are never prerendered and never use ISR.
- UI locale and Quran translation-content locale are independent. UI locale never selects a
  source id, API source, DB, migration, request header, or query parameter.
- Reader navigation preserves translation context. Use the `surah*For(ctx, …)`,
  `globalPagePathFor(ctx, …)`, and `juzPathFor(ctx, …)` helpers, then `readerHrefFor(ui, …)`.
  Components never use Arabic-only helpers or hand-build `/app/` URLs.
- No machine translation ships. Quran text is not UI copy.

## Sources and metadata

- `quran-uthmani.sqlite` is display and Arabic-search corpus.
- `quran-simple-clean.sqlite` is the readable API/canonical-view script.
- Both expose `quran_text("index", sura, aya, text)` with 6,236 contiguous rows. They are read
  directly and read-only; no consolidated canonical DB is built.
- `quran-data.xml` supplies metadata only: 114 surahs, 6,236 ayahs, 604 pages, 30 juz, 556
  ruku, 240 hizb quarters, 7 manzil, and 15 sajda. Web consumes the compact generated JSON;
  Rust parses XML at boot.
- `quran_text."index"` is canonical global ayah order: `1..6236`, unique, ordered by surah
  then ayah, and equal to XML's zero-based surah start plus one-based ayah number.
- Page, juz, ruku, hizb-quarter, and manzil ranges tile the corpus without gaps or overlap.
- Translation catalogue contains 115 immutable SQLite dumps across 44 languages. Web decodes
  baked `[id, language, languageCode, direction, name, translator, filePath, sizeBytes]`
  records. Production artifact selection uses baked id maps only.
- Translation redistribution is non-commercial; revisit licensing before monetization.

Provisioning has two paths:

- `deploy/fetch-quran-db.sh` / `just quran-fetch` fills development and CI disk from baked R2
  paths using credential-free HTTPS reads.
- Compose's one-shot `quran-init` service fills deployed `quran_data`; `QURAN_DB_DIR` may opt
  into an absolute host bind mount.

Both provisioners are idempotent per file and validate expected size/SQLite shape without
hashing corpus bytes.

## Rust API

Quran routes live under `/quran`; there is no `/quran/v1` or content-version route.

- Navigation families expose list/detail/ayah routes for surah, juz, page, ruku,
  hizb-quarter, manzil, and sajda.
- `GET /quran/sources/{id}/surah/{n}` and
  `GET /quran/sources/{id}/range?from=&to=` serve Arabic and translation sources. Range size
  is capped at 300 ayahs.
- `GET /quran/search?q=…` remains Arabic-only exact substring search over normalized Uthmani.
  Client fuzzy-name and translation search never cross this API boundary.
- `GET /quran/random` is deterministic ayah-of-the-day.
- `GET /quran/scripts` and `/quran/sources` serve mobile/API consumers; web boot uses baked
  metadata instead.
- `/quran/health/ready` exposes readiness and bounded public counts. OpenAPI is feature-gated.
- Successful payloads use `{ data: T }`. `QuranApiError` owns Quran 400/404/5xx responses;
  rate-limit and gate middleware retain their app-level error shapes.

Web routes use surah slugs; API routes use numeric `1..=114`. Web resolves slug to number.

## Normalization and canonical view

Rust and web implement one parity-tested Arabic normalization contract:

- Fold `آ أ إ ٱ → ا`, `ى → ي`, and `ة → ه`.
- Strip `U+064B–U+0658`, tatweel `U+0640`, superscript alef `U+0670`, and end-of-ayah
  `U+06DD`.
- Keep standalone Quranic ornaments `U+06D6–U+06DC`, `U+06DE`, and `U+06DF–U+06ED`
  searchable, including rub el hizb and sajda marks.
- Emit normalized-scalar to source-scalar offsets so highlights map back to verbatim display
  text. Web converts those offsets to UTF-16.

`web/src/lib/quran/__fixtures__/parity.json` is shared by Rust and web tests. A rule change
ships both implementations together. Search-specific transliteration and translation-text
normalization remain presentation transforms outside this parity contract.

Canonical view represents body plus opener units. `OpenerKind` and `OpenerPackaging` stay
orthogonal; packaging counts and shadda variants are asserted at boot. SQLite remains
unchanged.

## Caching and fallback

- Rust pins both Arabic corpora in memory. Translation DBs use an on-demand Moka pool with
  single-flight construction and count/byte bounds.
- Quran responses are read directly from resident sources and edge-cacheable with weak,
  id-based ETags. Search variance may digest normalized user query text, never corpus data.
- Web pins Uthmani in OPFS. Translation DBs download lazily, use id-keyed active-file pointers,
  and prune by LRU, TTL, count, and bytes.
- Downloads stage to an id-scoped temporary file, verify baked size and Quran structure, then
  atomically switch `{sourceId, activeFile}`. A partially written DB can never become active.
- `/_quran` is the allowlisted same-origin R2 gateway. Runtime remote metadata never selects
  Quran bytes, size, path, or delivery origin.
- Service worker cache buckets cover app shell, bounded pages, bounded `__data.json`, and
  offline pack. `/api/` always bypasses Cache Storage.
- Translated HTML uses an adapter-node disk cache keyed by build id, source id, route shape,
  index, and bounded UI locale. Cookie-bearing or session-setting responses bypass it.
- Browser source reads use one ladder: local → API → local re-check → typed failure. Cold
  translations may download through the worker during the final local attempt.
- Browser and SSR share a range fetcher that chunks requests to 300 ayahs and rejects partial
  or non-adjacent results.
- API outage memory is passive: transport failures/timeouts and repeated 5xx responses open a
  circuit; no health probe is generated.

Arabic primary plus up to five client-only stacked translations are supported. Extras never
alter route identity, canonical URL, server HTML cache key, or primary delivery. `?more=` is
client-mirrored state; cache keys strip it. Selected extras and current primary are pinned
against OPFS eviction.

Engagement-gated translation prefetch uses durable local reading activity. Explicit source
selection bypasses the gate. Arabic-only reading never counts toward translation downloads.

## Web delivery

- Arabic-source pages are built from local SQLite without WASM on first paint.
- Translated-source pages render on Bun; Node remains build-only for Arabic prerender.
- Public reader paths begin with `/{ui}/app`, where `ui` is `en` or `ar`. Valid legacy
  `/app/**` requests receive a `307` plus `Cache-Control: no-store` to the matching English UI
  path; they never render reader HTML or enter disk cache.
- Route families cover surah, surah-local page, global page, and juz for Arabic and translated
  sources.
- Page geometry is source-independent. Ayah-to-page mapping is computed from metadata.
- Reader loads one bounded local page and virtualizes continuous adjacent-page loading.

---

# Part 2 — UI i18n

## Locale and routing

- Paraglide v2 owns compiled UI copy. Source catalogs live under `web/messages/`; generated
  `web/src/lib/paraglide/` output is ignored build output.
- `UI_LOCALES`, not Quran translation catalogue, owns locale routing, direction, switchers,
  sitemap fan-out, and prerender discovery.
- Marketing publishes English at `/` and selected Arabic pages under `/ar/`. Publication
  matrix decides which localized pages exist; unsupported locale/path pairs remain 404.
- Canonical reader paths use `/en/app/**` and `/ar/app/**`. UI locale changes shell copy and
  direction only; translation source segments remain unchanged.
- Arabic-source output is prerendered for both UI locales. Translated-source paths are never
  prerendered; UI locale creates bounded SSR cache variants.
- Reader canonicals and sitemap entries use English UI forms. Quran-content hreflang remains
  about source content, not shell locale.

Quran passages always declare their own language and direction. UI shell direction never
changes Arabic scripture or translation-content semantics.

## Copy ownership

- Structural config stores ids, URLs, and membership, not rendered copy.
- Message functions run at render time or inside request-scoped functions, never module-level
  server-global initialization.
- Shared Nav, Footer, Tweaks, Brand, and SEO components receive resolved copy via props.
- Catalog keys are meaning-named and structurally identical across locales; catalogs contain
  no HTML, classes, URLs, or icon ids.
- `MARKETING_PUBLICATIONS` gates localized publication. Locale switches are links and preserve
  query/fragment; there is no locale cookie, storage preference, or Accept-Language override.

## Message chunking

`web/scripts/gen-message-namespaces.ts` maps every message key to exactly one namespace using
`web/i18n-namespaces.json`, then emits committed typed barrels under
`web/src/lib/i18n/m/`. Unclaimed or multiply claimed keys fail generation.

- Global `$lib/paraglide/messages.js` imports are banned.
- Page copy stays in page namespaces; shared chrome resolves once in layout.
- Appearance/settings panel copy loads lazily when its surface opens.
- Catalog files stay coarse; prefixes organize chunk ownership.
- `pnpm i18n:check` runs before check, lint, test, and build.
- Paraglide currently embeds all locales in each imported message module. Namespace chunking
  contains cost; revisit per-locale builds when locale count reaches four or five.

---

# Part 3 — Web auth and cache isolation

- Auth is client-hydrated. Arabic reader/account shells stay auth-neutral; translated SSR
  output stays auth-neutral. User state never enters build output, disk-cached reader HTML, or
  shared Cache Storage.
- `auth-client.ts` is the web API wrapper. `auth-state.svelte.ts` owns
  `unknown | anonymous | authenticated` and single-flight session bootstrap.
- CSRF token stays in memory. Unsafe auth requests await bootstrap; session rotation refreshes
  CSRF state.
- Password, TOTP, verification, recovery, OAuth, passkey, profile, and session flows share the
  same private/no-store boundary.
- Login, logout, and account switch await service-worker acknowledgement while deleting page
  and data caches. OPFS Quran DBs and offline pack remain.
- Rust private routes always return `Cache-Control: private, no-store`; public Quran routes
  keep immutable/public policy.
- Session audit rows bind to opaque tower session ids. Rotation updates binding before success;
  binding failure destroys the rotated session. Logout revokes audit and live session state.
- One immutable `AllowedOrigins` value is parsed at boot and shared by CORS and origin guard.
  Missing app state rejects.
- Production auth/provider/mail/WebAuthn configuration fails closed. Logs and readiness expose
  status without credentials, tokens, email addresses, or session ids.

---

# Part 4 — Rust ingress, rate limiting, bans, and prewarm

- `RequestIdentity` resolves before rate limiting. External requests use configured IP source;
  internal SSR requires constant-time validation of `X-EasyQuran-Internal-Token`.
- Production trusts `CF-Connecting-IP`; Traefik/firewall must restrict origin ingress to
  Cloudflare ranges. `deploy/README.md` owns operational procedure.
- Fixed limits: 600/min general, 30/min search, 600/min internal SSR, 120/min readiness. Search
  remains under both search and general ceilings.
- Ban escalation is default-off. Only external canonical IP units with qualifying suspicious
  4xx history may escalate; raw volume alone never bans. State and capacity are bounded.
- Ban persistence flushes transactionally. Operator list/delete/export endpoints stay
  admin/token protected and `no-store`; external proxy mutation remains outside repo.
- Translation-pool durable score measures API demand across restarts, not reader popularity.
  Decay occurs in Rust; prewarm is bounded, background-only, and never blocks boot.
- Public readiness excludes pool budgets, hit rates, and demand ranking.

---

# Part 5 — Divergences from `my-plan-raw.md`

[`my-plan-raw.md`](./my-plan-raw.md) is read-only owner intent. Shipped architecture wins:

1. Translated pages use SSR plus seven-day disk cache and are never SSG. Their surah and
   surah-local shapes alone would create about 76,000 routes before juz/global pages.
2. Translation context spans surah, surah-local page, global page, and juz routes. Navigation
   may never fall back to Arabic context.
3. “SSG-last” applies only to Arabic. Translation recovery is local DB → API → matching server
   data.
4. Durable translation-pool score measures API demand, not reader popularity.
5. Surah and range routes retain `+page.server.ts`; post-paint worker upgrades do not remove
   SvelteKit server-load dependency.
6. Authentication remains client-hydrated and absent from every shared output/cache.
7. Production artifact specs come from baked id maps. Staged validation and atomic pointer
   switching prevent incomplete downloads from becoming active.

---

# Part 6 — Known gaps and product decisions

- Arabic marketing copy beyond home awaits fluent review; unpublished pairs remain 404.
- Landing/app-home English literals and several physical RTL utilities/arrows remain.
- Paraglide sends all configured locales within imported message modules.
- `IP_SOURCE` documentation has one deploy README location mismatch.
- Word-level navigation and shared canonical-view fixtures remain deferred.
- Future UI locales require SSG and SSR-cache capacity review.
- Translation contribution/review ownership remains undefined.
- Mobile is outside this repo; any future client must share normalization fixtures and
  immutable-source contracts.

Four empty translation verses are valid immutable source data, not bugs: `fa.safavi 80:39`,
`ku.asan 108:3`, `sq.mehdiu 21:56`, and `sq.mehdiu 77:14`.
