# EasyQuran — Settings system

Canonical contract for shipped settings behavior. Settings is device-first, auth-neutral, and
fully usable while signed out. Server preference sync is prepared but not implemented.

[`quran-system.md`](./quran-system.md) owns Quran artifact integrity and shared cache/auth
boundaries. This document owns settings routing, storage administration, presentation state,
privacy/account surfaces, and sync-ready settings serialization.

---

## 1. Route and entry points

- Settings lives at canonical `/app/settings` under existing app shell.
- Route uses `+page.ts` with `prerender = false`. Parent server load would otherwise emit an
  `/app/settings/__data.json` artifact rejected by offline-pack generation.
- Localized settings URLs do not exist. `/en/app/settings` and `/ar/app/settings` are not reader
  routes; locale switcher falls back to localized reader home while settings is open.
- Settings is excluded from sitemap.
- Page remains load-free and auth-neutral; storage/user state hydrates after mount.
- Reader `?mode=` and `?more=` mirroring is suppressed by settings route id, preventing reader
  state from polluting settings URL.

Entry points:

- Nav settings row.
- Lazy command-palette settings source.
- `Mod+,` hotkey registered from a client-only Svelte effect through dynamically imported
  `$lib/hotkeys.svelte`; callback keeps IME composition guard and unregisters on cleanup.

All entries use canonical generated navigation helpers. No component hand-builds `/app/` URLs.

Settings route is one SvelteKit chunk. Section components import statically inside route tree;
raw-source route-isolation tests ban static heavy libraries such as chart packages, bits-ui,
Three.js, and font files. Lazy `await import(...)` remains allowed.

---

## 2. Sections

Settings exposes five surfaces:

1. Storage.
2. Appearance.
3. Reading and fonts.
4. Privacy.
5. Account.

Tweaks remains a quick panel elsewhere in app. It binds the same singleton stores, so panel and
settings route cannot diverge.

---

## 3. Storage administration

Quran artifact inspection and deletion stay worker-owned. Main thread never opens or mutates
OPFS/IDB Quran storage directly.

Worker protocol:

- `listArtifacts` returns `{ id, store, tag, sizeBytes, lastUsed }` records.
- `deleteArtifact` accepts one translation source id.
- `worker-client.ts` exposes typed list/delete methods.

Display metadata joins baked Quran catalogue by id. Remote metadata and raw catalogue tuple
indices never choose a file or label.

### Delete contract

Worker serializes deletion with other Quran operations:

1. Reject Arabic source ids as required reading data.
2. Reject same-id in-flight download with typed `busy` error.
3. Forget translation runner/cached-id/search-corpus state.
4. Delete validated artifact and its recency record.

Temporary staging files remain boot-sweep owned and are never deleted by settings. UI disables
rows currently used as primary or stacked reader sources. Worker remains authoritative for
Arabic/busy refusal. Cross-tab delete can force another tab to re-fetch; existing API/local
fallback makes this recoverable.

Deletion UI uses inline two-step confirmation. Escape cancels confirmation without closing its
parent surface; focus returns to original action. Remove-all skips Arabic and in-use sources,
surfaces partial failures, then re-reads worker truth instead of trusting optimistic state.

### Storage report

`storage-report.svelte.ts` combines:

- Worker artifact list and per-artifact bytes.
- Offline-pack state.
- Service-worker page/data cache counts and bytes.
- Browser quota/usage estimate.
- Persistent-storage permission state.

Initial listing waits for worker readiness and refreshes after download events and mutations.

Inline SVG usage bar reports app-owned layers plus optional “other origin data” residual:

- Quran DBs, visually separating required Arabic and downloaded translations.
- Offline pack.
- Service-worker page cache.
- Service-worker data cache.
- `max(0, browser usage − known app layers)` when browser estimate is consistent.

Per-layer bytes come from app records, never inferred from `navigator.storage.estimate()` deltas.
Unsupported or inconsistent browser estimates hide misleading aggregate/residual UI while item
rows remain usable. Legend duplicates all visual information as text.

### Cache actions

- “Clear cached pages & data” uses service-worker `purgeUserCaches()` with acknowledgement.
- When no controlling service worker exists, action stays disabled. Main thread has no duplicate
  `caches.delete` fallback or cache-name list.
- User action never deletes `eq-app-*`, offline pack, or OPFS Quran data.
- Arabic artifacts are read-only/non-removable.
- Translation retention remains automatic after 30 inactive days or above 256 MiB.

Offline pack is split into global progress overlay and reusable settings card. Shared byte
formatting and copy are centralized.

---

## 4. Reading and fonts

`web/src/lib/config/reader-fonts.ts` owns Arabic font registry and allowlist:

- Amiri is default and already shipped.
- Scheherazade New and Noto Naskh Arabic load lazily on first selection through `FontFace` and
  URL imports.
- Alternate Quran font bytes never enter marketing bundle or offline pack.
- Translation family toggle uses system sans/serif stacks and no font download.

Reader presentation uses HTML-level variables for Arabic family, translation size, and
translation family. Font-family changes route through virtualized-reader typography remeasure
and viewport preservation. Arabic Quran fonts remain gated to Arabic source content.

Persisted reader schema v3 includes:

- `arabicFont`, allowlisted by registry; default `amiri`.
- `translationSize`, integer 13–28 px; default 17 px.

Decode accepts known fields, bounds values, and tolerates future schemas by reading supported
fields only. Whole-blob writes include both fields; presentation applies after hydration.

`app.html` mirrors translation/font-size bounds for pre-paint stability. It deliberately does
not mirror `arabicFont`: alternate font bytes load after hydration, `applyReaderPresentation`
owns font dataset/CSS-variable writes, and first paint remains Amiri. Tests pin this absence and
the mirrored numeric bounds.

`translationFamily` is session-only. It survives navigation but resets to sans on reload;
persisting it requires schema v4.

Reader blob remains whole-record, debounced, last-write-wins across tabs. Storage events reduce
the collision window but do not eliminate interleaved field loss.

---

## 5. Appearance

Appearance binds existing `prefs` singleton:

- Theme.
- Surface.
- Accent and custom seed.
- Copy CSS.
- Reset.

Cross-tab `easyquran.prefs` changes hydrate and apply atomically. Existing custom-accent reset
semantics remain. Tweaks stays behaviorally aligned because both surfaces share store/setters.

System theme, app-level reduced motion, and UI font scaling remain deferred; each needs
pre-paint support to avoid flash or split state.

---

## 6. Privacy and account

Privacy exposes existing stores/services rather than creating parallel state:

- Analytics and performance consent.
- Performance-consent reload warning.
- Notification status.
- Update status and manual update check.
- Informational device-local sync status.
- Authenticated sign-out through existing logout/purge flow.

Update row does not display a build version because runtime update state exposes booleans only.
Offline-pack manifest version is not application build identity.

Account stays intentionally thin:

- Signed-in: name/email summary plus deep link to `/account`.
- Signed-out: device-local explanation plus existing auth-modal trigger.
- `/account` continues owning profile edit, sessions, TOTP, and passkeys.

Unsupported settings remain absent: avatar update, email change, password change, account
deletion, OAuth identity management, and passkey-label rename. Each needs backend/security work
before UI.

---

## 7. Sync readiness

`web/src/lib/settings/settings-document.ts` defines versioned, I/O-free serialization:

- `SETTINGS_DOC_VERSION = 1`.
- Appearance derives from `prefs.current`.
- Reading includes font size, mode, Arabic font, and translation size.
- Privacy derives from consent state.
- Unknown fields survive; missing known fields default safely.

`toSettingsDoc()` snapshots current stores. `applySettingsDoc()` uses existing setters, then
applies prefs and reader presentation so DOM and stored state agree.

No server sync endpoint or migration exists. Future sync needs new user-preferences storage and
an explicit server-vs-local precedence rule. Sign-out does not clear device-scoped appearance or
typography.

---

## 8. i18n and accessibility

- Settings copy uses `settings_*` keys in English and Arabic catalogues, registered under one
  lazy `settings` namespace.
- Shared components receive copy through props and never import global Paraglide barrel.
- Offline-pack and notification copy touched by settings use shared typed copy models.
- RTL uses logical layout utilities; page language/direction follows current UI context.
- Usage visualization has text-equivalent legend and composed accessible title.
- Destructive confirmations manage focus, announce outcomes politely, and surface typed errors.

---

## 9. Required guards

Settings changes preserve:

- Quran catalogue no-hash and immutable-artifact guards.
- Worker-only artifact deletion, Arabic refusal, and temp-file ownership.
- Auth-cache purge exclusions for app shell, offline pack, and OPFS.
- Reader navigation/context guard.
- Message namespace and shared-chrome import guards.
- Reader schema decode/write/apply tests and `app.html` literal-sync tests.
- Settings route-isolation and delete-flow source guards.
- Service-worker storage-stat and API-bypass tests.
- TanStack Hotkeys dynamic-import contract.
- `pnpm check`, `pnpm lint`, `pnpm test`, and production build.

---

## 10. Known limits

- Cross-tab artifact deletion may trigger recoverable re-download.
- Browser quota estimates can under-report OPFS; owned per-item byte counts remain authority.
- Service-worker metadata may temporarily include orphaned data records until maintenance.
- Reader persisted blob still has a multi-writer last-write-wins window.
- Alternate Arabic font first paint uses Amiri until lazy font finishes loading.
- Translation family is not persisted.
- Real application build-version display needs new build-time plumbing.
- Server preference sync has no storage, endpoint, or conflict policy yet.
