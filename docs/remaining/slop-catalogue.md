# Slop catalogue

Verified de-sloppification backlog. Produced 2026-08-21 by a multi-agent audit in which every
finding was independently re-verified against router wiring, migrations, the web client's actual
API calls, deploy env, and the guard tests before being accepted. Items here are confirmed real
and safe to execute unless marked otherwise.

Scope: backend slop leaks, web dead code, and duplication refactors. The same audit identified
three large dead backend clusters (billing, blog/CMS, seed+TUI); the owner tracks those out of
band and they are deliberately excluded from this catalogue.

Conventions: LOC figures are estimates. Line numbers were accurate at audit time and will drift.

## Backend slop leaks

### S01 — Public surfaces still speak ruxlog

The API is a ruxlog clone and three spots leak that identity:

- `rust/backend/api/src/router.rs` (robots handler, ~line 222): public `/robots.txt` advertises
  `ruxlog.com`.
- `rust/backend/api/src/config/settings.rs:219`: `SITE_NAME` defaults to `"Ruxlog"` when the env
  var is unset.
- `rust/backend/api/src/utils/cors.rs` (`dev_default_origins`): embeds a specific developer's LAN
  IPs as dev CORS defaults. The one-line test at ~line 532 rides along with the fix.

Fix: replace with easyquran identity (or neutral values), remove the LAN IPs. ~60 LOC touched,
risk low. Nothing in docs or guards pins these values.

## Web dead code

### S02 — Dead vendored shadcn-svelte sidebar family (~390 LOC)

`web/src/lib/components/ui/sidebar/` exports ~30 symbols; the only three consumers
(`_reader/Sidebar.svelte`, `_reader/ReaderShell.svelte`, `_reader/TranslationPicker.svelte`) import
12. Dead: `SidebarGroupAction`, `SidebarGroupLabel`, `SidebarInput`, `SidebarMenuAction`,
`SidebarMenuBadge`, `SidebarMenuSkeleton`, `SidebarMenuSub`, `SidebarMenuSubButton`,
`SidebarMenuSubItem`, `SidebarRail`, `SidebarSeparator` (11 files + barrel trims, ~390 LOC).
Internal-import map verified: no live sidebar file imports a dead one (`skeleton.svelte`'s only
importer is the dead `sidebar-menu-skeleton.svelte`; `separator.svelte`'s only importer is the dead
`sidebar-separator.svelte`). `web/components.json` confirms shadcn-svelte is vendored/CLI-re-addable,
so deletion loses nothing.

### S03 — Dead first-party components: Chip, Pulse, StatusDot, Section (~87 LOC)

`web/src/lib/components/{chip,status,layout}/` — zero references anywhere in `web/`, including the
design showcase route and every root-barrel importer. `Container` in the same family IS live
(11 route/layout files) and stays.

### S04 — Dead sheet pair: SheetClose, SheetFooter (~27 LOC)

**Not** SheetDescription — it is live via the namespace import
(`import * as Sheet from ".../ui/sheet/index.js"` renders `<Sheet.Description>` as the mobile
sidebar's sr-only description at
`web/src/lib/components/ui/sidebar/sidebar.svelte:52`). Deleting it breaks `pnpm check`. Only
`sheet-close.svelte` (7 LOC) and `sheet-footer.svelte` (20 LOC) are unreferenced.
Lesson for any dead-component sweep: named-symbol grep is not enough — enumerate namespace-member
usage (`Sheet.Description`, `Cmd.Separator`) too.

### S05 — Dead `lib/hooks/` directory (~10 LOC)

`web/src/lib/hooks/is-mobile.svelte.ts` is the only file in the directory; `IsMobile`/`is-mobile`
have zero references. (An earlier audit round also claimed `stores/reader-context.svelte.ts` here —
that file does not exist; claim dropped.)

### S06 — reader-copy.ts: three fully dead copy groups + strays (~95 LOC)

~31 resolved keys with zero consumers repo-wide: the entire `offline` group (label, packReady,
preparingPack, downloadingPack, stagingPack, downloadFailed, download, remove, working, routes,
savedOn, storage, preparingQuran), the entire `notifications` group (title, enable, disable,
blocked, unsupported, unavailable), and strays. Deleting these removes ~1/4 of the resolver body
in `web/src/lib/i18n/reader-copy.ts` — do this before judging any further resolver refactor (see
"Refuted / intentional").

### S07 — Dead storage exports: `removeJSON`, `asNullableObject` (~14 LOC)

`web/src/lib/storage/safe-storage.ts:22-27` and `web/src/lib/storage/decoders.ts:50-55` are
referenced only by the barrel and their own unit tests. While there: `engagement-state.ts:14`
imports `asNumberRecord` directly because the barrel does not export it — exporting it fixes the
inconsistency.

### S08 — `VerseRow` `isTranslation` prop is dead (~5 LOC)

Never passed by any caller.

### S09 — `Sidebar.browseLabel()`: four-case switch, every arm identical (~12 LOC)

`web/src/routes/(application)/app/_reader/Sidebar.svelte` — collapse to the single expression.

### S10 — Four range-route `+page.svelte` wrappers duplicate the shared page shape (~75 LOC)

The surah family already solved this with a shared wrapper; the range routes (juz/page families
under `web/src/routes/(application)/app/`) each hand-roll the same shape. Consolidate the same way.
Verified against all three hard guards (nav-guard raw-source scan unaffected; `+page.server.ts`
untouched; SSR/prerender divergence lives server-side per docs/quran-system.md Part 5).

### S11 — Prev/next nav markup duplicated between RangeReader and ReaderPageNav (~35 LOC)

Plus twin `$derived`s inside `ReaderPageNav`. Extract one component.

### S12 — Test helpers duplicated across the three `_reader` suites (~30 LOC)

`surah-reader.test.ts` / `stacked-translations.orchestration.test.ts` / `range-reader.test.ts`.
Constraint: helpers must stay import-light — `surah-reader.test` breaks on a transitive `site.ts`
import.

## Rust duplication

### R01 — Four OAuth controllers are one pipeline copy-pasted (~900 LOC)

`google_auth_v1` / `github_auth_v1` / `facebook_auth_v1` / `apple_auth_v1` controllers repeat the
same skeleton with provider names swapped: state cookie handling, callback flow, error mapping,
user upsert, session issuance. Genuine per-provider differences to preserve: Apple id_token JWT
verification, GitHub profile fetch shape, PKCE presence. A single generic pipeline (trait or
enum-dispatch) collapses them. Risk medium — auth surface; the provider test suite
(`tests/auth_rotation_header.rs` etc.) pins behavior.

### R02 — auth_v1/controller.rs: ban-check, TOTP replay-gate, backup-code consume, login-success blocks repeated 2-3× (~110 LOC)

`rust/backend/api/src/modules/auth_v1/controller.rs` (1411 LOC). Extract helpers.

### R03 — CallbackQuery validators: four copies of the same struct + impl (~220 LOC)

Only the optional error-field names differ across the provider modules. One shared validator.

### R04 — reqwest client builder duplicated 7×; streaming size-capped body reader duplicated 4× (~130 LOC)

Consolidation side benefit: Google's JWKS fetch (`google_auth_v1/service.rs:308`, `resp.bytes()`)
is the one provider HTTP read WITHOUT a streaming size cap — the shared capped reader closes it.

### R05 — JWKS fetch+cache duplicated between Google and Apple services (~50 LOC)

`google_auth_v1/service.rs` and `apple_auth_v1/service.rs` hand-roll the same fetch+cache.
(Their caps differ today — see R04.)

### R06 — Duplicated OAuth tests (~50 LOC)

Session-rotation-header test ×4 providers; native-origin test duplicated across modules. One
parameterized suite.

### R07 — settings.rs test env save/restore ceremony repeated 42× (~200 LOC)

`rust/backend/api/src/config/settings.rs` in-file tests: each repeats
`let snap = snapshot_env(); clear_env_vars(); ... restore_env(snap);` (42 call sites; the
`EnvSnapshot` helper has 9 fields). A guard object (Drop-based restore) removes the ceremony.
The ~30 non-test `std::env::var(X).unwrap_or_else(|_| "...".to_string())` sites collapse behind a
`var_or(key, default)` helper.

### R08 — router.rs rate-limit wiring: 16 repetitive `.nest(...).layer(rate_limit_layer(...))` sites (~35 LOC)

`rust/backend/api/src/router.rs` — table-driven nest+limit pairs. Keep the per-route bucket
semantics (PathKey::Matched) exactly; the rate-limit middleware test pins them.

### R09 — TranslationPool: verbatim cold-build init closure duplicated between get_or_build and warm (~70 LOC)

`rust/backend/api/src/quran/translation_pool.rs` (1018 LOC), plus 3 copies of a related helper
nearby.

### R10 — Dead scaffolding surface in rux-auth and rux-request-gate (~140 LOC)

No-op `AuthGuard` layer and the unused gate `IpSource` family. **Keep `NoHooks`** — abuse tests
construct it (`services/abuse.rs:216,225,230`).

### R11 — Small dead/dup cluster in utils (~60 LOC)

`parse_env_u64` identical to `env_u64`; telemetry's `env_u64` near-copy; 3 leftover DEBUG
endpoints.

## Web duplication

### W01 — Response-failure classification ladder duplicated 9× in flows (~80 LOC)

The same `status === 0 → network / 403-or-verified-only → classifyAuthError` ladder is hand-rolled
at `web/src/lib/auth/flows.svelte.ts:388-399, 424-441, 664-672, 714-727, 759-774, 498-512,
537-548, 590-601` and `passkey-flow.svelte.ts:291-298, 343-350` (~117 ladder lines total).
One helper. Constraint: preserve `ForgotPassword.request`'s anti-enumeration else-branch
(`flows.svelte.ts:508-511`) as an explicit option.

### W02 — pending/try/catch/finally submit envelope copy-pasted across 14 flow methods (~60 LOC)

Same `web/src/lib/auth/flows.svelte.ts`. One wrapper.

### W03 — TOTP challenge step duplicated wholesale in SignInForm and RegisterForm (~55 LOC)

`web/src/routes/(auth)/` components. Extraction needs an `oncancel` callback — RegisterForm's
`cancelTotp` additionally resets `flow.step` (`RegisterForm.svelte:73`).

### W04 — TanStack form field snippet boilerplate ×15 across 5 files (~70 LOC)

Auth forms. A small field-helper collapses them.

### W05 — Dead auth exports (~25 LOC)

9 schema type aliases, `twoFactorPending` getter, test-only helpers, unread `PasskeyInfo` fields.

### W06 — Three hand-rolled IndexedDB cursor-scan loops (~45 LOC)

`web/src/lib/workers/opfs-cache.ts:199-223` (`readAllPointers`), `opfs-cache.ts:483-503`
(`listIdbArtifacts`), `opfs-retention.ts:30-44` (`readLastUsedMap`) share the identical
tx/openCursor/continue skeleton (~28 lines each). `web/src/lib/workers/idb.ts` already has the
helper precedent — extend it.

### W07 — `createOpfsStore` dead in prod and tests (~34 LOC)

`web/src/lib/workers/`.

### W08 — `quran.ts` re-export block = second front door for `quran-types.ts` (~30 LOC)

~20 types + 6 consts re-exported; 54 files import via `$lib/data/quran`, 62 via
`$lib/data/quran-types` (some import both in one file). Consolidating onto one door is a 54-file
codemod for ~30 LOC — low priority; skip unless touching those files anyway. Helpers
(`surah*For`, `routeContextFromParams`, …) stay exported from `quran.ts` regardless — the
nav-guard test imports them from there.

### W09 — Dead lines in flows.svelte.ts (~2 LOC)

`const token = this.#totpToken; void token;` at `flows.svelte.ts:242-244` (keep the null
assignment after it).

## Decisions recorded (2026-08-21)

| Item | Decision |
| --- | --- |
| `notification_v1` + `services/notification` (~310 LOC; zero callers, sole writer is its own admin endpoint) | **Keep** — cross-device sync is the next milestone; in-app notifications plausibly ride it. |
| `admin_route_v1` + `admin_acl_v1` + `acl_service` (~940 LOC; undocumented, cache never read) | **Keep** — owner's call. |
| Four provider `/auth/{p}/v1/user` endpoints (~35 LOC; zero repo references) | **Keep** — an out-of-repo mobile client may call them (see `deploy/.env.example` native sign-in). |
| Google auth legacy paths | **Delete `authenticate_oauth` only** (`services/auth.rs:187-222`, zero callers, safe). The `users.google_id` (encrypted) vs `user_oauth_identity` (plaintext) split stays until a deliberate security-architecture pass. |

## Refuted / intentional — do not "fix"

- **Session-establishment tail** ("CSRF refresh + decode + transition + setUser repeated with
  drift"): not drift. Documented three-layer design — `docs/quran-system.md:227`, header-driven
  CSRF auto-refresh in `auth-client.ts:213-222`, and rust `rotate_session_after_trust_change`
  returning `Ok(false)` only when the session was NOT rotated. A unified `completeLogin()` adding
  the `!rotated` fallback to 2FA flows would change behavior for no gain.
- **Fake-IndexedDB test doubles**: consolidating them is not possible as proposed — two of the
  three files use different mechanisms (a module-boundary `vi.mock` of `lib/workers/idb`, whose
  comment explains happy-dom has no persistent IndexedDB), and mocking the module under its own
  test makes that suite vacuous.
- **reader-copy.ts resolver "table-driven" rewrite**: the proposed signature-derived binder does
  not typecheck — paraglide message fns take a single object input while every call site calls
  positionally (`copy.seo.pageTitle(i,f,l)`), so positional adapters are irreducible. Per-message
  function imports are also load-bearing for the i18n per-page gzip budget. Revisit only after S06
  and only with a design that keeps positional call sites and tree-shaking.
- **`tafsirFor` placeholder copy** ("Sample commentary…" shipping in prod UI): tracked as roadmap
  item R05 in `docs/remaining/feature-gap-catalogue.md` and C03 in `copy-corrections.md` — a
  product feature gap, not slop. Do not delete the slot here.

## Execution notes

- Gates after every batch: `pnpm check`, `pnpm lint`, `pnpm test` (all three must stay green;
  lint and check are `--deny-warnings` / `--fail-on-warnings`), plus `pnpm build` before push —
  the postbuild i18n-budget + offline-pack steps are not covered by the trio.
- Rust formatting: scope with `rustfmt --edition 2021 <files>` — never bare `cargo fmt`
  (reformats the whole package, ~45-file diff pollution).
- Sequencing: S06 before any reader-copy refactor; S02's internal-import map means the sidebar
  family deletes as a unit.
- Dead-component sweeps must grep namespace-member usage, not just named imports (see S04).
- No machine guard (nav-guard, catalogue-sha-guard, `tests/quran_v1.rs`) is touched by anything
  in this catalogue.
