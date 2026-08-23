# Settings Subsystem — Implementation Plan

Status: planned (not started). Produced 2026-08-21 from a 10-agent research/design/critique pass
(6 research dimensions, 3 independent architectures, 1 adversarial critic that verified claims
against code). Winning architecture per section is cited; critic corrections are folded in.

---

## 0. Decision summary

| Dimension | Decision |
|---|---|
| Surface | Route at `/app/settings` under the existing app shell (storage-first design) |
| Sections | Storage (hero), Appearance, Reading & Fonts, Privacy, Account (thin) |
| Storage truth | Worker protocol messages `listArtifacts` / `deleteArtifact`; per-layer bytes from app records, `estimate()` only for quota/total |
| Usage viz | One inline SVG stacked bar + legend (no chart lib), token colors, role=img a11y |
| Fonts | Registry with Amiri (default) + Scheherazade New + Noto Naskh Arabic, lazy `FontFace` injection; reader schema v3 |
| Translation size | px field `translationSize`, 13–28 step 1, default 17 == the `1.0625rem` fallback at the hardcoded 16px root |
| Account | Thin presence row + deep link to `/account`; no absorption, no new endpoints |
| Server | None in v1. `SettingsDoc` apply/collect module makes the surface sync-ready |
| Tweaks panel | Stays as quick portal on all surfaces, untouched (same stores → no split-brain) |

Why `/app/settings` and not a modal or a new `(settings)` group:

- The offline engine (`startOfflineEngine`) only boots when the canonical path is `/app` or
  `/app/*` (`web/src/routes/+layout.svelte:31-36`). A route outside `/app` (e.g. `/settings`)
  never starts the Quran worker — `quranWorker` calls hard-reject
  (`web/src/lib/quran/worker-client.ts:114-115`). Under `/app` the engine boots for free.
- Inherits Nav/Footer chrome, `prerender = true` auth-neutrality (`app/+layout.ts`), and the
  locale reroute: `hooks.ts` `READER_ROUTE_PATTERNS`' surah regex
  `^/app/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` already matches `settings`, so `/en/app/settings`
  reroutes to `/app/settings` today with zero changes. Do **not** add a hooks tuple and do
  **not** add `settings` to `RESERVED_SURAH_SEGMENTS` (`web/src/lib/i18n/reader.ts:12`) —
  adding it makes `readerHrefFor` throw. Document the accidental match instead.
- Static `/app/settings` outranks `/app/[surah]` in SvelteKit route precedence.

---

## 1. Surface & routing

### Files

- `web/src/routes/(application)/app/settings/+page.svelte` — section shell (tab rail / pill row).
- `web/src/routes/(application)/app/settings/_components/` — per-section components.
- **No `+page.ts` / `+page.server.ts`.** `gen-offline-pack.ts:62-67` throws on any prerendered
  `/app/**/__data.json`; a load-free page emits none.

### Invariants

- Prerendered + auth-neutral: all user/storage state hydrates client-side after mount
  (account-page `initialized`-flag `$effect` pattern).
- URL pollution: `app/+layout.svelte:64-96` `replaceState`s `?mode=`/`?more=` on every `/app`
  page, so `/app/settings?mode=reading&more=…` would appear. **Suppress**: gate those two
  `$effect`s on `routeContextFromParams(page.params)` presence (no reader params → skip
  replaceState). Only settings is affected; all other `/app` pages are reader pages. Fallback
  if gating proves risky: accept (SW `normalizeDataKey` already strips both for the data cache).
- Exclude `/app/settings` from `sitemap.xml`.
- Works fully signed-out.

### Entry points

1. Palette href entries — new source `web/src/lib/search/palette/sources/settings-routes.ts`
   (href via `publicHref(readerHrefFor(locale, "/app/settings"))` — never a hand-built
   `/app/` literal; `nav-guard.test.ts` scans palette sources raw). `PaletteGroups` gains
   `Settings: { order: 55 }` (free band 50–89 in `groups.ts`). Palette labels stay English —
   hardcoded-label precedent (`site-routes.ts:43` already carries the "settings" keyword);
   localization of palette entries is a separate product decision.
2. Nav site-panel row in `web/src/lib/components/nav/Nav.svelte`.
3. `Mod+,` hotkey: `await import("$lib/hotkeys.svelte")` + `registerHotkey` inside a
   client-only `$effect` (M6; per-callback `event.isComposing` guard, `unregister()` cleanup).

### Lazy-loading & guards

- Route is its own SvelteKit chunk; heavy copy lives in a lazy `settings` namespace consumed
  via a copy resolver (`reader-settings-copy.ts` pattern). Per-section subcomponents under
  `_components/` so only the settings route pulls them.
- New guard test `web/src/routes/(application)/app/settings/__tests__/lazy-sections.test.ts`
  (copy of `lazy-auth-modal.test.ts` raw-source greps): only a `*-loader.ts` may reference
  section components, `import()` only, shell free of bits-ui/heavy imports. **Lands in M1.**

---

## 2. Section: Storage (the hero)

### 2.1 Worker protocol (all Quran-byte paths stay worker-owned)

`web/src/lib/quran/protocol.ts`:

- `WorkerRequest` += `{ id; type: "listArtifacts" }` and
  `{ id; type: "deleteArtifact"; sourceId: string }`.
- Wire type `StorageArtifactInfo = { id: string; store: "opfs" | "idb"; tag: string;
  sizeBytes: number; lastUsed: number | null }` — defined in `protocol.ts`; main thread
  imports the *type* only, never `$lib/workers` runtime code.

Worker handlers (`web/src/lib/workers/quran.worker.ts`):

- `listArtifacts` → `listCachedArtifacts()` (`opfs-cache.ts`) joined with the recency map —
  export `readLastUsedMap()` from `opfs-retention.ts` (module-private today).
- `deleteArtifact` ordering mirrors `runPrune` exactly:
  1. refuse `isArabicSourceId(sourceId)` → typed error `"arabic"` (planned Arabic sources
     are pinned; deleting breaks reader/search);
  2. refuse an in-flight download of the same id → typed error `"busy"` (safe decision; the
     critic overruled incremental's "accept the race" stance);
  3. `forgetTranslations([sourceId])` — closes the open sqlite handle and drops the
     `cachedTranslationIds` entry, else `hasTranslation` lies until reboot;
  4. `deleteCachedArtifact(sourceId, tag)` + `clearLastUsed(sourceId)` (export the latter).
  `.sqlite.tmp` files are deliberately never touched (temp-race invariant; boot sweep owns
  temps). Serialization through the worker message loop kills the main-thread delete/download
  race by construction.
- `web/src/lib/quran/worker-client.ts` += `listArtifacts(): Promise<StorageArtifactInfo[]>`,
  `deleteTranslation(sourceId): Promise<void>` (typed errors surfaced).

Display metadata joins the **baked** catalogue (`findCatalogueEntry` / `peekTranslationName`
from `web/src/lib/quran/catalogue.ts`) — never raw `translations.json` row indices, never
remote `/sources` payloads.

**No sha anywhere near these files** — `catalogue-sha-guard.test.ts` greps them; validation
stays byte-size + structural; DB identity is its id.

### 2.2 In-use guard is main-thread (critic finding)

`app/+layout.svelte:98-110` recomputes pins from `page.params` on every navigation and
`setPinnedTranslations` **replaces** the set (`quran.worker.ts:505-506`). On `/app/settings`
there are no reader params, so the active primary translation is *unpinned* worker-side
exactly while the user browses delete buttons — the worker backstop only protects Arabic
there. Therefore:

- UI-side: rows whose id is the current `reader.source` or a stacked `?more` id
  (`stacked-translations` store) show an "In use" chip with delete disabled.
- Worker-side refusal stays as the authoritative backstop for Arabic + in-flight only.
- Cross-tab note: a second tab actively reading translation X can still race a delete from
  the first tab. Worst case is a re-fetch (hedged fallback already serves from the API while
  re-downloading) — accepted.

### 2.3 Usage visualization

One horizontal stacked bar as inline SVG (`_components/UsageBar.svelte`):

- Track = `navigator.storage.estimate().quota`; segments = per-layer **real** bytes:
  Quran DBs (split visually Arabic vs translations by tag), offline pack
  (`offline.activePack.bytes`), SW data cache, SW pages cache (from the new `storageStats`
  reply), and "Other origin data" = `max(0, usage - sum(layers))` — floored, striped SVG
  pattern so "unaccounted" reads differently from owned layers.
- Never derive per-layer numbers from `estimate()` deltas — it is browser-wide and mixes
  non-easyquran origin data. Footnote states per-item numbers come from the app's own records
  and may differ from the browser estimate.
- Min 2px slivers so tiny layers stay visible; token colors only (`--accent`, `--pop`,
  bg-ramp) → themes for free in dark/light/accent/surface.
- A11y: `role="img"` + composed `<title>` ("X MB of Y MB used"), per-segment `<title>`,
  every number duplicated as legend text; `tabular-nums`.
- Degraded states: hide the bar when `estimate()` unsupported (per-layer rows remain);
  Firefox under-reports OPFS historically — hide "Other" when estimate is obviously
  inconsistent instead of showing a misleading 0.
- Layer math in a named helper (`stackLayers`) — flat map + reduce, `es-toolkit` `sumBy`,
  no nested ternaries.

### 2.4 Storage report store

New `web/src/lib/stores/storage-report.svelte.ts` (`$state` class, `if (!browser) return`
guards): `artifacts[]`, `pack`, `swStats { pages: {entries,bytes}; data: {entries,bytes} | null }`,
`usage/quota` (reuse the `offline` singleton's estimate), `persisted: boolean | null`;
`refresh()` fan-in; `deleteArtifact(id)`; `clearAllTranslations()`.

- **Boot gating:** on a cold `/app/settings` the engine may be mid-boot sweep/prune —
  gate the initial list on `quranWorker.whenReady()` with a boot-state row, and refresh on
  worker status events (download-complete) and after every mutation. Never trust optimistic
  state; re-sync from worker truth.
- SW stats: `ClientToSw`/`SwToClient` in `web/src/lib/offline/messages.ts` += `storageStats`
  req/ack (merged single contract — platform and storage-first had proposed duplicates);
  `service-worker.ts` handler returns counts+bytes for `eq-pages-v1` (recency count + byte
  sum) and `eq-data-v1` (`scanDataMeta` sum — same accounting the SW itself uses, no drift).
  Same MessageChannel + timeout shape as `purgeUserCaches`.

### 2.5 Rows & actions

- Per-translation rows sorted by `sizeBytes` desc: name + language badge, store badge
  ("On disk" OPFS / "IndexedDB" fallback / "In memory" session with warning tint), human size
  (`formatBytes`), relative last-used (`Intl.RelativeTimeFormat(locale)` — the `lastUsed`
  stamps finally surfaced), trailing delete.
- Arabic ids render in a separate "Required for reading" group, no actions, explanatory note.
- Delete = two-step inline confirm (row action cell swaps to "Remove? [Confirm] [Cancel]",
  `aria-live` polite, focus moves to Confirm, **Escape cancels the confirm — not the panel**,
  focus returns to row). Worker typed errors map to copy: `"arabic"` → required note,
  `"busy"` → "Try again shortly".
- "Remove all downloads" (danger-styled, same two-step at section level) deletes every
  non-Arabic non-in-use artifact; post-run "Freed X MB" summary.
- Threshold warnings: translations > 80% of 256MB `CAP_BYTES` → "oldest translations
  auto-remove when full"; usage > 90% quota → destructive-toned line.
- `navigator.storage.persisted()` status row + "Request again" button when not persisted
  (`persist()` is requested once at boot today and the result discarded).
- "Clear cached pages & data" → existing `purgeUserCaches()` (MessageChannel ack, 5s
  timeout). Disabled with reason when `navigator.serviceWorker.controller === null` (it is
  a silent no-op there); the window-side `caches.delete` fallback is gated to exactly that
  no-controller case. **Never** offer or perform deletion of `eq-app-*` (precache only runs
  on install — deleting bricks the offline shell) or OPFS via this action.
- Retention transparency footer: "Unused translations are removed automatically after 30
  days or when storage exceeds 256 MB."
- Empty state ("No translations downloaded") and OPFS-absent banner ("Your browser stores
  downloads in IndexedDB" — the `OpfsFallbackBytes` fallback is otherwise invisible).

### 2.6 OfflinePack component split (prerequisite)

`web/src/lib/components/status/OfflinePack.svelte` renders a fixed-position global
`DownloadBar` overlay (`:71-90`) plus the panel card. Before relocating the card into the
Storage section: split the global bar (stays mounted where it is today) from the
presentational card; the card takes copy via props (its strings are hardcoded English today —
they move into `settings_*` keys en/ar simultaneously or `pnpm i18n:check` fails).
Hoist its `formatBytes` (`OfflinePack.svelte:17`) into the one shared helper instead of
private copies.

---

## 3. Section: Reading & Fonts

### 3.1 Registry

`web/src/lib/config/reader-fonts.ts`:

- `ARABIC_FONTS: { id; label; stack; file?: () => Promise<string> }[]` — `amiri` (default,
  already shipped via `@fontsource/amiri` in `layout.css`), `scheherazade-new`,
  `noto-naskh-arabic` (new deps `@fontsource/scheherazade-new`,
  `@fontsource/noto-naskh-arabic`, 400-weight arabic subset only).
- `ARABIC_FONT_IDS` allowlist shared by decode + UI + `app.html` literal-sync test.
- Alternate fonts load lazily via woff2 `?url` import + injected `FontFace`
  (`document.fonts.add`) on first selection — **never** a static `layout.css` import
  (marketing pages and the offline pack must not carry mushaf bytes).
- Translation family: sans/serif toggle, system stacks only, zero new font bytes.
- Remove the dead `@fontsource-variable/geist` dependency.

### 3.2 Application

- New html-level vars layered with defaults equal to today's fallbacks so unset == today's
  paint: `--reader-arabic-family` (stack becomes `var(--reader-arabic-family, "Amiri", …)`),
  `--reader-translation-size` (wires the **orphan** var `VerseRow.svelte:99,125` already
  reads and nothing sets), `--reader-translation-family` (default `var(--font-sans)`).
- `data-arabic-font` dataset on `<html>` from `applyReaderPresentation`.
- Family switches MUST route through the existing remeasure path
  (`changeFontSize → preserveViewport`, `SurahReader.svelte:327-332`) — virtualized
  `heightCache` is measured from rendered font metrics; generalize to `changeTypography`.
- Reading-mode CSS stays Arabic-gated on `[data-source-kind=arabic]` — override vars sit on
  Arabic-gated stacks only, or translations get mushaf fonts.
- `?mode=` URL contract and SW `normalizeDataKey` stripping unchanged.

### 3.3 Schema v3 (deeper than any design assumed — critic finding)

`web/src/lib/stores/reader-core.svelte.ts`: `READER_SCHEMA_VERSION` 2 → 3; `Persisted` +=
`arabicFont: ArabicFontId` (default `"amiri"`) and `translationSize: number`
(**13–28 step 1, default 17 — must equal the `1.0625rem` fallback at the hardcoded 16px
root**, `layout.css:359`/`VerseRow`, or first paint jumps).

`web/src/lib/stores/reader-persistence.svelte.ts` — three mandatory touchpoints:

1. `decodeReader` (lines 34-110) has **no version check today** — `isFutureSchema` exists
   only in the sub-stores (`reader.source`, `reader.stacked`). v3 must **add** explicit
   version handling (not "keep" it): per-field `asLiteral` allowlist for `arabicFont`,
   `asNumber` bounds for `translationSize`, invalid dropped, future-schema → known-fields
   decode.
2. `writeBlob` (lines 147-170) destructures a **fixed field list** — new fields must be
   added there or writes silently drop them.
3. `applyPersisted` += presentation of the new fields.

`web/src/app.html` pre-paint script mirrors `arabicFont` (allowlist) +
`translationSize` (bounds) as hardcoded literals (the existing duplication pattern) — plus a
**new guard test pinning `app.html` literals to the TS constants** (font ids AND bounds;
platform's idea, applied to everything, closing the known `fontSize` 22-56 drift class).

Multi-writer hazard (existing, now with a second writer): the reader blob is written whole
with debounced last-write-wins; a reader tab + a settings tab can interleave field loss for
bookmarks/notes. The debounced single-writer-per-tab + cross-tab `onStorageKey` re-apply
makes the window small; note it, don't redesign the persistence layer here.

---

## 4. Section: Appearance

- Binds the existing `prefs` singleton (`easyquran.prefs`) — theme pills, 5 surfaces,
  4 accents, custom seed pickers with per-seed reset, Copy-CSS, Reset. `setAccent`'s
  custom-accent-drop coupling preserved.
- Include platform's cheap win: cross-tab sync via `onStorageKey("easyquran.prefs")` →
  `hydrate() + apply()` atomically (fixes stale-tab themes; the dispatched
  `easyquran:pref` event stays unused).
- Tweaks panel on marketing/app stays byte-identical — **do not** gate new sections behind
  `showReaderTools` anywhere (critic: `/design` mounts Tweaks without the prop and the
  default is `true`, so that gate ≠ app-only; irrelevant now that settings is a route, but
  the trap is recorded here for whoever touches Tweaks).
- Follow-ups deferred with reasons: `system` theme mode (three synchronized layers —
  `site.ts` + CSS blocks + `app.html` — partial change = FOUC), app-level reduced-motion
  (needs an `app.html` pre-paint mirror it would otherwise flash), UI font scaling.

---

## 5. Sections: Privacy + Account

**Privacy** (platform design): analytics/performance consent toggles (same `consent` store
Tweaks binds — no split-brain), performance keeps its `location.reload()` semantics with
explicit warning copy, notifications status row, app version + "Check for updates" row
(surfaces the existing `UpdateStore`), sync-status placeholder as informational text
("Preferences are stored on this device"), sign-out when authenticated routed through the
existing logout flow so the purge hook (reading position + caches) still fires.

**Account** (incremental design — thin on purpose):

- Signed-in: name + email from `authState.user`, deep link to `/account` (which keeps
  owning name edit, sessions, TOTP, passkeys — no duplication), built with `publicHref`.
- Signed-out: explainer that prefs are device-local + "Sign in" button calling
  `authModal.open()` (`web/src/lib/auth/auth-modal.svelte.ts`; shell already mounted in root
  layout).
- Platform's `/account` absorption + 308 explicitly **deferred**: it conflicts with the
  `(account)` layout guard flow (`hydrateRouteAuth → protectedRouteRedirect` +
  `installPurgeHook`) and drags passkey-503/TOTP-abuse/403-unverified error paths into the
  settings i18n surface in one bite.

**Hard non-goals (API cannot support them today):** avatar (`avatar_id` is sent by the live
client and silently dropped by `V1UpdateProfilePayload` — shipping UI would be a dead end),
email self-change (no re-verification cycle — account-takeover vector), password change
(dormant `update.password` field bypasses current-password check; needs a dedicated
`POST /user/v1/password`), account deletion (cascade + purge interplay), OAuth identity
management. Passkey label rename also unsupported.

---

## 6. Sync-readiness

`web/src/lib/settings/settings-document.ts` (platform design — apply-direction wins over
snapshot/diff):

- `SETTINGS_DOC_VERSION = 1`; `SettingsDoc = { v, appearance: prefs.current, reading:
  { fontSize, mode, arabicFont, translationSize }, privacy: consent.current }` with a
  reserved keyspace for future surfaces.
- `toSettingsDoc()` derives from stores; `applySettingsDoc(doc)` fans out via existing
  setters **then** `prefs.apply() + applyReaderPresentation()` (else applied DOM lags stored
  state). Per-field decode `lastRead`-v2-style: unknown fields survive, missing fields
  default.
- Zero I/O, unit-tested, ready for the future `GET/PUT /user/v1/prefs` (Rust `user_prefs`
  migration required — new `m0000xx`, never a store added to an existing IDB/SQLite shape).
- Sign-out deliberately does NOT clear prefs/typography (device-scoped); the purge-hook
  contract is untouched. The eventual sync design must state server-vs-local precedence.

---

## 7. i18n

- New `settings` namespace: `settings_*` keys in **both** `web/messages/en.json` +
  `ar.json` (root catalogs — tree stays root + `reader/` + `auth/`, organized by prefix),
  claim registered in `web/i18n-namespaces.json`, barrel `m/settings.ts` regenerated via
  `pnpm i18n:check` (runs in precheck/prelint/pretest).
- Resolver `web/src/lib/i18n/settings-copy.ts` (`getSettingsCopy`), lazy — nothing renders
  until the settings route loads. Only a trigger label may ever be eager.
- Absorb the hardcoded-English debt the settings surface touches: `OfflinePack` +
  `Notifications` strings move behind copy props under `settings_*` keys.
- Watch the claim mechanics: the `reader` **prefix** namespace eagerly claims every
  `reader_*` key; exact keys win over prefixes. Any new panel key added without extending
  the exact-key list lands in the eager reader chunk — a silent chunk regression.
- Never import `$lib/paraglide/messages.js` (`message-barrel-guard.test.ts`); shared
  structural components receive resolved copy via props. RTL: own `lang`/`dir` from
  `uiDirection(locale)`, logical utilities only (`text-start`, `border-s`, `ms-*`/`me-*`).
- No numeric budget gate exists anymore, but run `pnpm build` before push (local-only
  floor, no CI).

---

## 8. Invariants & guard tests (must stay green)

- `catalogue-sha-guard` — no digest wording near Quran-byte paths; identity = id.
- Worker-only OPFS; deletes inside the worker message loop; temps untouched;
  `forgetTranslations` before delete.
- Arabic refusal `isArabicSourceId`; in-use guard main-thread.
- `eq-app-*` never deleted by user actions; purge keeps `eq-pack-*`/`eq-app-*`/OPFS
  (`auth-cache-purge.test.ts` pins this).
- `marketing-surface-guard.test.ts` — exact `await import(...)` strings in
  `MarketingTweaks.svelte` + `app/+layout.svelte` untouched; `loadCopy` contract; no
  paraglide in shared chrome. Re-read before touching `app/+layout.svelte`'s loader.
- `nav-guard.test.ts` — `publicHref(readerHrefFor(locale, "/app/settings"))` only.
- `opfs-cache` / `opfs-retention` / `quran-worker-validator*` / `offline-store` / `pack` /
  `keys` suites — additive exports only.
- `service-worker-data-cache` / `-api-bypass` / `-pending` — extend for `storageStats`.
- IDB `IDB_VERSION = 1` pinned, one-store-per-db — new metadata needs a **new**
  `easyquran-*` db name, never a store added to `easyquran-sw-meta`/`easyquran-quran`.
- Style gates: `pnpm check` (`--fail-on-warnings`), `pnpm lint` (`--deny-warnings`,
  no nested ternaries), `pnpm test`, `pnpm build`. `pnpm preview` (not dev) for the
  known dev-only `$state`-from-promise `$effect` regression (svelte 5.56.8 era).
- web/ stays comment-free; es-toolkit for utils; TanStack hotkeys wrapper only.

---

## 9. Test plan (new tests, per milestone)

1. `web/src/lib/workers/__tests__/artifact-admin.test.ts` — list join with lastUsed;
   delete refuses Arabic ids; refuses in-flight (`busy`); `forgetTranslations`-then-delete
   ordering; handle close.
2. `storage-report` store — fan-in, floor-at-0 residual math, boot-state gating.
3. `UsageBar` — a11y composed label, min-sliver math, token-only fills.
4. `app.html` literal-sync guard — font ids + translation-size bounds + existing fontSize
   bounds pinned to TS constants.
5. `reader-persistence` v3 — allowlist decode, bounds decode, version handling, `writeBlob`
   field round-trip (extend the existing suite's clamp cases).
6. `storageStats` SW handler — mirror of `service-worker-data-cache.test.ts`.
7. `lazy-sections.test.ts` — raw-source chunk guard (M1).
8. i18n namespace claims — auto-enforced by `pnpm i18n:check`.

---

## 10. Milestones

Each shippable; gates per milestone: `pnpm check && pnpm lint && pnpm test && pnpm build`
(+ `pnpm preview` where async `$effect` writes are involved).

- **M1 — Shell + i18n + Appearance.** Route (load-free), section nav, `settings` namespace
  (en/ar + claim + barrel + `settings-copy.ts`), `groups.ts` Settings(55) +
  `settings-routes.ts` palette source, Nav row, `?mode/?more` suppression,
  `lazy-sections.test.ts`, `formatBytes` hoist, prefs cross-tab wiring, Appearance section.
- **M2 — Storage listing (read-only).** Protocol `listArtifacts` + `StorageArtifactInfo`,
  worker handler + `readLastUsedMap` export, `worker-client` method, `storage-report` store
  with `whenReady` gating, translation rows + badges + last-used, persist status row,
  artifact-admin tests.
- **M3 — Delete flows.** `deleteArtifact` handler (Arabic/busy refusal, ordering), two-step
  inline confirm, in-use main-thread guard, remove-all-downloads, empty/OPFS-absent states,
  OfflinePack split (global bar vs card) + card relocation with copy props.
- **M4 — Usage viz + cache stats.** `storageStats` SW message + handler + tests,
  `UsageBar.svelte` + legend + threshold warnings + honesty footnote, clear-cached-pages
  action with no-controller fallback.
- **M5 — Fonts.** Registry + lazy font loads + two `@fontsource` deps, reader schema v3
  (decode version handling + `writeBlob` + `applyPersisted`), presentation vars + VerseRow
  fallback audit, `app.html` mirrors + literal-sync guard test, `changeTypography` remeasure,
  dead `geist` dep removal.
- **M6 — Account + Privacy + sync-readiness.** Thin account section, privacy section,
  `settings-document.ts` + tests, `Mod+,` hotkey.

---

## 11. Risks (accepted, with mitigations)

- **`app.html` literal drift** — mitigated by the literal-sync guard test (M5).
- **Delete-vs-download race** — worker loop serializes; same-id in-flight refused (`busy`);
  cross-tab worst case is a cheap re-fetch via the existing hedged fallback.
- **`estimate()` honesty** — per-layer numbers only from app records; residual floored,
  striped, labeled "other origin data"; Firefox under-report → hide residual when
  inconsistent.
- **Purge no-op without controller** — disabled-with-reason UI; window fallback gated to
  exactly that case.
- **Orphaned `data:*` IDB records** over-count SW stats until the next maintenance pass —
  approximate-bytes copy or trigger maintenance before reporting.
- **Virtualized height invalidation** on font family switch — routed through the existing
  `preserveViewport` remeasure path.
- **Chunk regression with no CI** — lazy-section guard test lands M1; `pnpm build` is a
  manual pre-push floor.
- **Multi-writer reader blob** — existing debounced last-write-wins window, now with a
  second writer; noted, not redesigned.

---

## 12. Delivery divergences (recorded after implementation)

Where shipped code departs from the sections above, current code wins; the reasons:

1. **Route is SSR, not prerendered.** §1 assumed a load-free prerendered page. Reality:
   `app/+layout.server.ts` has a server load that cascades, so a prerendered settings page
   emits `/app/settings/__data.json` and `gen-offline-pack.ts` throws on the `/app/` prefix.
   Shipped: `+page.ts` with `export const prerender = false` (SSR, same delivery class as
   the translated reader routes — consistent with the project's standing divergence away
   from SSG for app routes). Page itself stays load-free.
2. **Localized settings URLs do not exist.** The plan's "hooks reroute already matches
   `settings`" claim is true of the pattern but `hooks.server.ts` 404s non-canonical reader
   locales and `parseReaderPath("/app/settings")` is null, so `/{en,ar}/app/settings` is not
   published. All entries (Nav row, palette, `Mod+,`) use canonical `/app/settings`; the
   shared locale switcher falls back to the localized reader home while on settings.
3. **`?mode=`/`?more=` suppression** gates on `page.route.id` ending `/app/settings`, not
   `routeContextFromParams` presence (the latter always returns a context and would also
   suppress `?mode=` sync on `/app` home).
4. **Palette/Nav labels stay English** (hardcoded-label precedent in palette sources and
   Nav chrome copy injection); localizing palette entries remains a separate product
   decision. Palette hrefs use the canonical generated `Pathname` — `resolveHref()` already
   applies the base, so wrapping in `publicHref` would double-prefix.
5. **`OfflinePackCopy` lives in `offline-pack-copy.ts`**, not the component's module script —
   oxlint cannot resolve type exports from `.svelte` module scripts (svelte-check can). The
   global overlay sibling is `OfflinePackBar.svelte` (the plan's `DownloadBar` name was
   already taken by the Quran-scripts downloader).
6. **`translationFamily` is session-only** (ReaderState, not Persisted) per §3.3's field
   list — it survives navigation but resets to sans on reload. Persisting it means schema
   v4.
7. **SW pages stats measure `eq-pages-v1` directly** (cache keys + bodies), not the recency
   map — recency also holds shell-hit keys absent from the cache and carries no byte sizes;
   cache-direct is the same accounting `trimPages` itself uses.
8. **Worker admin handlers are test-exposed via `__artifactAdminTestHooks`** (following the
   existing `assertStaged*` precedent): driving the real message loop in vitest would
   require a full wasm-sqlite boot of every planned Arabic source. The handlers themselves
   are thin compositions over the tested `listCachedArtifacts`/`deleteCachedArtifact` path.
9. **`reader.svelte.ts` gained additive passthroughs** (`arabicFont`, `translationSizePx`,
   `translationFamily`) so `ReadingSection`/`SettingsDoc` can reach the new axes through the
   existing `ReaderApi` — no logic moved.
10. **Font re-registration on boot:** `applyReaderPresentation` calls `loadArabicFont` for
    non-default fonts on every apply (hydrate + cross-tab re-apply), so a persisted
    Scheherazade/Noto selection survives reloads. First paint still shows Amiri until the
    lazy woff2 lands — inherent to keeping alternate mushaf bytes out of the bundle.
11. **No pre-paint arabicFont mirror in `app.html`.** The font-id allowlist mirror that
    briefly shipped there was removed as dead code: the `data-arabic-font` write was
    unconsumed by CSS, alternate-font bytes lazy-load at hydrate, and
    `applyReaderPresentation` owns the `data-arabic-font` and `--reader-arabic-family`
    writes (§3.2 already attributes the dataset to it). First paint is Amiri as in
    divergence 10, and the literal-sync guard (`reader-fonts.test.ts`) pins the mirror's
    absence — no `arabicFont` string, no `--reader-arabic-family`, no font-id literals in
    `app.html` — alongside the `translationSize`/`fontSize` bounds it still mirrors.
12. **Byte-unit wording.** `formatBytes` keeps Latin unit symbols (MB/GB) in the Arabic UI —
    unit symbols are standard in Arabic technical copy and match the ICU `{entries}` Latin
    digits used elsewhere; catalog prose keeps Arabic-script units (ميغابايت).
13. **The purge no-controller window fallback (§2.5) was dropped.** "Clear cached pages &
    data" stays a worker-message-only path (`purgeUserCaches()`); when
    `navigator.serviceWorker.controller === null` the button renders permanently disabled
    with the unavailable reason instead of falling back to a window-side
    `caches.delete("eq-pages-v1"/"eq-data-v1")`. Rationale: duplicating the cache-name list
    on the main thread is a second source of truth for what user action may delete, and the
    no-controller state is session-transient (first claimed load ends it). §11's "window
    fallback gated to exactly that case" risk note is therefore resolved by the disabled UI
    alone.
14. **§9 item 7's `lazy-sections.test.ts` raw-source chunk guard shipped as
    `route-isolation.test.ts` with the opposite chunk contract:** test 2 pins that
    `+page.svelte` statically imports all five sections (one settings chunk, no per-section
    loaders), and the chunk-regression mitigation named in §11 is a raw-source ban on static
    heavy-package imports (bits-ui, `@fontsource/*` files, chart libs, d3, echarts, three)
    across the settings route tree — dynamic `await import(...)` remains allowed. Raw-source
    pins also cover the delete-flow contracts the plan left untested: Escape
    `stopPropagation` in the row confirm, exactly one polite announcer in the row, the
    arabic/busy/error outcome copy mapping, `result.failures` surfacing in remove-all, and
    the `readerSource.sourceId` + `stackedTranslations.ids` in-use join.
15. **§5's "app version" row displays no version number.** The row surfaces the existing
    `UpdateStore` (up-to-date / update-available status plus "Check for updates"), but there
    is no version string to show: `UpdateStore` exposes only booleans, SvelteKit's `updated`
    state carries no version, and the offline manifest's optional `appVersion` is the pack's
    manifest version — absent whenever no pack is staged, and not the app build's version.
    Surfacing a real build version needs new build-time plumbing (injecting a version
    constant into the bundle), deferred until such a constant exists; the row's substantive
    intent — surfacing `UpdateStore` — is fully shipped.
