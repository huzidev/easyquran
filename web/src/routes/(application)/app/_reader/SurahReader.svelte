<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { SvelteSet } from "svelte/reactivity";
  import { beforeNavigate, invalidateAll, replaceState } from "$app/navigation";
  import { page as appPage } from "$app/state";
  import {
    parseKey,
    surahLocalPagePathFor,
    surahRouteContext,
    type SurahLocalPageData,
    type SurahLocalPageLink,
    type SurahLink,
  } from "$lib/data/quran";
  import { loadQuranData } from "$lib/data/quran-data-client";
  import { getReaderUiCopy } from "$lib/i18n/reader-copy";
  import { readerHrefFor } from "$lib/i18n/reader";
  import { publicHref } from "$lib/i18n/public-href";
  import { resumeToLastRead } from "$lib/reader/resume";
  import { Icon } from "$lib/components/icon";
  import { TooltipProvider } from "$lib/components/ui/tooltip";
  import { quranWorker } from "$lib/quran/worker-client";
  import { TRANSLATION_CATALOGUE } from "$lib/quran/catalogue";
  import type { ReadTierStatus } from "$lib/quran/fetch";
  import { virtualPageWindow } from "$lib/quran/virtual-pages";
  import { bodyText } from "$lib/quran/view/source-view";
  import { headerText } from "$lib/quran/view/presentation";
  import { quran } from "$lib/stores/quran.svelte";
  import { reader, type ReaderMode } from "$lib/stores/reader.svelte";
  import { withModeParam } from "$lib/reader/mode-param";
  import { PREPARE_RELOAD, PREPARE_RELOAD_EVENT, UPDATE_BROADCAST_CHANNEL } from "$lib/offline/messages";
  import { PageHeightCache, stablePageHeight, widthBucket } from "./page-heights";
  import { ayahIndexValidator } from "./range-validate";
  import {
    parseHistoryState,
    persistReaderPosition,
    reloadPositionState,
    type SurahReaderHistoryState,
  } from "./reader-history";
  import {
    captureViewportAnchor,
    closestPage,
    nextFrame,
    restoreViewportAnchor,
    viewportMarker,
    type ViewportAnchor,
  } from "./viewport-anchor";
  import ReaderHeader from "./ReaderHeader.svelte";
  import ReaderPageNav from "./ReaderPageNav.svelte";
  import ReaderStatusBanner from "./ReaderStatusBanner.svelte";
  import { ReaderDegradationState } from "./reader-degradation.svelte";
  import VerseRow from "./VerseRow.svelte";
  import {
    createStackedTranslations,
    erroredFor,
    loadingFor,
    stackedFor,
  } from "./stacked-translations.svelte";

  let {
    initial,
    previousPage,
    nextPage,
    previousSurah,
    nextSurah,
    anchorScrolling = false,
    onVisiblePage,
  }: {
    initial: SurahLocalPageData;
    previousPage: SurahLocalPageLink | null;
    nextPage: SurahLocalPageLink | null;
    previousSurah: SurahLink | null;
    nextSurah: SurahLink | null;
    anchorScrolling?: boolean;
    onVisiblePage?: (pageData: SurahLocalPageData) => void;
  } = $props();

  const copy = getReaderUiCopy();

  let loadedPages = $state.raw<SurahLocalPageData[]>([]);
  const pages = $derived.by(() => {
    const byPage = new Map<number, SurahLocalPageData>();
    for (const pageData of [initial, ...loadedPages]) {
      const existing = byPage.get(pageData.page.localPage);
      if (!existing || pageData.ayahs.length > 0) byPage.set(pageData.page.localPage, pageData);
    }
    return [...byPage.values()].sort((a, b) => a.page.localPage - b.page.localPage);
  });
  let readerPages: HTMLElement | null = $state(null);
  const loadingPages = new SvelteSet<number>();
  const degradation = new ReaderDegradationState();
  let initialRetryInFlight = false;
  let clientMounted = $state(false);
  let activeLocalPage = $state<number | null>(null);
  let virtualCenterPage = $state<number | null>(null);
  let readerWidth = $state(0);
  let lastScrollY = 0;
  let touchY: number | null = null;
  let scrollFrame = 0;
  let forwardFillFrame = 0;
  let historyWriteTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressScroll = false;
  let sawUserInput = false;
  let userScrolled = false;
  let layoutRepairPending = false;
  let virtualShiftPage: number | null = null;
  let stableAnchor: ViewportAnchor | null = null;
  let positionQueue = Promise.resolve();
  const heightCache = new PageHeightCache();
  const loadAheadPx = 900;
  const visibleLocalPage = $derived(activeLocalPage ?? initial.page.localPage);
  const virtualFocusPage = $derived(virtualCenterPage ?? visibleLocalPage);
  const firstLoaded = $derived(pages[0]!);
  const lastLoaded = $derived(pages.at(-1)!);
  const sourceId = $derived(initial.normalization.sourceId);
  const routeContext = $derived(surahRouteContext(sourceId));
  const isTranslationSource = $derived(routeContext.kind !== "arabic");
  const routeKey = $derived(`${sourceId}:${initial.surah.num}:${initial.page.localPage}`);
  let lastRouteKey: string | null = null;
  let stackedQuranData = $state<Awaited<ReturnType<typeof loadQuranData>> | null>(null);
  const stackedController = createStackedTranslations({
    from: () => (pages.length ? Math.min(...pages.map((p) => p.page.startGlobal)) : 0),
    to: () => (pages.length ? Math.max(...pages.map((p) => p.page.endGlobal)) : 0),
    validator: () => (stackedQuranData ? ayahIndexValidator(stackedQuranData) : null),
    primarySourceId: () => (isTranslationSource ? sourceId : null),
    catalogue: () => TRANSLATION_CATALOGUE,
    routeKey: () => `${sourceId}:${initial.surah.num}`,
  });
  const stackedAnnouncement = $derived.by(() => {
    const st = stackedController.state;
    if (st.order.some((id) => st.status.get(id) === "error")) return copy.stacked.error;
    if (st.order.some((id) => st.status.get(id) === "loading")) return copy.stacked.loading;
    return "";
  });
  $effect(() => stackedController.sync());
  onDestroy(() => stackedController.dispose());
  onMount(() => {
    void loadQuranData()
      .then((qd) => {
        stackedQuranData = qd;
      })
      .catch(() => {});
  });
  function pagePathFor(localPage: number): `/${string}` {
    return readerHrefFor(
      copy.locale,
      surahLocalPagePathFor(routeContext, initial.surah, localPage),
    );
  }
  const renderedPageNumbers = $derived.by(
    () =>
      new Set(
        virtualPageWindow(
          pages.map((pageData) => pageData.page.localPage),
          virtualFocusPage,
        ),
      ),
  );

  function captureAnchor(): ViewportAnchor | null {
    return captureViewportAnchor(readerPages);
  }

  function restoreAnchor(anchor: ViewportAnchor): void {
    if (restoreViewportAnchor(readerPages, anchor)) lastScrollY = window.scrollY;
  }

  function markAnchorRead(anchor: ViewportAnchor | null | undefined): void {
    if (!userScrolled || anchor?.kind !== "verse") return;
    const { num, n } = parseKey(anchor.verseKey);
    if (num === initial.surah.num) {
      reader.markRead(num, n, sourceId);
      reader.setLastReadAnchor({ verseKey: anchor.verseKey, localPage: anchor.localPage, ratio: anchor.ratio });
    }
  }

  function measurePage(localPage: number): Attachment<HTMLElement> {
    return (node) => {
      let lastTotalHeight = 0;
      const measure = () => {
        const rect = node.getBoundingClientRect();
        const parentWidth = readerPages?.getBoundingClientRect().width ?? rect.width;
        const totalHeight = rect.height;
        heightCache.save(localPage, stablePageHeight(node, rect), parentWidth);
        if (
          lastTotalHeight > 0 &&
          Math.abs(totalHeight - lastTotalHeight) > 1 &&
          clientMounted &&
          !suppressScroll &&
          !layoutRepairPending &&
          stableAnchor &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        ) {
          const anchor = stableAnchor;
          layoutRepairPending = true;
          void preserveViewportFrom(() => anchor, () => undefined, true).finally(() => {
            layoutRepairPending = false;
          });
        }
        lastTotalHeight = totalHeight;
      };
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      measure();
      return () => observer.disconnect();
    };
  }

  function preserveViewportFrom(
    anchorSource: () => ViewportAnchor | null,
    change: () => void,
    waitForLayout = false,
  ): Promise<void> {
    const operation = async () => {
      const anchor = anchorSource();
      suppressScroll = true;
      try {
        change();
        await tick();
        if (waitForLayout) await nextFrame();
        if (anchor) restoreAnchor(anchor);
        await nextFrame();
        updateVisiblePage();
        stableAnchor = captureAnchor();
      } finally {
        suppressScroll = false;
      }
    };
    const result = positionQueue.then(operation, operation);
    positionQueue = result.catch(() => undefined);
    return result;
  }

  function preserveViewport(change: () => void, waitForLayout = false): Promise<void> {
    return preserveViewportFrom(captureAnchor, change, waitForLayout);
  }

  const captureReaderPages: Attachment<HTMLElement> = (node) => {
    readerPages = node;
    const updateWidth = () => {
      const nextWidth = Math.round(node.getBoundingClientRect().width);
      if (nextWidth > 0 && widthBucket(nextWidth) !== widthBucket(readerWidth)) {
        const anchor = stableAnchor;
        readerWidth = nextWidth;
        if (
          clientMounted &&
          anchor &&
          node.getBoundingClientRect().bottom > 0 &&
          node.getBoundingClientRect().top < window.innerHeight
        ) {
          void preserveViewportFrom(
            () => anchor,
            () => {
              virtualCenterPage = visibleLocalPage;
            },
            true,
          );
        }
      } else if (readerWidth === 0) {
        readerWidth = nextWidth;
      }
      scheduleForwardFill();
    };
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    updateWidth();
    return () => {
      observer.disconnect();
      if (readerPages === node) readerPages = null;
    };
  };

  function shiftVirtualWindow(localPage: number): void {
    if (renderedPageNumbers.has(localPage) || virtualShiftPage === localPage) return;
    virtualShiftPage = localPage;
    // SAFETY: document.activeElement is Element | null; only page/render elements can hold focus in
    // the reader, and closest<HTMLElement> types the match for dataset.localPage access below.
    const focusedPage = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
      "[data-page-rendered]",
    );
    if (
      focusedPage &&
      Math.abs(Number(focusedPage.dataset.localPage) - localPage) > 2 &&
      readerPages
    ) {
      readerPages.focus({ preventScroll: true });
    }
    void preserveViewport(() => {
      virtualCenterPage = localPage;
    }).finally(() => {
      virtualShiftPage = null;
    });
  }

  function warmVirtualWindow(direction: number): void {
    if (!readerPages || direction === 0) return;
    const candidates = [
      ...readerPages.querySelectorAll<HTMLElement>("[data-page-spacer]"),
    ].filter((spacer) => {
      const pageNumber = Number(spacer.dataset.localPage);
      const rect = spacer.getBoundingClientRect();
      return (
        rect.bottom > -loadAheadPx &&
        rect.top < window.innerHeight + loadAheadPx &&
        (direction > 0 ? pageNumber > virtualFocusPage : pageNumber < virtualFocusPage)
      );
    });
    candidates.sort((a, b) => {
      const aPage = Number(a.dataset.localPage);
      const bPage = Number(b.dataset.localPage);
      return direction > 0 ? aPage - bPage : bPage - aPage;
    });
    const localPage = Number(candidates[0]?.dataset.localPage);
    if (Number.isSafeInteger(localPage)) shiftVirtualWindow(localPage);
  }

  function changeMode(mode: ReaderMode): void {
    if (reader.mode === mode) return;
    void preserveViewport(() => {
      virtualCenterPage = visibleLocalPage;
      reader.setMode(mode);
      replaceState(withModeParam(appPage.url, mode), appPage.state);
    }, true);
  }

  function changeTypography(change: () => void): void {
    void preserveViewport(() => {
      virtualCenterPage = visibleLocalPage;
      change();
    }, true);
  }

  function toggleNote(verseKey: string): void {
    void preserveViewport(() => {
      reader.toggleNote(verseKey);
    }, true);
  }

  function cachePage(pageData: SurahLocalPageData): void {
    reader.seedAyahs(
      pageData.ayahs.map((ayah) => ({
        key: ayah.key,
        text: bodyText(ayah.text, ayah.ayah, pageData.normalization),
      })),
    );
  }

  function historySnapshot(localPage = visibleLocalPage): SurahReaderHistoryState {
    const pageNumbers = virtualPageWindow(
      pages.map((pageData) => pageData.page.localPage),
      localPage,
    );
    const included = new Set(pageNumbers);
    return {
      version: 1,
      surahNum: initial.surah.num,
      activeLocalPage: localPage,
      pages: pages.filter((pageData) => included.has(pageData.page.localPage)),
      anchor: captureAnchor(),
    };
  }

  let lastWrittenUrl: string | null = null;
  let lastWrittenPage: number | null = null;

  function writeHistoryState(
    url: string | URL = window.location.href,
    localPage = visibleLocalPage,
  ): void {
    const snapshot = historySnapshot(localPage);
    const next = withModeParam(url, reader.mode, window.location.href);
    const target = next.href;
    if (target !== lastWrittenUrl || localPage !== lastWrittenPage) {
      replaceState(next, {
        ...appPage.state,
        surahReader: snapshot,
      });
      lastWrittenUrl = target;
      lastWrittenPage = localPage;
    }
    persistReaderPosition(snapshot);
    markAnchorRead(snapshot.anchor);
  }

  function scheduleHistoryWrite(): void {
    if (historyWriteTimer) clearTimeout(historyWriteTimer);
    historyWriteTimer = setTimeout(() => {
      historyWriteTimer = null;
      writeHistoryState();
    }, 180);
  }

  async function restoreHistory(): Promise<void> {
    const saved =
      parseHistoryState(appPage.state.surahReader, initial.surah.num) ??
      reloadPositionState(initial);
    if (saved) {
      suppressScroll = true;
      try {
        await restoreHistoryFrom(saved);
        await nextFrame();
      } finally {
        suppressScroll = false;
      }
      return;
    }
    const pending = reader.consumePendingAnchor();
    if (!pending || parseKey(pending.verseKey).num !== initial.surah.num) return;
    const anchor: ViewportAnchor = {
      kind: "verse",
      localPage: pending.localPage,
      verseKey: pending.verseKey,
      viewportPoint: viewportMarker(),
      ratio: pending.ratio,
    };
    suppressScroll = true;
    try {
      await nextFrame();
      await nextFrame();
      restoreAnchor(anchor);
      await document.fonts.ready;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 80));
      restoreAnchor(anchor);
      stableAnchor = captureAnchor();
    } finally {
      suppressScroll = false;
    }
  }

  async function restoreHistoryFrom(saved: SurahReaderHistoryState): Promise<void> {
    const byPage = new Map<number, SurahLocalPageData>();
    for (const pageData of saved.pages) {
      if (
        pageData.surah?.num === initial.surah.num &&
        Number.isSafeInteger(pageData.page?.localPage) &&
        pageData.page.localPage >= 1 &&
        pageData.page.localPage <= initial.pageCount
      ) {
        byPage.set(pageData.page.localPage, pageData);
      }
    }
    byPage.delete(initial.page.localPage);
    loadedPages = [...byPage.values()];
    activeLocalPage = saved.activeLocalPage;
    virtualCenterPage = saved.activeLocalPage;
    for (const pageData of saved.pages) cachePage(pageData);
    await tick();
    onVisiblePage?.(
      saved.pages.find((pageData) => pageData.page.localPage === saved.activeLocalPage) ?? initial,
    );
    await nextFrame();
    await nextFrame();
    if (saved.anchor) restoreAnchor(saved.anchor);
    await document.fonts.ready;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 80));
    if (saved.anchor) restoreAnchor(saved.anchor);
    stableAnchor = captureAnchor();
    updateVisiblePage();
  }

  async function loadPage(localPage: number): Promise<void> {
    if (
      localPage < 1 ||
      localPage > initial.pageCount ||
      pages.some((item) => item.page.localPage === localPage && item.ayahs.length > 0) ||
      loadingPages.has(localPage)
    ) {
      return;
    }
    loadingPages.add(localPage);
    // Do NOT blanket-clear degradation.loadFailed here: an adjacent-page load must
    // not hide an already-failed page's inline retry. Failure clears only on this
    // page's own success (below) or on route change.
    const readRouteKey = routeKey;
    try {
      const quranData = await loadQuranData();
      const pageDataRange = quranData.surahLocalPage(initial.surah.num, localPage);
      if (!pageDataRange) {
        throw new Error(`Unknown Surah page ${initial.surah.num}:${localPage}`);
      }
      const range = await quranWorker.readRange(
        pageDataRange.startGlobal,
        pageDataRange.endGlobal,
        ayahIndexValidator(quranData),
        isTranslationSource ? sourceId : undefined,
        (status: ReadTierStatus) => {
          if (readRouteKey !== routeKey) return;
          degradation.applyTierStatus(status);
        },
      );
      if (readRouteKey !== routeKey) return;
      const normalization = range.normalizations.find(
        (value) => value.surah === initial.surah.num,
      );
      if (!normalization || range.ayahs.some((ayah) => ayah.surah !== initial.surah.num)) {
        throw new Error(`Invalid Surah page ${initial.surah.num}:${localPage}`);
      }
      const pageData: SurahLocalPageData = {
        surah: initial.surah,
        page: pageDataRange,
        pageCount: initial.pageCount,
        ayahs: range.ayahs,
        normalization,
      };
      cachePage(pageData);
      await preserveViewport(() => {
        loadedPages = [...loadedPages, pageData];
      });
      degradation.clearIfMatches(localPage);
      if (clientMounted) writeHistoryState();
    } catch {
      if (readRouteKey === routeKey) {
        degradation.markPageFailed(localPage);
      }
    } finally {
      loadingPages.delete(localPage);
    }
  }

  async function retryInitialPage(): Promise<void> {
    if (initialRetryInFlight) return;
    initialRetryInFlight = true;
    const startKey = routeKey;
    try {
      await invalidateAll();
      if (startKey !== routeKey) return;
      if (initial.ayahs.length === 0) void loadPage(initial.page.localPage);
    } catch {
      if (startKey === routeKey && initial.ayahs.length === 0) {
        void loadPage(initial.page.localPage);
      }
    } finally {
      initialRetryInFlight = false;
    }
  }

  function retryDegradedPage(): void {
    if (initial.ayahs.length === 0) {
      void retryInitialPage();
    } else if (degradation.failedPage !== null) {
      degradation.loadFailed = false;
      void loadPage(degradation.failedPage);
    }
  }

  function requestPreviousPage(): void {
    const localPage = firstLoaded.page.localPage - 1;
    if (localPage >= 1) void loadPage(localPage);
  }

  function requestNextPage(): void {
    const localPage = lastLoaded.page.localPage + 1;
    if (localPage <= initial.pageCount) void loadPage(localPage);
  }

  function scheduleForwardFill(): void {
    if (forwardFillFrame) return;
    forwardFillFrame = requestAnimationFrame(() => {
      forwardFillFrame = 0;
      if (!readerPages) return;
      if (readerPages.getBoundingClientRect().bottom - window.innerHeight < loadAheadPx) {
        requestNextPage();
      }
    });
  }

  function setVisiblePage(localPage: number, anchor?: ViewportAnchor | null): void {
    if (!renderedPageNumbers.has(localPage)) shiftVirtualWindow(localPage);
    if (localPage === visibleLocalPage) return;
    activeLocalPage = localPage;
    const pageData = pages.find((item) => item.page.localPage === localPage);
    if (pageData) onVisiblePage?.(pageData);
    markAnchorRead(anchor !== undefined ? anchor : captureAnchor());
    writeHistoryState(publicHref(pagePathFor(localPage)), localPage);
  }

  function updateVisiblePage(anchor: ViewportAnchor | null = null): void {
    if (anchor) {
      setVisiblePage(anchor.localPage, anchor);
      return;
    }
    if (!readerPages) return;
    const section = closestPage(readerPages, viewportMarker());
    const localPage = Number(section?.dataset.localPage);
    if (Number.isSafeInteger(localPage)) setVisiblePage(localPage);
  }

  function processScroll(direction: number): void {
    scrollFrame = 0;
    if (suppressScroll || anchorScrolling) {
      stableAnchor = captureAnchor();
    } else {
      if (sawUserInput) userScrolled = true;
      warmVirtualWindow(direction);
      const anchor = captureAnchor();
      updateVisiblePage(anchor);
      stableAnchor = anchor;
      scheduleHistoryWrite();
    }
    if (!readerPages) return;
    const rect = readerPages.getBoundingClientRect();
    if (direction < 0 && rect.top > -loadAheadPx) requestPreviousPage();
    if (direction > 0 && rect.bottom - window.innerHeight < loadAheadPx) requestNextPage();
  }

  function onScroll(): void {
    const currentY = window.scrollY;
    if (suppressScroll || anchorScrolling) {
      lastScrollY = currentY;
      stableAnchor = captureAnchor();
      scheduleForwardFill();
      return;
    }
    const direction = Math.sign(currentY - lastScrollY);
    lastScrollY = currentY;
    if (direction !== 0 && sawUserInput) userScrolled = true;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => processScroll(direction));
  }

  function atScrollBoundary(direction: number): boolean {
    if (direction < 0) return window.scrollY <= 1;
    return window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1;
  }

  function onUserInput(): void {
    sawUserInput = true;
  }

  function onWheel(event: WheelEvent): void {
    sawUserInput = true;
    const direction = Math.sign(event.deltaY);
    if (direction !== 0 && atScrollBoundary(direction)) processScroll(direction);
  }

  function onTouchStart(event: TouchEvent): void {
    sawUserInput = true;
    touchY = event.touches[0]?.clientY ?? null;
  }

  function onTouchMove(event: TouchEvent): void {
    const nextY = event.touches[0]?.clientY;
    if (touchY === null || nextY === undefined) return;
    const direction = Math.sign(touchY - nextY);
    touchY = nextY;
    if (direction !== 0 && atScrollBoundary(direction)) processScroll(direction);
  }

  function onTouchEnd(): void {
    touchY = null;
  }

  function onResize(): void {
    scheduleForwardFill();
  }

  function onKeyDown(event: KeyboardEvent): void {
    // SAFETY: window-level keydown; target is the focused element (or null), and only the
    // HTMLElement fields isContentEditable/tagName are read to skip text-input contexts.
    const target = event.target as HTMLElement | null;
    if (
      target?.isContentEditable ||
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "SELECT"
    ) {
      return;
    }
    sawUserInput = true;
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      processScroll(-1);
    } else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") {
      processScroll(1);
    }
  }

  async function continueReading(): Promise<void> {
    if (!reader.hasLastRead) return;
    const ok = await resumeToLastRead(routeContext);
    if (!ok && reader.hasLastRead) degradation.loadFailed = true;
  }

  beforeNavigate(() => {
    if (!clientMounted) return;
    if (historyWriteTimer) {
      clearTimeout(historyWriteTimer);
      historyWriteTimer = null;
    }
    writeHistoryState();
  });

  $effect(() => {
    const key = routeKey;
    if (lastRouteKey !== null && lastRouteKey !== key) {
      degradation.reset();
    }
    lastRouteKey = key;
  });

  let lastTypography: string | null = null;
  $effect(() => {
    const typography = `${reader.arabicFont}:${reader.arabicSizePx}:${reader.translationSizePx}:${reader.translationFamily}`;
    if (lastTypography === typography) return;
    const firstRun = lastTypography === null;
    lastTypography = typography;
    if (firstRun) return;
    void preserveViewport(() => {
      virtualCenterPage = visibleLocalPage;
    }, true);
  });

  onMount(() => {
    clientMounted = true;
    lastScrollY = window.scrollY;
    cachePage(initial);
    if (initial.ayahs.length === 0) void retryInitialPage();
    void restoreHistory().then(() => {
      stableAnchor = captureAnchor();
      scheduleForwardFill();
      void nextFrame().then(() => writeHistoryState());
    });
    const stop = quranWorker.onStatus((status) => {
      if (status !== "ready") return;
      scheduleForwardFill();
    });
    let updateChannel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      updateChannel = new BroadcastChannel(UPDATE_BROADCAST_CHANNEL);
      updateChannel.addEventListener("message", (event) => {
        if (event.data?.type === PREPARE_RELOAD) writeHistoryState();
      });
    }
    const onPrepareReload = (): void => writeHistoryState();
    window.addEventListener(PREPARE_RELOAD_EVENT, onPrepareReload);
    scheduleForwardFill();
    return () => {
      stop();
      updateChannel?.close();
      window.removeEventListener(PREPARE_RELOAD_EVENT, onPrepareReload);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      if (forwardFillFrame) cancelAnimationFrame(forwardFillFrame);
      if (historyWriteTimer) clearTimeout(historyWriteTimer);
    };
  });
</script>

<svelte:window
  onscroll={onScroll}
  onwheel={onWheel}
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  onkeydown={onKeyDown}
  onpointerdown={onUserInput}
  onresize={onResize}
/>

<div class="reader-stack flex flex-col gap-4">
  {#if clientMounted && initial.ayahs.length === 0 && !degradation.loadFailed && quran.status !== "error"}
    <span class="sr-only" role="status" aria-live="polite">{copy.shell.opening}</span>
  {/if}

  {#if reader.hasLastRead}
    <button
      type="button"
      onclick={continueReading}
      aria-label={copy.shell.continueReading(reader.lastReadRef)}
      class="flex items-center gap-3 rounded-[12px] bg-accent-soft px-[18px] py-[13px] text-left transition-[filter] duration-150 hover:brightness-[0.98]"
    >
      <Icon name="play" size={15} class="flex-none text-accent" />
      <span class="text-sm text-accent">{copy.shell.continueReading(reader.lastReadRef)}</span>
      <span class="ml-auto text-[13px] text-accent">{copy.shell.jump} <span aria-hidden="true">→</span></span>
    </button>
  {/if}

  <div class="overflow-hidden rounded-2xl border border-line bg-bg-1">
    <ReaderHeader
      {initial}
      {visibleLocalPage}
      {clientMounted}
      onChangeMode={changeMode}
      onSmaller={() => changeTypography(() => reader.smaller())}
      onBigger={() => changeTypography(() => reader.bigger())}
    />

    <div class="sr-only" aria-live="polite">{stackedAnnouncement}</div>
    <div
      {@attach captureReaderPages}
      class="reader-pages"
      data-source-kind={isTranslationSource ? "translation" : "arabic"}
      tabindex="-1"
    >
      <TooltipProvider delayDuration={300}>
        {#each pages as pageData (pageData.page.localPage)}
          {#if renderedPageNumbers.has(pageData.page.localPage)}
            <section
              class="surah-page"
              data-local-page={pageData.page.localPage}
              data-page-rendered
              aria-labelledby="surah-page-{pageData.page.localPage}-title"
              {@attach measurePage(pageData.page.localPage)}
            >
              <h2 id="surah-page-{pageData.page.localPage}-title" class="sr-only">
                {copy.shell.surahPageTitle(initial.surah.name, pageData.page.localPage, initial.pageCount)}
              </h2>
              {#if pageData.page.startAyah === 1 && headerText(pageData.normalization)}
                <p dir="rtl" lang="ar" class="surah-opener py-3 text-center text-fg-3">
                  {headerText(pageData.normalization)}
                </p>
              {/if}
              <ol class="ayah-list list-none p-0">
                {#each pageData.ayahs as ayah (ayah.key)}
                  <VerseRow
                    text={bodyText(ayah.text, ayah.ayah, pageData.normalization)}
                    n={ayah.ayah}
                    vKey={ayah.key}
                    onToggleNote={() => toggleNote(ayah.key)}
                    stacked={stackedFor(stackedController.state, ayah.key)}
                    stackedPending={loadingFor(stackedController.state, ayah.key)}
                    stackedErrored={erroredFor(stackedController.state, ayah.key)}
                    stackedErrorLabel={copy.stacked.error}
                  />
                {/each}
              </ol>
            </section>
          {:else}
            <div
              class="page-spacer"
              data-local-page={pageData.page.localPage}
              data-page-spacer
              aria-hidden="true"
              style:height={`${heightCache.get(pageData.page.localPage, readerWidth)}px`}
            ></div>
          {/if}
        {/each}
      </TooltipProvider>
    </div>

    <span class="sr-only" aria-live="polite">
      {copy.shell.pageOf(visibleLocalPage, initial.pageCount)}
    </span>

    {#if clientMounted && (degradation.loadFailed || degradation.workerDegraded || degradation.apiDegraded || quran.status === "error")}
      <ReaderStatusBanner
        loadFailed={degradation.loadFailed}
        workerDegraded={degradation.workerDegraded}
        apiDegraded={degradation.apiDegraded}
        quranStatusError={quran.status === "error"}
        initialEmpty={initial.ayahs.length === 0}
        failedPage={degradation.failedPage}
        onRetry={retryDegradedPage}
      />
    {/if}

    <ReaderPageNav
      {initial}
      lastLoadedLocalPage={lastLoaded.page.localPage}
      {previousPage}
      {nextPage}
      {previousSurah}
      {nextSurah}
    />
  </div>
</div>

<style>
  .reader-pages {
    overflow-anchor: none;
    outline: none;
  }

  .page-spacer {
    contain: strict;
    overflow-anchor: none;
    pointer-events: none;
  }

  .ayah-list {
    display: flex;
    flex-direction: column;
  }

  .surah-opener {
    font-family: var(--reader-arabic-family, var(--font-arabic));
  }

  :global([data-reader-mode="reading"]) .reader-pages .surah-page {
    border-bottom: 1px solid var(--line);
    padding: 2rem 1.25rem;
  }

  :global([data-reader-mode="reading"]) .reader-pages .surah-page:last-child {
    border-bottom: 0;
  }

  :global([data-reader-mode="reading"]) .reader-pages .surah-opener {
    padding-top: 0;
  }

  :global([data-reader-mode="reading"]) .reader-pages[data-source-kind="arabic"] .ayah-list {
    display: block;
    direction: rtl;
    text-align: justify;
    text-align-last: center;
    font-family: var(--reader-arabic-family, var(--font-arabic));
    line-height: 2.35;
    word-spacing: 0.14em;
  }

  :global(html[data-reader-last-read="true"]:not([data-reader-hydrated="true"]))
    .reader-stack::before {
    content: "";
    display: block;
    height: 46px;
    flex: 0 0 46px;
  }

  @media (min-width: 640px) {
    :global([data-reader-mode="reading"]) .reader-pages .surah-page {
      padding-inline: 2.25rem;
    }
  }
</style>
