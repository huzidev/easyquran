<script lang="ts">
  import { page } from "$app/state";
  import { SITE } from "$lib/config/site";
  import { Seo } from "$lib/components";
  import { globalPagePathFor, type SurahRouteContext } from "$lib/data/quran";
  import { RangeKind, RANGE_COUNTS } from "$lib/data/quran-data";
  import { getReaderUiCopy } from "$lib/i18n/reader-copy";
  import { readerHrefFor } from "$lib/i18n/reader";
  import ReaderShell from "../../../../../_reader/ReaderShell.svelte";
  import RangeReader from "../../../../../_reader/RangeReader.svelte";

  let { data } = $props();
  const copy = getReaderUiCopy();
  const ctx = $derived.by<SurahRouteContext>(() => {
    const lang = page.params.lang;
    const translator = page.params.translator;
    if (lang !== undefined && translator !== undefined) {
      return { kind: "translation", lang, translator };
    }
    return { kind: "arabic" };
  });
  const canonicalPath = $derived(globalPagePathFor(ctx, data.index));
  const canonicalPublicPath = $derived(readerHrefFor("en", canonicalPath));
  const currentPublicPath = $derived(readerHrefFor(copy.locale, canonicalPath));
  const extent = $derived(`${data.first} – ${data.last}`);
  const seoTitle = $derived(copy.seo.pageTitle(data.index, data.first, data.last));
  const seoDescription = $derived(
    copy.seo.translationPageDescription(data.index, data.first, data.last),
  );
  const contentLanguage = $derived(page.params.lang ?? "en");
  const pending = $derived(data.ayahs.length === 0);
  const prevHref = $derived(
    data.index > 1 ? globalPagePathFor(ctx, data.index - 1) : null,
  );
  const nextHref = $derived(
    data.index < RANGE_COUNTS[RangeKind.Page] ? globalPagePathFor(ctx, data.index + 1) : null,
  );
</script>

<svelte:head>
  {#if prevHref}
    <link rel="prev" href={`${SITE.url}${readerHrefFor(copy.locale, prevHref)}`} />
  {/if}
  {#if nextHref}
    <link rel="next" href={`${SITE.url}${readerHrefFor(copy.locale, nextHref)}`} />
  {/if}
</svelte:head>

<Seo
  path={canonicalPublicPath}
  title={seoTitle}
  description={seoDescription}
  includeTextVariants={false}
  inLanguage={contentLanguage}
  noindex={pending}
  crumbs={[
    { name: copy.seo.home, href: "/" },
    { name: copy.range.item("page", data.index), href: currentPublicPath },
  ]}
/>

<ReaderShell>
  {#snippet header()}
    <h1 class="text-sm font-medium text-fg-2">{copy.range.item("page", data.index)}</h1>
    <span class="ml-auto font-mono text-[12px] text-fg-3">{extent}</span>
  {/snippet}
  <RangeReader {data} />
</ReaderShell>
