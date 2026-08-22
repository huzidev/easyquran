<script lang="ts">
  import { SITE } from "$lib/config/site";
  import { MARKETING_PAGES } from "$lib/config/site-structure";
  import {
    baseEnglishPageCopy,
    baseEnglishPageCopyForPath,
  } from "$lib/i18n/base-english-copy";

  type FaqItem = { q: string; a: string };
  type Crumb = { name: string; href: string };

  const LOCALE_TERRITORY = {
    en: "en_US",
    ar: "ar_SA",
    ms: "ms_MY",
    id: "id_ID",
    ur: "ur_PK",
    fa: "fa_IR",
    zh: "zh_CN",
    tl: "tl_PH",
    bn: "bn_BD",
    hi: "hi_IN",
  } satisfies Record<string, string>;

  let {
    path,
    schemaSubtype = "WebPage",
    title,
    description,
    faq,
    extraLd,
    includeTextVariants = true,
    includePlainVariant = true,
    noindex = false,
    inLanguage = "en",
    crumbs,
  }: {
    path: string;
    schemaSubtype?: string;
    title?: string;
    description?: string;
    faq?: FaqItem[];
    // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- schema.org JSON-LD nodes are intentionally heterogeneous bags (arbitrary keys, nested nodes); only serialized via JSON.stringify, never read back by key
    extraLd?: Record<string, unknown>[];
    includeTextVariants?: boolean;
    includePlainVariant?: boolean;
    noindex?: boolean;
    inLanguage?: string;
    crumbs?: Crumb[];
  } = $props();

  const meta = $derived(baseEnglishPageCopyForPath(path));
  const pageTitle = $derived(title ?? meta?.title ?? SITE.name);
  const pageDescription = $derived(description ?? meta?.description ?? baseEnglishPageCopy("home").description);

  const base = $derived(path === "/" ? "/index" : path);
  const mdHref = $derived(base + ".md");
  const txtHref = $derived(base + ".txt");
  const canonical = $derived(SITE.url + path);
  const ogImage = $derived(`${SITE.url}/og.png`);
  const ogImageAlt = `${SITE.name} — preview card`;
  const ogLocale = $derived(
    // SAFETY: inLanguage is an arbitrary locale string from props; a key miss performs a JS
    // lookup that returns undefined, which the ?? fallback maps to `${lang}_${LANG}`.
    LOCALE_TERRITORY[inLanguage as keyof typeof LOCALE_TERRITORY] ??
      `${inLanguage}_${inLanguage.toUpperCase()}`,
  );

  const current = $derived(MARKETING_PAGES.find((p) => p.href === path));

  const webpageLd = $derived({
    "@context": "https://schema.org",
    "@type": schemaSubtype,
    "@id": canonical + "#webpage",
    url: canonical,
    name: pageTitle,
    description: pageDescription,
    inLanguage,
    isPartOf: { "@id": `${SITE.url}/#website` },
    about: { "@id": `${SITE.url}/#organization` },
  });

  const listItem = (position: number, name: string, item: string) => ({
    "@type": "ListItem",
    position,
    name,
    item,
  });

  const breadcrumbList = (itemListElement: ReturnType<typeof listItem>[]) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  });

  /** Explicit crumbs win; otherwise a non-home page gets an implicit Home > page trail. */
  function buildBreadcrumbLd(): ReturnType<typeof breadcrumbList> | null {
    if (crumbs && crumbs.length) {
      return breadcrumbList(crumbs.map((c, i) => listItem(i + 1, c.name, `${SITE.url}${c.href}`)));
    }
    if (path !== "/" && current) {
      return breadcrumbList([
        listItem(1, "Home", `${SITE.url}/`),
        listItem(2, baseEnglishPageCopy(current.id).label, canonical),
      ]);
    }
    return null;
  }

  const breadcrumbLd = $derived(buildBreadcrumbLd());

  const faqLd = $derived(
    faq && faq.length
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((i) => ({
            "@type": "Question",
            name: i.q,
            acceptedAnswer: { "@type": "Answer", text: i.a },
          })),
        }
      : null,
  );

  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- JSON-LD node bag: heterogeneous schema.org payloads, only escaped and serialized to a script tag, never read by key
  const ld = (obj: Record<string, unknown>) =>
    `<script type="application/ld+json">${
      JSON.stringify(obj)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029")
    }` + "<" + "/script>";

  // SAFETY: every element is a JSON-LD object literal (webpageLd, breadcrumbLd, faqLd) or an
  // extraLd record; filter(Boolean) only drops nulls and does not change the element shapes.
  const ldNodes = $derived(
    [
      webpageLd,
      breadcrumbLd,
      faqLd,
      ...(extraLd ?? []).filter(
        (n) => n["@type"] !== "WebSite" && n["@type"] !== "Organization",
      ),
      // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- JSON-LD node bag: heterogeneous schema.org payloads, only serialized via JSON.stringify, never read by key
    ].filter(Boolean) as Record<string, unknown>[],
  );
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content={pageDescription} />

  {#if noindex}
    <meta name="robots" content="noindex, follow" />
  {:else}
    <link rel="canonical" href={canonical} />
    <meta
      name="robots"
      content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
    />

    <meta property="og:site_name" content={SITE.name} />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content={ogLocale} />
    <meta property="og:title" content={pageTitle} />
    <meta property="og:description" content={pageDescription} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content={ogImage} />
    <meta property="og:image:secure_url" content={ogImage} />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content={ogImageAlt} />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={pageTitle} />
    <meta name="twitter:description" content={pageDescription} />
    <meta name="twitter:image" content={ogImage} />
    <meta name="twitter:image:alt" content={ogImageAlt} />

    {#if includeTextVariants}
      <link rel="alternate" type="text/markdown" href={mdHref} />
    {/if}
    {#if includeTextVariants && includePlainVariant}
      <link rel="alternate" type="text/plain" href={txtHref} />
    {/if}

    {#each ldNodes as node, idx (idx)}
      {@html ld(node)}
    {/each}
  {/if}
</svelte:head>
