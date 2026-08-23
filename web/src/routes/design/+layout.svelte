<script lang="ts">
  import { page } from "$app/state";
  import { Tweaks } from "$lib/components/tweaks";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { DEFAULT_UI_LOCALE, isUiLocale } from "$lib/i18n/locales";
  import { VARIANTS, type VariantKind } from "./_variants/registry";
  import { cn } from "$lib/utils";

  let { children } = $props();

  const parts = $derived(page.url.pathname.replace(/^\/design\/?/, "").split("/").filter(Boolean));
  // SAFETY: parts[0] is a raw URL segment, not a validated value; the `kind in VARIANTS` check below
  // gates every use, so any mismatch falls back to the empty list.
  const kind = $derived(parts[0] as VariantKind | undefined);
  const current = $derived(parts[1]);
  const list = $derived(kind && kind in VARIANTS ? VARIANTS[kind] : []);

  const tab =
    "rounded-md px-2.5 py-1 text-xs transition-colors duration-150 border";
  const tabOn = "border-accent bg-accent-soft text-fg";
  const tabOff = "border-transparent text-fg-3 hover:text-fg";

  const loadTweaksCopy = async () => {
    const { getReaderSettingsCopy } = await import("$lib/i18n/reader-settings-copy");
    const locale = getLocale();
    return getReaderSettingsCopy(isUiLocale(locale) ? locale : DEFAULT_UI_LOCALE);
  };
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-screen flex-col">
  <header
    class="sticky top-0 z-50 border-b border-line bg-bg-elev/85 backdrop-blur-xl"
  >
    <div class="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
      <a href="/design" class="font-mono text-xs uppercase tracking-wide text-fg-2 hover:text-fg">
        Design&nbsp;/&nbsp;variants
      </a>

      {#if kind}
        <span class="text-xs text-fg-4">{kind}</span>
        <div class="flex items-center gap-1">
          {#each list as v (v.id)}
            <a
              href={`/design/${kind}/${v.id}`}
              class={cn(tab, current === v.id ? tabOn : tabOff)}
            >
              {v.id.toUpperCase()} · {v.name}
            </a>
          {/each}
        </div>
      {/if}

      <div class="ml-auto flex items-center gap-3 text-xs text-fg-4">
        <a href="/" class="transition-colors hover:text-fg">live site →</a>
      </div>
    </div>
  </header>

  <main id="main" tabindex="-1" class="flex-1">{@render children()}</main>
</div>

<Tweaks locale="en" triggerLabel="Customize appearance" loadCopy={loadTweaksCopy} />
