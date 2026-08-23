<script lang="ts">
  import { tick } from "svelte";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { OfflinePack } from "$lib/components";
  import { isArabicSourceId } from "$lib/data/quran-types";
  import { TRANSLATION_CATALOGUE_BY_ID } from "$lib/quran/catalogue";
  import { sourceProfile } from "$lib/quran/view/source-profiles";
  import { purgeUserCaches } from "$lib/offline/messages";
  import type { StorageArtifactInfo } from "$lib/quran/protocol";
  import {
    isQuotaHigh,
    isTranslationCapHigh,
    storageReport,
    type DeleteOutcome,
  } from "$lib/stores/storage-report.svelte";
  import { readerSource } from "$lib/stores/reader-settings.svelte";
  import { stackedTranslations } from "$lib/stores/stacked-translations.svelte";
  import { formatBytes } from "$lib/utils";
  import { cn } from "$lib/utils";
  import type { SettingsCopy } from "$lib/i18n/settings-copy";
  import type { UiLocale } from "$lib/i18n/locales";
  import UsageBar from "./UsageBar.svelte";
  import StorageArtifactRow from "./StorageArtifactRow.svelte";

  let {
    id,
    heading,
    copy,
  }: {
    id: string;
    heading: string;
    copy: SettingsCopy["storage"];
  } = $props();

  // SAFETY: paraglide is compiled for exactly the UI locales (en/ar in messages/), so getLocale() only ever returns a UiLocale at runtime.
  const locale = getLocale() as UiLocale;

  const report = storageReport;

  const phase = $derived(report.phase);
  const artifacts = $derived(report.artifacts);
  const layers = $derived(report.layers);
  const quota = $derived(report.quota);
  const usage = $derived(report.usage);

  const arabicArtifacts = $derived(artifacts.filter((a) => isArabicSourceId(a.id)));
  const translationArtifacts = $derived(
    artifacts
      .filter((a) => !isArabicSourceId(a.id))
      .toSorted((a, b) => b.sizeBytes - a.sizeBytes),
  );
  const inUseIds = $derived(
    new Set([...(readerSource.sourceId ? [readerSource.sourceId] : []), ...stackedTranslations.ids]),
  );
  function opfsSupported(): boolean {
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- capability probe mirroring hasOpfs(); `navigator` is absent in some runtimes and getDirectory is an optional member, so typeof is the honest check
    return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
  }
  let opfsAbsent = $state(false);
  let hasController = $state(false);
  const usedLabel = $derived(
    usage !== null && quota !== null
      ? copy.usedOf(formatBytes(usage))
      : copy.usage,
  );
  const quotaHigh = $derived(isQuotaHigh(usage, quota));
  const capHigh = $derived(isTranslationCapHigh(layers));

  let confirmingAll = $state(false);
  let busyAll = $state(false);
  let actionNotice = $state<string | null>(null);
  let refocusRemoveAll = $state(false);
  let downloadsHeading = $state<HTMLHeadingElement>();
  let persistHeading = $state<HTMLHeadingElement>();
  let removeAllButton = $state<HTMLButtonElement>();
  let confirmAllButton = $state<HTMLButtonElement>();
  let clearingPages = $state(false);
  let clearedPages = $state(false);
  let persistBusy = $state(false);
  let persistDeclined = $state(false);

  $effect(() => {
    opfsAbsent = !opfsSupported();
    const sw = navigator.serviceWorker;
    const sync = () => {
      hasController = !!sw?.controller;
    };
    sync();
    sw?.addEventListener("controllerchange", sync);
    return () => sw?.removeEventListener("controllerchange", sync);
  });

  $effect(() => {
    report.hydrate();
    return () => report.dispose();
  });

  $effect(() => {
    if (confirmingAll && confirmAllButton) confirmAllButton.focus();
  });

  $effect(() => {
    if (refocusRemoveAll && removeAllButton) {
      removeAllButton.focus();
      refocusRemoveAll = false;
    }
  });

  function artifactName(sourceId: string): string {
    if (isArabicSourceId(sourceId)) {
      return copy.scripts[sourceProfile(sourceId).script];
    }
    const entry = TRANSLATION_CATALOGUE_BY_ID.get(sourceId);
    if (entry) return entry.name;
    return sourceId;
  }

  function storeLabelFor(store: StorageArtifactInfo["store"]): string {
    if (store === "opfs") return copy.stores.opfs;
    if (store === "session") return copy.stores.memory;
    return copy.stores.idb;
  }

  function localizedLanguageName(code: string, fallback: string): string {
    try {
      return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function artifactLanguage(sourceId: string): string | null {
    if (isArabicSourceId(sourceId)) return null;
    const entry = TRANSLATION_CATALOGUE_BY_ID.get(sourceId);
    if (entry) {
      return localizedLanguageName(entry.languageCode, entry.language);
    }
    return null;
  }

  async function removeOne(artifactId: string): Promise<DeleteOutcome> {
    const outcome = await report.deleteArtifact(artifactId);
    if (outcome === "ok") {
      actionNotice = copy.removed(artifactName(artifactId));
      await tick();
      downloadsHeading?.focus();
    }
    return outcome;
  }

  function cancelConfirmAll() {
    if (busyAll) return;
    confirmingAll = false;
    refocusRemoveAll = true;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && confirmingAll) {
      event.stopPropagation();
      cancelConfirmAll();
    }
  }

  async function confirmRemoveAll() {
    if (busyAll) return;
    busyAll = true;
    const targets = translationArtifacts.filter((a) => !inUseIds.has(a.id)).length;
    const result = await report.clearAllTranslations([...inUseIds]);
    busyAll = false;
    confirmingAll = false;
    const removed = targets - result.failures;
    if (result.freedBytes > 0) actionNotice = copy.freed(formatBytes(result.freedBytes));
    else if (removed > 0) actionNotice = copy.removedAll;
    else actionNotice = copy.empty;
    if (result.failures > 0) actionNotice += ` · ${copy.busyError}`;
    await tick();
    downloadsHeading?.focus();
  }

  async function clearPages() {
    clearingPages = true;
    await purgeUserCaches();
    clearingPages = false;
    clearedPages = true;
    await report.refresh();
  }

  async function requestPersist() {
    persistBusy = true;
    const granted = await report.requestPersist();
    persistBusy = false;
    if (granted) {
      persistDeclined = false;
      persistHeading?.focus();
    } else {
      persistDeclined = true;
    }
  }

  const badge = "rounded border border-line-2 px-1.5 py-0.5 text-xs leading-none text-fg-3";
  const quiet =
    "rounded-lg border border-line-2 px-3.5 py-2.5 text-[13.5px] text-fg-2 transition-colors hover:border-line hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
  const danger =
    "rounded-lg border border-red-500/50 px-3.5 py-2.5 text-[13.5px] text-red-400 transition-colors hover:bg-red-500/10";
  const dangerConfirm =
    "rounded-lg border border-red-500/60 bg-red-500/10 px-3.5 py-2.5 text-[13.5px] text-red-400 transition-colors hover:bg-red-500/20";
</script>

<div id={id} tabindex="-1" class="scroll-mt-24">
  <h2 class="text-[17px] font-semibold tracking-[-0.02em] text-fg">{heading}</h2>
  <p class="mt-1 max-w-[70ch] text-[14.5px] leading-relaxed text-fg-2">{copy.intro}</p>

  {#if phase === "boot"}
    <p class="mt-4 text-[13.5px] text-fg-3" role="status">{copy.loading}</p>
  {:else if phase === "error"}
    <div class="mt-4 grid gap-2.5">
      <p class="text-[13.5px] text-fg-3">{copy.error}</p>
      <div>
        <button type="button" onclick={() => report.refresh()} class={quiet}>
          {copy.retry}
        </button>
      </div>
    </div>
  {:else}
    <section class="mb-6 mt-6" aria-label={copy.usage}>
      {#if quota !== null}
        <p class="text-[15px] font-medium tabular-nums text-fg">{usedLabel}</p>
        <p class="mt-0.5 text-[13.5px] tabular-nums text-fg-3">
          {copy.quotaNote(formatBytes(quota))}
        </p>
        <div class="mt-2.5">
          <UsageBar layers={layers} labels={copy.layers} usageBytes={usage} {usedLabel} />
        </div>
      {:else}
        <p class="text-[15px] text-fg">{copy.usage}</p>
        <div class="mt-2.5">
          <UsageBar layers={layers} labels={copy.layers} usageBytes={null} {usedLabel} />
        </div>
      {/if}
      {#if quotaHigh}
        <p class="mt-2 text-[13.5px] text-red-400">{copy.quotaWarning}</p>
      {/if}
      {#if capHigh}
        <p class="mt-2 text-[13.5px] text-fg-3">{copy.capNote}</p>
      {/if}
      <p class="mt-2 text-[13.5px] leading-snug text-fg-3">{copy.estimateNote}</p>
    </section>

    <div class="divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-bg-1">
      {#if opfsAbsent}
        <p class="px-4 py-3.5 text-[13.5px] text-fg-3 sm:px-5">{copy.opfsAbsent}</p>
      {/if}

      <section aria-label={copy.persistHeading} class="divide-y divide-line">
        <div class="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div class="min-w-0">
            <h3 class="text-[14.5px] font-medium text-fg" tabindex="-1" bind:this={persistHeading}>
              {copy.persistHeading}
            </h3>
            <p aria-live="polite" class="mt-0.5 text-[13.5px] leading-snug text-fg-3">
              {#if report.persisted === true}
                {copy.persistGranted}
              {:else if persistDeclined && report.persisted === false}
                {copy.persistDeclined}
              {:else if report.persisted === false}
                {copy.persistDenied}
              {:else}
                {copy.persistUnavailable}
              {/if}
            </p>
          </div>
          {#if report.persisted === false && !persistDeclined}
            <button
              type="button"
              disabled={persistBusy}
              onclick={requestPersist}
              class={cn(quiet, "shrink-0")}
            >
              {copy.persistRequest}
            </button>
          {/if}
        </div>
      </section>

      {#if arabicArtifacts.length > 0}
        <section aria-label={copy.requiredGroup} class="divide-y divide-line">
          <div class="px-4 py-3.5 sm:px-5">
            <h3 class="text-[14.5px] font-medium text-fg">{copy.requiredGroup}</h3>
            <p class="mt-0.5 text-[13.5px] leading-snug text-fg-3">{copy.requiredNote}</p>
          </div>
          {#each arabicArtifacts as artifact (artifact.id)}
            <div class="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <span class="truncate text-[14.5px] text-fg">{artifactName(artifact.id)}</span>
                <span class={badge}>{storeLabelFor(artifact.store)}</span>
              </div>
              <span class="shrink-0 text-end text-[13.5px] tabular-nums text-fg-3">
                {formatBytes(artifact.sizeBytes)}
              </span>
            </div>
          {/each}
        </section>
      {/if}

      <section aria-label={copy.downloadsHeading} class="divide-y divide-line">
        <div class="px-4 py-3.5 sm:px-5">
          <h3
            class="text-[14.5px] font-medium text-fg"
            tabindex="-1"
            bind:this={downloadsHeading}
          >
            {copy.downloadsHeading}
          </h3>
        </div>
        {#if translationArtifacts.length === 0}
          <div class="px-4 py-3.5 sm:px-5">
            <p class="text-[13.5px] text-fg-3">{copy.empty}</p>
          </div>
        {:else}
          {#each translationArtifacts as artifact (artifact.id)}
            <div class="px-4 sm:px-5">
              <StorageArtifactRow
                {artifact}
                name={artifactName(artifact.id)}
                language={artifactLanguage(artifact.id)}
                inUse={inUseIds.has(artifact.id)}
                {copy}
                {locale}
                onremove={removeOne}
              />
            </div>
          {/each}
        {/if}
        <div class="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5" aria-live="polite">
          {#if confirmingAll}
            <span class="text-[13.5px] text-fg-3">{copy.removeAllConfirm}</span>
            <button
              type="button"
              bind:this={confirmAllButton}
              onclick={confirmRemoveAll}
              onkeydown={onKeydown}
              class={dangerConfirm}
            >
              {copy.removeConfirmAction}
            </button>
            <button
              type="button"
              onclick={cancelConfirmAll}
              onkeydown={onKeydown}
              class={quiet}
            >
              {copy.removeCancel}
            </button>
          {:else}
            {#if translationArtifacts.length > 0}
              <button
                type="button"
                bind:this={removeAllButton}
                onclick={() => (confirmingAll = true)}
                class={danger}
              >
                {copy.removeAll}
              </button>
            {/if}
            {#if actionNotice}
              <span class="text-[13.5px] text-fg-3">{actionNotice}</span>
            {/if}
          {/if}
        </div>
      </section>

      <section aria-label={copy.offlinePack.heading} class="divide-y divide-line">
        <div class="px-4 py-3.5 sm:px-5">
          <OfflinePack copy={copy.offlinePack} headingTag="h3" />
          <p class="mt-1.5 text-[13.5px] leading-snug text-fg-3">{copy.offlinePackNote}</p>
        </div>
      </section>

      <div class="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          disabled={!hasController || clearingPages}
          title={hasController ? undefined : copy.clearPagesUnavailable}
          onclick={clearPages}
          class={quiet}
        >
          {copy.clearPages}
        </button>
        {#if clearedPages}
          <span class="text-[13.5px] text-fg-3" aria-live="polite">{copy.clearPagesDone}</span>
        {/if}
        {#if !hasController}
          <span class="sr-only">{copy.clearPagesUnavailable}</span>
        {/if}
      </div>
    </div>

    <p class="mt-4 text-[13.5px] leading-snug text-fg-3">{copy.retentionNote}</p>
  {/if}
</div>
