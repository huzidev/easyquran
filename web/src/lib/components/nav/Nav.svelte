<script lang="ts">
  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { page } from "$app/state";
  import { cn } from "$lib/utils";
  import { prefs } from "$lib/stores/prefs.svelte";
  import { online } from "$lib/offline/online.svelte";
  import { authState } from "$lib/auth/auth-state.svelte";
  import { authModal } from "$lib/auth/auth-modal.svelte";
  import { Icon } from "$lib/components/icon";
  import { Brand } from "$lib/components/brand";
  import { SearchTrigger } from "$lib/components/search";
  import { stickyNav } from "$lib/stores/sticky-nav.svelte";
  import type {
    BrandResolvedCopy,
    LocaleLink,
    MarketingDirection,
    NavResolvedCopy,
  } from "$lib/i18n/marketing-copy";
  import { publicHref } from "$lib/i18n/public-href";

  const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const DEFAULT_COPY: NavResolvedCopy = {
    primaryLabel: "Primary",
    offlineLabel: "Offline",
    offlineTitle: "You are offline",
    offlineDetail: "You are offline — cached content only.",
    searchQuran: "Search the Qur'an",
    account: "Account",
    signIn: "Sign in",
    settings: "Settings",
    openPanel: "Open panel",
    closePanel: "Close panel",
    sitePanel: "Site panel",
    appearance: "Appearance",
    toggleTheme: "Toggle theme",
    theme: "Theme",
    language: "Language",
    changeLanguage: "Change language",
    themeNames: { dark: "Dark", light: "Light" },
  };

  const DEFAULT_BRAND_COPY: BrandResolvedCopy = { homeLabel: "EasyQuran · home" };

  let {
    collapsible = false,
    copy = DEFAULT_COPY,
    brandCopy = DEFAULT_BRAND_COPY,
    brandHomeHref = "/",
    localeLinks = [],
    direction = "ltr",
  }: {
    collapsible?: boolean;
    copy?: NavResolvedCopy;
    brandCopy?: BrandResolvedCopy;
    brandHomeHref?: `/${string}`;
    localeLinks?: LocaleLink[];
    direction?: MarketingDirection;
  } = $props();

  let open = $state(false);
  let toggleBtn: HTMLButtonElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();

  let lastY = 0;
  let ticking = false;

  onMount(() => {
    authState.hydrate();
  });

  function onScroll() {
    if (!collapsible || ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      if (y <= 8) {
        stickyNav.expand();
      } else if (open) {
        // keep visible while the side panel is open
      } else if (y > lastY + 5) {
        stickyNav.collapse();
      } else if (y < lastY - 5) {
        stickyNav.expand();
      }
      lastY = y;
      ticking = false;
    });
  }

  $effect(() => {
    void page.url.pathname;
    open = false;
    stickyNav.expand();
    lastY = 0;
  });

  let hidden = $derived(collapsible && stickyNav.collapsed && !open);
  let navTop = $derived(hidden ? `-${stickyNav.height}px` : "0px");

  let wasOpen = false;
  $effect(() => {
    const isOpen = open;
    if (isOpen) {
      const first = panelEl?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    } else if (wasOpen) {
      toggleBtn?.focus();
    }
    wasOpen = isOpen;
  });

  let accountHref: "/account" | "/login" = $derived(
    authState.authenticated ? "/account" : "/login",
  );
  let accountLabel = $derived(authState.authenticated ? copy.account : copy.signIn);
  let panelOffset = $derived(direction === "rtl" ? -360 : 360);

  const SETTINGS_PATH = "/app/settings";
  let settingsRowHref = $derived(publicHref(SETTINGS_PATH));

  function toggle() {
    open = !open;
  }
  function close() {
    open = false;
  }
  function onAccountClick(e: MouseEvent): void {
    if (authState.authenticated) return;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    authModal.show("login");
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") open = false;
  }
  function onPanelKeydown(e: KeyboardEvent) {
    if (e.key !== "Tab" || !panelEl) return;
    const focusables = Array.from(panelEl.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusables.length === 0) return;
    // `focusables.length === 0` already returned above, so both ends exist.
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} onscroll={onScroll} />

<nav
  aria-label={copy.primaryLabel}
  style:top={navTop}
  class={cn(
    "sticky z-50 border-b border-line bg-bg/86 backdrop-blur-xl backdrop-saturate-150",
    collapsible && "transition-[top] duration-200 ease-out",
  )}
>
  <div class="flex h-[60px] items-center gap-4 px-5 sm:px-7 lg:px-10">
    <span class="me-auto" inert={open || undefined} aria-hidden={open || undefined}>
      <Brand homeHref={brandHomeHref} homeLabel={brandCopy.homeLabel} />
    </span>

    <div class="flex items-center gap-2">
      {#if online.hydrated && !online.online}
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-bg-2 px-2.5 py-1 text-xs text-fg-2"
          role="status"
          aria-label={copy.offlineLabel}
          title={copy.offlineTitle}
        >
          <span class="sr-only">{copy.offlineLabel}</span>
          <span class="inline-block size-1.5 rounded-full bg-pop" aria-hidden="true"></span>
          <span class="hidden sm:inline">{copy.offlineLabel}</span>
        </span>
      {/if}
      <SearchTrigger label={copy.searchQuran} inert={open} />
      <a
        href={publicHref(accountHref)}
        aria-label={accountLabel}
        title={accountLabel}
        inert={open || undefined}
        aria-hidden={open || undefined}
        onclick={onAccountClick}
        class="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line-2 text-fg-2 transition-colors duration-150 hover:bg-bg-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Icon name="user" size={18} title={accountLabel} />
      </a>
      <button
        type="button"
        onclick={toggle}
        aria-expanded={open}
        aria-controls="site-panel"
        aria-label={open ? copy.closePanel : copy.openPanel}
        title={open ? copy.closePanel : copy.openPanel}
        bind:this={toggleBtn}
        class="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line-2 text-fg-2 transition-colors duration-150 hover:bg-bg-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Icon name={open ? "x" : "menu"} size={20} />
      </button>
    </div>
  </div>
</nav>

{#if open}
  <button
    type="button"
    aria-label={copy.closePanel}
    tabindex="-1"
    class="fixed inset-0 top-[60px] z-40 cursor-default bg-bg/40 backdrop-blur-sm"
    transition:fade={{ duration: 150 }}
    onclick={close}
  ></button>
  <div
    id="site-panel"
    role="dialog"
    aria-modal="true"
    aria-label={copy.sitePanel}
    dir={direction}
    tabindex="-1"
    bind:this={panelEl}
    onkeydown={onPanelKeydown}
    transition:fly={{ x: panelOffset, duration: 220, easing: cubicOut }}
    class="fixed end-0 top-[60px] bottom-0 z-50 flex w-[340px] max-w-[88vw] flex-col border-s border-line bg-bg/95 backdrop-blur-xl"
  >
    <div class="flex flex-col gap-6 p-5 sm:p-6">
      <section class="flex flex-col gap-3">
        <h2 class="eyebrow mb-0">{copy.appearance}</h2>
        <button
          type="button"
          onclick={() => prefs.toggleTheme()}
          aria-label={copy.toggleTheme}
          class="flex w-full items-center justify-between rounded-lg border border-line-2 bg-bg-1 px-3.5 py-3 text-sm text-fg-2 transition-colors hover:bg-bg-2 hover:text-fg"
        >
          <span class="inline-flex items-center gap-2.5">
            <Icon name={prefs.theme === "dark" ? "moon" : "sun"} size={16} />
            {copy.theme}
          </span>
          <span class="text-xs text-fg-3">{copy.themeNames[prefs.theme]}</span>
        </button>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="eyebrow mb-0">{copy.settings}</h2>
        <a
          href={settingsRowHref}
          class="flex w-full items-center gap-2.5 rounded-lg border border-line-2 bg-bg-1 px-3.5 py-3 text-sm text-fg-2 transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Icon name="rows" size={16} />
          {copy.settings}
        </a>
      </section>

      {#if localeLinks.length > 0}
        <section class="flex flex-col gap-3">
          <h2 class="eyebrow mb-0">{copy.language}</h2>
          <div class="grid grid-cols-2 gap-2" aria-label={copy.changeLanguage}>
            {#each localeLinks as item (item.locale)}
              <a
                href={publicHref(item.href)}
                lang={item.locale}
                dir={item.direction}
                aria-current={item.current ? "page" : undefined}
                aria-label={`${copy.changeLanguage}: ${item.label}`}
                data-sveltekit-reload
                class={cn(
                  "rounded-lg border px-3 py-2 text-center text-sm transition-colors",
                  item.current
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-line-2 text-fg-2 hover:bg-bg-2 hover:text-fg",
                )}
              >{item.label}</a>
            {/each}
          </div>
        </section>
      {/if}

      {#if online.hydrated && !online.online}
        <p
          class="flex items-center gap-2 rounded-lg border border-line-2 bg-bg-1 px-3.5 py-3 text-xs text-fg-3"
          role="status"
        >
          <span class="inline-block size-1.5 rounded-full bg-pop" aria-hidden="true"></span>
          {copy.offlineDetail}
        </p>
      {/if}
    </div>
  </div>
{/if}
