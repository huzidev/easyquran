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

The API is a ruxlog clone (admitted at `rust/backend/api/AGENTS.md:3`) and five spots leak that
identity:

- `rust/backend/api/src/router.rs:222-230`: public `/robots.txt` advertises
  `Sitemap: https://ruxlog.com/sitemap.xml`.
- `rust/backend/api/src/config/settings.rs:219`: `SITE_NAME` defaults to `"Ruxlog"` when the env
  var is unset; `settings.rs:221` in the same fn defaults `consumer_site_url` to
  `https://ruxlog.com`.
- `rust/backend/api/src/modules/auth_v1/controller.rs:495`: "Ruxlog" hardcoded as the TOTP issuer
  in the otpauth URL users see when enabling 2FA — live module, most user-visible of the five.
- `rust/backend/api/src/utils/cors.rs:159-182` (`dev_default_origins`): embeds a specific
  developer's LAN IPs (192.168.0.101, 192.168.0.23) as dev CORS defaults.

Fix: replace with easyquran identity (or neutral values), remove the LAN IPs. Two in-file unit
tests pin the current values and must ride along: `cors.rs:519-538`
(`build_non_production_includes_dev_defaults_and_lan`, asserts the LAN IP at :532) and
`settings.rs:846-858` (`site_settings_defaults`, asserts `"Ruxlog"` and `ruxlog.com` at :857-858).
Risk low. No named machine guard pins these values.

## Web dead code

### S02 — Dead vendored shadcn-svelte sidebar family (~390 LOC)

`web/src/lib/components/ui/sidebar/` exports 24 distinct symbols (23 components + `useSidebar`,
under 47 export names including aliases); the only three consumers
(`_reader/Sidebar.svelte`, `_reader/ReaderShell.svelte`, `_reader/TranslationPicker.svelte`) import
12. Dead: `SidebarGroupAction`, `SidebarGroupLabel`, `SidebarInput`, `SidebarMenuAction`,
`SidebarMenuBadge`, `SidebarMenuSkeleton`, `SidebarMenuSub`, `SidebarMenuSubButton`,
`SidebarMenuSubItem`, `SidebarRail`, `SidebarSeparator` (11 files + barrel trims, ~356 LOC).
Internal-import map verified: no live sidebar file imports a dead one. Deleting the 11 files also
orphans `ui/skeleton/` and `ui/separator/` — their sole importers anywhere are the dead
`sidebar-menu-skeleton.svelte` and `sidebar-separator.svelte` — so those two dirs (barrel +
component each, ~30 LOC) are part of the same unit delete, bringing the total to ~386.
`web/components.json` confirms shadcn-svelte is vendored/CLI-re-addable, so deletion loses nothing.

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

### S06 — reader-copy.ts: three fully dead copy groups + strays (39 keys, ~110 LOC)

39 resolved keys with zero consumers repo-wide (verified by key-name grep; `copy.offline`,
`copy.notifications`, `copy.update` appear nowhere, and only `copy.nav`/`copy.footer` are ever
passed whole):

- the entire `offline` group (13 keys: label, packReady, preparingPack, downloadingPack,
  stagingPack, downloadFailed, download, remove, working, routes, savedOn, storage,
  preparingQuran) — `reader-copy.ts:275-289` interface / `:516-530` resolver;
- the entire `notifications` group (14 keys: title, enable, disable, blocked, unsupported,
  unavailable + checking, browserUnsupported, blockedDetail, on, offUpdates, off, dismiss, open)
  — `:290-305` / `:531-546`;
- the entire `update` group (ready, reloadDescription, reloadOpenTabs, dismiss) — `:306-311` /
  `:547-552`;
- 8 strays: `sidebar.navigationDescription`, `sidebar.pageAbbreviation`, `sidebar.juzLabel`,
  `range.juz`, `range.page`, `range.pageAbbreviation`, `nav.sidebarTitle` (the neighboring
  `sidebarToggle` IS live), `seo.quran`.

Deleting these removes ~1/4 of the resolver body in `web/src/lib/i18n/reader-copy.ts` — do this
before judging any further resolver refactor (see "Refuted / intentional").

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

Builder sites: `state.rs:17`, `services/oauth/mod.rs:24`, `google_auth_v1/controller.rs:40`,
`github_auth_v1/controller.rs:43`, `facebook_auth_v1/controller.rs:41`,
`google_auth_v1/service.rs:290`, `apple_auth_v1/service.rs:321` (same tuning family:
redirect-none + 5s connect + 15s total + 30s pool idle). Capped-reader sites:
`google_auth_v1/controller.rs:460-481`, `github_auth_v1/controller.rs:454-475`,
`facebook_auth_v1/controller.rs:380-401`, `apple_auth_v1/service.rs:365-387` (all 64KB caps).
Consolidation side benefit: TWO provider reads lack a streaming cap — Google's JWKS fetch
(`google_auth_v1/service.rs:308`, `resp.bytes()`) and Apple's token-exchange response
(`apple_auth_v1/service.rs:214,221`, `resp.text()`/`resp.json()`, bounded only by the 15s client
timeout). The shared capped reader closes both.

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

### R08 — router.rs rate-limit wiring: 16 sites, 14 of them nest-shaped (~55 LOC)

`rust/backend/api/src/router.rs` has 16 `rate_limit::rate_limit_layer` sites; 14 match the
`.nest(...).layer(rate_limit_layer(&state, N, 60))` shape and collapse into a table. The other 2
are route-level (`/sitemap.xml` at :55, `/csrf/v1/generate` at :59) — leave hand-rolled or give
the table a second row shape. Keep the per-route bucket semantics (`PathKey::Matched`,
`middlewares/rate_limit.rs:24`) exactly; the
`nest_level_limiter_keys_buckets_per_matched_route` test at `rate_limit.rs:393` pins them.

### R09 — TranslationPool: verbatim cold-build init closure duplicated between get_or_build and warm (~70 LOC)

`rust/backend/api/src/quran/translation_pool.rs` (1018 LOC), plus 3 copies of a related helper
nearby.

### R10 — Dead scaffolding surface in rux-auth and rux-request-gate (~130 LOC)

Two pieces: (1) the no-op `AuthGuard` layer (`crates/rux-auth/src/middleware/guard.rs:62-70`
discards its requirements; `AuthGuardLayer`/`auth_guard()`/`auth_guard_fn` have zero constructors)
— **keep `check_requirements` in the same file (:77-132), it is live** (used by
`src/middlewares/auth_guard.rs` and `admin_bans_v1/controller.rs`); delete the layer, not the
file. (2) the unused gate `IpSource` family (`crates/rux-request-gate/src/ip.rs`: `IpSource`,
`ClientIpSource`, `FnIpSource` + 3 tests) — the live `IdentitySource` family is a different,
kept abstraction. Name-collision trap: `ClientIpSource` also exists as the live
`axum_client_ip` type used in `config/settings.rs` and `middlewares/` — greps must be
import-qualified. **Keep `NoHooks`** — abuse tests construct it
(`crates/rux-request-gate/src/abuse.rs:216,225,230`).

### R11 — Small dead/dup cluster in config/telemetry (~21 LOC)

`parse_env_u64` (`src/config/env.rs:45-50`) is identical to `env_u64` (`env.rs:17-22`; only
callers of the former are `main.rs:41,42`); `src/utils/telemetry.rs:36-41` carries an `env_u64`
near-copy; and `telemetry.rs` has 3 leftover `DEBUG:` `eprintln!` statements (~:121-124, 175-178,
207 — debug prints, not HTTP endpoints).

## Web duplication

### W01 — Response-failure classification ladder duplicated 10× (~80 LOC)

The same `status === 0 → network / 403-or-verified-only → classifyAuthError` ladder is hand-rolled
at 8 sites in `web/src/lib/auth/flows.svelte.ts` (`:388-399` resend, `:424-441` verify,
`:498-512` forgot-request, `:537-548` verifyCode, `:590-601` reset, `:664-672` 2FA setup,
`:714-727` 2FA verify, `:759-774` 2FA disable) and 2 in `passkey-flow.svelte.ts`
(`:291-298`, `:343-350`) — ~124 ladder lines total. One helper. Constraint: preserve
`ForgotPassword.request`'s anti-enumeration else-branch (`flows.svelte.ts:508-511`) as an
explicit option. (`LoginFlow`/`RegisterFlow` already use the extracted `credentialFailure`
helper at `flows.svelte.ts:89-104` — model the new one on it.)

### W02 — pending/try/catch/finally submit envelope copy-pasted across 12 methods in flows (~60 LOC)

The `if (this.pending) return false; this.pending = true; try { … } catch { … } finally
{ this.pending = false; }` envelope appears 12× in `web/src/lib/auth/flows.svelte.ts`
(LoginFlow.submitCredentials/submitTotp, RegisterFlow.submit, VerifyEmailFlow.resend/verify,
ForgotPassword.request/verifyCode/reset, TwoFactorFlow.setup/verify/disable, LogoutFlow.run),
plus 2 more in `passkey-flow.svelte.ts` (login/register) — one wrapper covers all 14.

### W03 — TOTP challenge step duplicated wholesale in SignInForm and RegisterForm (~55 LOC)

`web/src/routes/(auth)/` components. Extraction needs an `oncancel` callback — RegisterForm's
`cancelTotp` additionally resets `flow.step` (`RegisterForm.svelte:73`).

### W04 — TanStack form field snippet boilerplate ×15 across 5 files (~70 LOC)

Auth forms. A small field-helper collapses them.

### W05 — Dead auth exports (~25 LOC)

9 schema type aliases (`schemas.ts:143-151`), `twoFactorPending` getter
(`flows.svelte.ts:123-125`), the test-only helper `isTransportFailure` (`auth-copy.ts:102`,
referenced only by its own test — NOT `createAuthClient`, which builds the live singleton), and
`PasskeyInfo` fields never read (`deviceType`/`transports`/`createdAt`/`lastUsedAt` — consumers
read only `id` and `label`).

### W06 — Four hand-rolled IndexedDB cursor-scan loops (~100 LOC)

`web/src/lib/workers/opfs-cache.ts:208-239` (`readAllPointers`), `opfs-cache.ts:535-575`
(`readIdbArtifactMetadata`), `opfs-cache.ts:577-612` (`listIdbArtifacts` — `openKeyCursor`), and
`opfs-retention.ts:30-51` (`readLastUsedMap`) all hand-roll the tx/openCursor/continue skeleton
(~15-35 lines each). `web/src/lib/workers/idb.ts:103-130` already has the `idbScan` cursor
helper — extend it and migrate all four.

### W07 — `createOpfsStore` dead in prod and tests (~34 LOC)

`web/src/lib/workers/`.

### W08 — `quran.ts` re-export block = second front door for `quran-types.ts` (~30 LOC)

~20 types + 6 consts re-exported; 51 files import via `$lib/data/quran` (50 static + 1 dynamic),
55 via `$lib/data/quran-types`, 7 import both. Consolidating onto one door is a 50+-file
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
| Four provider `/auth/{p}/v1/user` endpoints (~35 LOC; zero repo references) | **Keep** — an out-of-repo mobile client may call them. (`deploy/.env.example:112-121` documents native sign-in; it names the `/token` endpoint, not `/user`, so the keep is insurance on plausibility, not a documented consumer.) |
| Google auth legacy paths | **Delete `authenticate_oauth` only** (`services/auth.rs:187-222`, zero callers, safe). The `users.google_id` (encrypted) vs `user_oauth_identity` (plaintext) split stays until a deliberate security-architecture pass. |

## Refuted / intentional — do not "fix"

- **Session-establishment tail** ("CSRF refresh + decode + transition + setUser repeated with
  drift"): not drift. Documented three-layer design — `docs/quran-system.md:227`, header-driven
  CSRF auto-refresh in `auth-client.ts:213-222`, and rust `rotate_session_after_trust_change`
  returning `Ok(false)` only when the session was NOT rotated. A unified `completeLogin()` adding
  the `!rotated` fallback to 2FA flows would change behavior for no gain.
- **Hand-rolled IndexedDB test doubles**: consolidating them is not possible as proposed. The
  SW suites (4 files: `service-worker-data-cache`, `service-worker-pending`,
  `service-worker-api-bypass`, `auth-cache-purge`) already share one module-boundary
  `vi.mock` of `lib/workers/idb` (whose comment at `service-worker-data-cache.test.ts:12-13`
  explains happy-dom has no persistent IndexedDB), while `idb.test.ts` and `opfs-cache.test.ts`
  hand-roll platform fakes because they test those modules themselves — mocking the module under
  its own test makes the suite vacuous.
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
  its prebuild (`i18n:check`) and postbuild (`gen-offline-pack.ts`) steps are not covered by the
  trio.
- Rust formatting: scope with `rustfmt --edition 2021 <files>` — never bare `cargo fmt`
  (reformats the whole package, ~45-file diff pollution).
- Sequencing: S06 before any reader-copy refactor; S02's internal-import map means the sidebar
  family deletes as a unit.
- Dead-component sweeps must grep namespace-member usage, not just named imports (see S04).
- No machine guard (nav-guard, catalogue-sha-guard, `tests/quran_v1.rs`) is touched by anything
  in this catalogue.
