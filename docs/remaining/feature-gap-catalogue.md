# Complete feature-gap catalogue

This standalone catalogue records what Quran.com exposes, what EasyQuran currently has, and what
remains. “Parity” means workflow coverage, not visual imitation. Development-only placeholder copy
does not count as a shipped feature or a product defect.

## Reader, recitation, and study

### R01 — Recitation audio and persistent player — Missing · P0

**Quran.com:** surah- and ayah-level play controls, a persistent player with elapsed/duration and
transport controls, reciter choice, per-surah playback, searchable reciters, and download-oriented
reciter pages.

- [Al-Fatihah reader](https://quran.com/al-fatihah)
- [Reciters](https://quran.com/reciters)
- [Reciter detail](https://quran.com/reciters/3)

**EasyQuran today:** no player, queue, reciter, timing, or audio state exists in
[`reader-core.svelte.ts`](../../web/src/lib/stores/reader-core.svelte.ts) or
[`reader.svelte.ts`](../../web/src/lib/stores/reader.svelte.ts). Marketing explicitly places full
recitation on the roadmap in
[`(marketing)/+page.svelte`](../../web/src/routes/(marketing)/+page.svelte).

**Remaining:** licensing and attribution; reciter/recording catalogue; verse timing; surah/ayah
queue; play/pause/seek/next/previous; persistent mini/full player; playback speed; background/media
session controls; failure/retry; optional offline audio with explicit storage limits.

### R02 — Memorization repeat engine — Missing · P0

**Quran.com:** “Repeat Verse” can repeat one ayah, a range, or a full surah; configure range play
count, per-verse repeats, and delay between verses.

- [Al-Fatihah reader](https://quran.com/al-fatihah) → verse **More** → **Repeat Verse**

**EasyQuran today:** persisted reader state only holds font size, display mode, bookmarks, notes,
and last read. There is no audio/range/repetition model in
[`reader-core.svelte.ts`](../../web/src/lib/stores/reader-core.svelte.ts).

**Remaining:** depends on R01. Add stable verse/range selection, repeat counters, inter-ayah delay,
surah/range boundaries, cancellation, screen-lock/background behavior, and saved repeat presets.

### R03 — Word-by-word learning — Missing · P0

**Quran.com:** each Arabic word is interactive. Settings independently control click recitation,
word translation, transliteration, hover/hold vs below-word display, language, and word font size.

- [Al-Fatihah reader](https://quran.com/al-fatihah) → settings → **Word By Word**

**EasyQuran today:** an ayah renders as one plain text span in
[`VerseRow.svelte`](../../web/src/routes/(application)/app/_reader/VerseRow.svelte). The only
word-oriented code aligns search highlights; it is not a token corpus or reader tool. Word-level
navigation is explicitly deferred in [`docs/quran-system.md`](../quran-system.md).

**Remaining:** immutable, licensed word/token source; canonical word coordinates; Arabic token
display; per-word meaning/transliteration; word audio/timing; token popovers; word permalink/highlight
grammar; keyboard/touch interaction; offline delivery; source attribution and tests that never
rewrite Quran text.

### R04 — Arabic plus multiple translations — Partial · P0

**Quran.com:** Arabic stays visible while multiple credited translations can be selected and
stacked. Word-by-word source and transliteration are separate choices.

- [Al-Fatihah reader](https://quran.com/al-fatihah)

**EasyQuran today:** the multi-translation subsystem is shipped. Every reader route — surah, juz, or
global page, Arabic or translated primary — can stack up to 5 extra translations, hydrated
client-only by
[`stacked-translations.svelte.ts`](../../web/src/routes/(application)/app/_reader/stacked-translations.svelte.ts)
with selection via
[`StackedTranslationsPicker.svelte`](../../web/src/routes/(application)/app/_reader/StackedTranslationsPicker.svelte).
The primary SSG/SSR routes and their cache keys are untouched; the `?more=<id>,<id>` client mirror
is stripped from cache keys by the service worker; selected extras (and the primary) pin against
OPFS eviction; each extra renders with its own language/direction and translator attribution; and
share/copy deliberately excludes extras. Full contract: [Part 1 of
`docs/quran-system.md`](../quran-system.md), “Multiple stacked translations”.

**Remaining:** side-by-side or parallel comparison presentation — extras currently stack vertically
beneath the primary, verse mode only; per-extra font controls. Word-by-word source and
transliteration choice belongs to R03.

### R05 — Real, credited tafsir — Partial · P0

**Quran.com:** per-ayah sourced tafsir with multiple source choices, citations/footnotes, and deeper
verse pages.

- [Al-Fatihah reader](https://quran.com/al-fatihah)
- [Al-Fatihah 1:1 detail](https://quran.com/al-fatihah/1)

**EasyQuran today:** the UI exists, but
[`tafsirFor`](../../web/src/lib/data/quran.ts) returns the literal placeholder “Sample commentary …
in the full app”. [`VerseTools.svelte`](../../web/src/routes/(application)/app/_reader/VerseTools.svelte)
labels this as Tafsir.

**Remaining:** replace development sample content when implementing this feature; acquire licensed
tafsir sources; define verse coverage, source switching, attribution, footnotes, citation links,
caching/offline rules, and clear missing-source states.

### R06 — Broader study panels — Missing · P1

**Quran.com:** verse study tabs include Lessons, Reflections, Answers, Hadith, Related Content, and
sometimes Qira'at, alongside tafsir. Some content connects to QuranReflect and learning plans.

- [Al-Fatihah reader](https://quran.com/al-fatihah)
- [Al-Fatihah 1:1 detail](https://quran.com/al-fatihah/1)

**EasyQuran today:** only placeholder tafsir plus a private plain-text note.

**Remaining:** decide which content types serve EasyQuran's mission; define editorial/moderation and
licensing rules; add typed source models, attribution, backlinks, report/correction flow, and
accessible loading/error/empty states. Public reflections imply a separate moderation product and
should not be inferred from private notes.

### R07 — Rich surah information — Missing · P1

**Quran.com:** dedicated surah pages cover themes, names, revelation context/chronology, ayah-count
traditions, long-form overview, multiple scholarly sources, and related learning plans.

- [Al-Fatihah information](https://quran.com/al-fatihah/info)

**EasyQuran today:**
[`ReaderHeader.svelte`](../../web/src/routes/(application)/app/_reader/ReaderHeader.svelte) shows
number, English/Arabic name, revelation place, and verse count. No surah-info route exists.

**Remaining:** sourced editorial data, long-form route/SEO, source tabs/citations, related-plan
links, font controls, translation/localization, and correction workflow.

### R08 — Arabic script, Tajweed, and Mushaf layouts — Partial · P1

**Quran.com:** Uthmani, IndoPak, and Tajweed; 15/16-line Mushaf selection; independent Arabic,
translation, and word-by-word sizing.

- [Al-Fatihah reader](https://quran.com/al-fatihah) → settings → **Arabic**

**EasyQuran today:** Uthmani and Simple Clean are registered source profiles, while IndoPak/Tajweed
appear only in enums/status labels. Reader source picker presents one “Arabic · Original”. Display
settings offer Arabic size and two reading modes.

- [`source-profiles.ts`](../../web/src/lib/quran/view/source-profiles.ts)
- [`TranslationPicker.svelte`](../../web/src/routes/(application)/app/_reader/TranslationPicker.svelte)
- [`ReaderHeader.svelte`](../../web/src/routes/(application)/app/_reader/ReaderHeader.svelte)

**Remaining:** only add licensed immutable sources; active script picker; Tajweed color semantics and
accessible fallback; font/source-specific line breaking; 15/16-line geometry; separate source font
controls; offline packaging and content invariants.

### R09 — Pin and compare verses — Missing · P1

**Quran.com:** “Pin & compare” builds a multi-verse workspace with pinned verse chips and comparison.

- [Al-Fatihah reader](https://quran.com/al-fatihah) → verse **More** → **Pin & compare**

**EasyQuran today:** boolean bookmarks exist, but no transient pin set, ordered comparison state,
workspace, or comparison route.

**Remaining:** ordered pin state; add/remove/reorder; compare drawer/page; composed Arabic/translation
selection; share/export; overflow and mobile behavior; optional conversion into a collection.

### R10 — Advanced copy, share, embeds, and generated media — Partial · P1

**Quran.com:** copy a verse/range with chosen translations, translator names, script selection,
glyph/footnote options; share to social targets; copy link/embed; generate and download image/video.

- [Al-Fatihah 1:1](https://quran.com/al-fatihah/1)

**EasyQuran today:**
[`reader-share.svelte.ts`](../../web/src/lib/stores/reader-share.svelte.ts) copies `text + reference`
or calls `navigator.share({ title, text })`; it does not include a permalink.

**Remaining:** range/source/format dialog; canonical URL; attribution/footnote options; social link
targets; embed contract; branded accessible image card; downloadable image; video only after audio
licensing/player work. Keep plain copy/share as fast path.

### R11 — Dedicated ayah and verse-range permalinks — Partial · P2

**Quran.com:** dedicated, indexable ayah pages and range URLs such as `53:2-4`, with next/previous
navigation, rich metadata, and locale alternates.

- [Al-Fatihah 1:1](https://quran.com/al-fatihah/1)
- [An-Najm 53:2–4](https://quran.com/53:2-4)

**EasyQuran today:** ayahs use hash anchors on containing surah-local pages through
[`surahAyahPathFor`](../../web/src/lib/data/quran.ts). Reader pages already have solid canonical/OG
SEO, and sitemap translation alternates exist, so this is partial rather than absent.

**Remaining:** decide whether standalone routes improve product/SEO enough to justify route count;
define range grammar and cap; source-aware route helpers; canonical and hreflang; previous/next;
SSR/SSG/cache implications; share/copy integration. Do not hand-build `/app/` URLs.

### R12 — Deeper navigation and context — Partial · P2

**Quran.com:** Surah/Juz/Verse/Page navigation, revelation-order sort, ascending/descending sort,
direct reference navigation, and page/Juz/Hizb context in the reader.

- [Quran.com home](https://quran.com/)
- [Al-Fatihah reader](https://quran.com/al-fatihah)

**EasyQuran today:** sidebar browses Surah/Ayah/Juz/Page. Revelation order, ruku, hizb, manzil, and
sajda metadata/API already exist but lack equivalent web browse surfaces. Ayah browse is scoped to
current surah.

- [`Sidebar.svelte`](../../web/src/routes/(application)/app/_reader/Sidebar.svelte)
- [`quran-data.ts`](../../web/src/lib/data/quran-data.ts)
- [`quran_v1/mod.rs`](../../rust/backend/api/src/modules/quran_v1/mod.rs)

**Remaining:** revelation sort; robust `surah:ayah`/range command parsing; global ayah jump; global
page/Juz/Hizb context; optionally expose ruku/hizb/manzil/sajda browsing using current metadata.

### R13 — Translation feedback — Missing · P2

**Quran.com:** verse action links to a translation-specific feedback flow.

- [Al-Fatihah reader](https://quran.com/al-fatihah) → verse **More** → **Translation Feedback**

**EasyQuran today:** general email/contact exists; no source/verse-prefilled correction workflow.

**Remaining:** prefill immutable source id and verse key, never edit a Quran DB in-product; define
triage/export to source maintainer, spam controls, status/acknowledgment, and attribution.

## Personal Quran, progress, and account data

### P01 — Quran-state account sync — Missing · P0

**Quran.com:** its own product updates describe centralized accounts syncing progress, notes,
activity, collections, settings, and connected Quran Foundation products.

- [Centralized accounts](https://quran.com/product-updates/centralized-accounts-across-quran-foundation)
- [Connected Quran apps](https://quran.com/en/product-updates/connected-quran-apps-expand-your-quran-journey)

**EasyQuran today:** auth/security is shipped, but Quran state is written only to
`easyquran.reader` localStorage in
[`reader-persistence.svelte.ts`](../../web/src/lib/stores/reader-persistence.svelte.ts). Account API
supports profile and session management only in
[`account-client.ts`](../../web/src/lib/auth/account-client.ts). Backend has no bookmark/note/history/
goal routes or migrations. Sync wording elsewhere in the developing app is placeholder copy, not
implementation evidence.

**Remaining:** user-owned schema and APIs; anonymous local-first behavior; sign-in merge rules;
idempotent mutation/conflict resolution; timestamps/tombstones; offline outbox/retry; cross-device
updates; encryption/privacy/export/delete; quota/abuse rules; auth-cache separation; migration from
schema-v1 localStorage.

### P02 — “My Quran” library — Missing · P1

**Quran.com:** guest-visible tabs for Saved, Recent, Notes & Reflections, My Reading Bookmark, and
Collections.

- [My Quran](https://quran.com/my-quran)

**EasyQuran today:** `/app` redirects to one last-read position. Account page manages profile,
sessions, and security. There is no saved/recent/notes dashboard.

**Remaining:** local-first library route; counts/empty states; tabs or filters; source-aware verse
previews; open/remove/edit actions; pagination/virtualization; signed-in sync when P01 exists.

### P03 — Explicit reading bookmark — Partial · P1

**Quran.com:** a deliberate page/verse reading bookmark can be set, replaced, and undone. It is
separate from general saved verses.

- [Reading Bookmark update](https://quran.com/product-updates/reading-bookmark-easily-track-your-quran-progress)
- [My Quran](https://quran.com/my-quran)

**EasyQuran today:** latest visible verse automatically overwrites one `{num,n,sourceId?}` last-read
position; Continue Reading exists. No explicit set/replace/undo or timestamp.

**Remaining:** distinguish automatic resume from user-set reading bookmark; page/verse target;
timestamp/source; replace confirmation/undo; library card; sync/export.

### P04 — Dated reading history and sessions — Missing · P1

**Quran.com:** Recently Read lists dated locations. Official API docs distinguish reading sessions
from daily activity.

- [My Quran](https://quran.com/my-quran)
- [Reading sessions vs activity days](https://api-docs.quran.com/docs/user-related-apis/1.0.0/reading-sessions-vs-activity-days/)

**EasyQuran today:** one last-read value exists. The file named
[`reader-history.ts`](../../web/src/routes/(application)/app/_reader/reader-history.ts) is reload-only
sessionStorage viewport restoration, not durable history.

**Remaining:** bounded source-aware history entries; started/last-seen timestamps; session
coalescing; resume location; clear/delete controls; privacy/retention; goal-activity separation.

### P05 — Saved verse collections — Partial · P1

**Quran.com:** save verses into one or many named collections; create/remove/sort collections;
compare and contrast selected verses.

- [Save verses to collections](https://quran.com/product-updates/save-verses-to-collections-organize-your-quran-study)
- [My Quran](https://quran.com/my-quran)

**EasyQuran today:** bookmarks are `Record<VerseKey, boolean>` toggled inline. No list, metadata,
collection entity, tag, ordering, or comparison workspace.

**Remaining:** saved-item identity/source policy; collection CRUD; many-to-many membership; optional
title/description/order; recent sort; bulk operations; pin/compare integration; sync/export.

### P06 — Notes/reflections organizer — Partial · P1

**Quran.com:** ayah notes are organized under account; a separate moderated handoff can publish a
reflection to QuranReflect.

- [Ayah-level notes and reflections](https://quran.com/en/product-updates/ayah-level-notes-and-reflections)
- [My Quran](https://quran.com/my-quran)

**EasyQuran today:** an inline textarea stores one plain string per verse and says “Saved on this
device as you type.”

- [`VerseTools.svelte`](../../web/src/routes/(application)/app/_reader/VerseTools.svelte)
- [`annotations.svelte.ts`](../../web/src/lib/stores/annotations.svelte.ts)

**Remaining:** notes index/search/sort; timestamps; source-aware verse context; edit/delete/export;
sync. Public reflection submission is optional and would require consent, identity, moderation, and
status tracking—do not conflate it with private notes.

### P07 — Personal-data export/import/recovery — Missing · P1

**Quran.com comparison:** centralized account sync reduces single-browser loss. EasyQuran's own FAQ
already promises export as fallback.

**EasyQuran today:** localStorage only; no download/upload/recovery flow.

- [`content.ts`](../../web/src/lib/data/content.ts)
- [`reader-persistence.svelte.ts`](../../web/src/lib/stores/reader-persistence.svelte.ts)

**Remaining:** documented portable schema; JSON export; validated import/merge/replace preview;
future-schema rejection; per-item timestamps; account export/delete integration; backup reminder.

### P08 — Goals, activity progress, and streaks — Missing · P1

**Quran.com:** preset 10-min/day, Quran-in-30-days, Quran-in-a-year, and custom goals; daily vs
duration goals; time/page/range units; timezone resets; daily activity and streak history.

- [Reading Goal](https://quran.com/reading-goal)
- [Quran reading streaks](https://quran.com/en/product-updates/quran-reading-streaks)
- [Reading sessions vs activity days](https://api-docs.quran.com/docs/user-related-apis/1.0.0/reading-sessions-vs-activity-days/)

**EasyQuran today:** no goal, focused-reading duration, daily range, timezone, completion, or streak
model. Generic reader views/engagement counters are delivery heuristics, not user progress.

**Remaining:** goal model/presets/custom range; active-reading measurement; daily activity rules;
timezone and day boundary; progress UI; completion/pausing; adaptive pace; streak calendar; privacy;
offline event queue; sync/export; anti-inflation semantics.

### P09 — Goal/calendar reminders — Partial · P2

**Quran.com:** account notifications support goal consistency; Quran-in-a-Year offers program email,
WhatsApp, and Telegram reminders.

- [Quran.com notification system](https://quran.com/en/product-updates/quran-com-notification-system)
- [Quran-in-a-Year calendar](https://quran.com/calendar)

**EasyQuran today:** generic browser push opt-in, token registration, inbox APIs, and admin-created
notifications exist. No user reminder schedule, goal/calendar event, quiet hours, channel choice, or
preference taxonomy.

**Remaining:** goal-aware schedules; timezone/quiet hours; per-kind preferences; permission
education; unsubscribe; delivery status; program assignment templates. Reuse current FCM substrate.

### P10 — Self-service account/data deletion — Missing internal requirement

This was not needed to establish Quran.com parity. Development privacy copy mentions account/data
deletion, while account UI has no deletion control and backend user deletion is admin-oriented. The
copy is a placeholder until release behavior is finalized.

**Remaining:** authenticated destructive flow with re-authentication, grace/recovery policy, session
revocation, deletion of future Quran-state rows/device tokens, export-first option, and clear local
data handling.

## Search, discovery, learning, and content

### D01 — Full search experience — Partial · P1

**Quran.com:** public shareable URL, Arabic plus translated snippets, highlighting, result count,
pagination, and voice input.

- [Search “mercy”](https://quran.com/search?page=1&q=mercy)

**EasyQuran today:** Arabic-canonical substring search and name/number fallback are strong, with
highlights and keyboard access. Delivered in the command palette (Aug 2026): typo-tolerant surah
matching (fold keys + bounded edit distance), surah/juz alias nicknames (`tabarak`, `amma`), and
offline translation full-text search over the user's cached translation DBs (worker-local) —
see [`search-system.md`](../../docs/search-system.md). Delivered on a dedicated
[`/app/search`](../../web/src/routes/(application)/app/search/+page.svelte) page (Aug 2026):
multi-translation merged search (client-side batches of 3 concurrent worker searches), per-source
sections with load-more pagination, shareable `?q`/`?t` URLs, and translation download management.
The reader drawer is intentionally untouched and still calls one 20-result query.

- [`Results.svelte`](../../web/src/routes/(application)/app/_reader/Results.svelte)
- [`search.ts`](../../web/src/lib/quran/search.ts)
- [`search/types.ts`](../../web/src/lib/quran/search/types.ts)
- [`search-system.md`](../../docs/search-system.md)

**Remaining:** reader drawer surface for the new search; relevance ranking for translation hits;
recent queries (privacy-gated); voice input with unsupported/permission/error states. Preserve
existing Arabic normalization/parity contract.

### D02 — Discovery home/dashboard — Missing · P2

**Quran.com:** home combines Continue Reading, My Quran, goals, topics, learning plans, Verse of the
Week, Quran-in-a-Year, community/apps, daily verse, and Surah/Juz/Revelation Order browse.

- [Quran.com home](https://quran.com/)

**EasyQuran today:** `/app` immediately redirects to the last-read/default surah.

- [`app/+page.svelte`](../../web/src/routes/(application)/app/+page.svelte)

**Remaining:** decide whether speed-to-text remains default. Possible compromise: retain `/app`
resume behavior and add `/discover` or an optional home. Cards should be data-driven, localizable,
and work without account.

### D03 — Structured learning plans — Missing · P2

**Quran.com:** multilingual plan catalogue, author profile, outline/duration, share, daily lessons,
and tracked progress. Plans cover recitation, reflection, and memorization.

- [Learning Plans](https://quran.com/learning-plans)
- [Seven Days, Seven Verses](https://quran.com/learning-plans/seven-days-seven-verses-living-the-message-of-al-fatihah)

**EasyQuran today:** no learning route, content model, author model, or completion state.

**Remaining:** editorial/source governance; catalogue/detail/lesson routes; author attribution;
duration/outline; start/progress/complete; anonymous vs account storage; localization; related verse/
surah links; correction/version policy for editorial content (separate from immutable Quran DBs).

### D04 — Quran-in-a-Year calendar — Missing · P2

**Quran.com:** Ramadan-to-Ramadan weekly Hijri schedule, assigned verse ranges, reflection prompts,
Read Online/PDF, completion and “My Progress,” discussion/video/community links, subscriptions.

- [Quran-in-a-Year calendar](https://quran.com/calendar)
- [Enhanced calendar update](https://quran.com/product-updates/enhanced-quran-in-a-year-calendar-with-community-engagement)

**EasyQuran today:** no calendar/program route, schedule, assignment, completion, or program reminder.

**Remaining:** Hijri/weekly schedule source; assignment range links; timezone/calendar rules;
completion/progress; PDF/accessibility; reminder integration; annual rollover; community links only if
strategy supports them.

### D05 — Ramadan and seasonal hubs — Missing · P2

**Quran.com:** current Ramadan hub combines memorization challenge, custom goals/streaks, learning
plans, reflection/community content, explainers, and notes/bookmark pointers.

- [Ramadan 2026](https://quran.com/ramadan2026)

**EasyQuran today:** no Ramadan/seasonal route or content configuration.

**Remaining:** seasonal landing/config; year-aware redirect/archival; selected goals/plans/challenges;
localized editorial content; expiry behavior. Depends on goals/plans/audio if those cards are offered.

### D06 — Quranic duas catalogue — Missing · P2

**Quran.com:** 101 guest-visible dua/topic pages, searchable and grouped by essentials, prophets,
worship, family, forgiveness, guidance, hardship, provision, and hereafter, with Quran references.

- [Duas from the Quran](https://quran.com/duas)

**EasyQuran today:** no dua routes or curated dua data.

**Remaining:** curated verse/range references rather than copied Quran text; categories/tags/search;
index/detail SEO; Arabic + chosen translation/transliteration presentation; audio/share/save links;
scholarly/editorial review and correction path.

### D07 — Daily/weekly featured Quran — Missing · P2

**Quran.com:** daily verse includes Arabic, translation, reference, audio, copy/link actions, and
related plans. Home also exposes Verse of the Week with reflections and view/community links.

- [Quran Verse of the Day](https://quran.com/daily)
- [Quran.com home](https://quran.com/)

**EasyQuran today:** backend `/quran/random` already produces a deterministic date-seeded ayah, but
no web feature consumes it.

**Remaining:** web daily route/card; server-safe date/timezone policy; source-aware link; optional
translation/audio; share metadata; weekly/editorial selection only if content governance exists.

### D08 — Editorial topics and explainers — Missing · P2

**Quran.com:** thematic verse collections and indexable explainers such as Sunnah, Quran basics,
Ramadan, and seasonal topics.

- [Explore](https://quran.com/explore)
- [Verses about the Sunnah](https://quran.com/explore/verses-about-the-sunnah)
- [What is Ramadan?](https://quran.com/what-is-ramadan)

**EasyQuran today:** public content is home/about/FAQ/contact/privacy/terms.

**Remaining:** editorial taxonomy; sourced writing; verse/range link model; author/reviewer/date;
localization; SEO; related content; correction policy.

### D09 — Reciter catalogue and Quran Radio — Missing · P2

**Quran.com:** searchable reciter catalogue, biography/detail pages, per-surah playback/download, and
themed radio stations.

- [Reciters](https://quran.com/reciters)
- [Reciter detail](https://quran.com/reciters/3)
- [Quran Radio](https://quran.com/radio)

**EasyQuran today:** no audio product. This is an extension of R01, not a separate first step.

**Remaining:** after R01, add reciter browse/search/profile, recording variants, attribution,
favorite/default reciter, surah downloads, and only then curated/continuous radio with stream
reconnect and metadata.

## Localization, shareability, and ecosystem

### L01 — UI localization and document semantics — Missing · P1

**Quran.com:** 20 visible interface languages and a language selector.

- [Quran.com](https://quran.com/)

**EasyQuran:** UI chrome is localized in `en`/`ar` and shipped — Paraglide v2, `/` + `/ar/`
marketing routes, `/en/app/**` + `/ar/app/**` reader URLs, locale switcher, RTL base, localized
SEO/hreflang/sitemap ([`docs/quran-system.md`](../quran-system.md) Part 2).

**Remaining:** fluent Arabic review for the localized (but unpublished) `about`/`faq`/`contact`/`privacy`/`terms`
pages; RTL polish (physical utilities, reader arrows); localized `.md`/`.txt` representations; more
UI locales after `en`/`ar` (capacity review). Keep UI locale independent from Quran translation
source and out of reader server cache keys.

### E01 — Native Android/iOS apps — Missing, PWA shipped · P3

**Quran.com:** native Android/iOS readers.

- [Connected Quran Apps](https://quran.com/en/apps)

**EasyQuran today:** installable offline PWA exists. Native apps remain roadmap/non-goal for this
repo.

- [`manifest.webmanifest`](../../web/static/manifest.webmanifest)
- [`docs/quran-system.md`](../quran-system.md)

**Remaining:** strategic choice first. If approved, share API/source/parity contracts, personal sync,
audio licensing/download policy, deep links, platform accessibility, store compliance, telemetry/
privacy, and release operations. Do not fork Quran normalization behavior.

### E02 — Connected app/community directory — Missing · P3

**Quran.com:** connected-app catalogue links reflection, study circles, Hadith, reader, audio, and
other Quran Foundation products.

- [Connected Quran Apps](https://quran.com/en/apps)

**EasyQuran today:** no `/apps` directory or partner catalogue.

**Remaining:** only if EasyQuran becomes a platform: partner criteria, categories/search, ownership/
privacy disclosure, deep links, availability review, and removal policy.

### E03 — Cross-product identity — Missing · P3

**Quran.com:** centralized Quran Foundation account connects settings/progress/reflections across
products.

- [Centralized accounts](https://quran.com/product-updates/centralized-accounts-across-quran-foundation)

**EasyQuran today:** strong standalone auth, no external Quran ecosystem identity or Quran-state
sync.

**Remaining:** do not pursue before P01. Requires OAuth/OIDC provider or federation, consented data
scopes, account linking/unlinking, deletion/export, conflict rules, security review, and partner
governance.

### E04 — Public developer platform — Partial · P3

**Quran.com:** developer landing/docs, OAuth2 connected accounts, API onboarding, labs/open-source,
Quran MCP, and volunteer intake.

- [Developers](https://quran.com/en/developers)
- [API documentation](https://api-docs.quran.com/)

**EasyQuran today:** capable Quran API and optional OpenAPI JSON already exist, but no public docs/
onboarding portal, SDK, application registration, MCP server, or labs surface.

**Remaining:** choose public API support level; stable auth/rate-limit/version policy; hosted OpenAPI
and guides; examples/SDK only if maintainable; changelog/deprecation; keys/app registration if
needed; MCP only with clear user value and immutable-source guarantees.

### E05 — Feedback portal and product updates — Partial · P3

**Quran.com:** help center, public feature/bug feedback portal, and dated product updates.

- [Support](https://quran.com/en/support)
- [Feedback](https://feedback.quran.com/)
- [Product Updates](https://quran.com/en/product-updates)

**EasyQuran today:** FAQ and contact pages exist; contact is email/social. No structured tracker or
public changelog route.

**Remaining:** categorized submission with privacy/spam controls; optional public voting/status;
Quran-text correction lane distinct from general feedback; dated release notes and RSS if useful.

### E06 — Donation and impact surface — Missing · P3

**Quran.com:** dedicated impact, roadmap, and donation flow.

- [Donate](https://donate.quran.com/)

**EasyQuran today:** no donation link/route; FAQ says hosting help may be requested later.

**Remaining:** only if funding strategy approves: legal/payment processor, recurring/one-off,
receipts/refunds, transparent use/impact, privacy, localization, and no ad/upsell erosion in reader.

### E07 — Public email newsletter — Missing · P3

**Quran.com:** “Stay Connected” email subscription appears across public pages.

**EasyQuran today:** backend newsletter infrastructure exists, but public footer has no signup form.
This is therefore a missing product surface, not necessarily a missing backend.

**Remaining:** public opt-in form, confirmation, consent copy, frequency/topic expectations,
unsubscribe, suppression handling, abuse protection, and privacy/legal alignment.

## Evidence cautions

- EasyQuran is under development, so marketing/legal/auth text includes placeholders for intended
  end-state behavior. Never treat placeholder copy alone as shipped evidence; verify code and routes.
- Guest Quran.com UI was directly inspected. Account persistence claims use Quran.com's linked
  official product/API documentation; no authenticated account was tested.
- Quran.com has a broader nonprofit/platform mission. E01–E07 and public community/reflection
  workflows may be wrong for EasyQuran even though they are genuine gaps.
- Generic accessibility failure was not found and is not claimed. EasyQuran already has skip links,
  focus handling, labelled controls, keyboard search, and reader keyboard navigation. Verified
  accessibility-adjacent gaps are static document language semantics and absent voice input.
