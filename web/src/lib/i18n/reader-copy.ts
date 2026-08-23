import type { FooterLinkLabels } from "$lib/i18n/footer-links";
import { uiDirection, type UiDirection, type UiLocale } from "$lib/i18n/locales";
import {
  footer_about,
  footer_blurb,
  footer_bookmarks,
  footer_built_by,
  footer_company_heading,
  footer_company_label,
  footer_contact,
  footer_faq,
  footer_legal_heading,
  footer_legal_label,
  footer_privacy,
  footer_product_heading,
  footer_product_label,
  footer_project_by,
  footer_read_quran,
  footer_social_x,
  footer_terms,
  footer_whats_inside,
  nav_change_language,
  nav_language,
  nav_settings,
  skip_to_content,
} from "$lib/i18n/m/chrome";
import {
  reader_account,
  reader_appearance,
  reader_arabic,
  reader_arabic_text_size,
  reader_ayah_by_ayah,
  reader_ayahs,
  reader_bookmark,
  reader_bookmark_verse,
  reader_browse,
  reader_browse_ayah,
  reader_browse_juz,
  reader_browse_page,
  reader_browse_surah,
  reader_clear_search,
  reader_close_note_tafsir,
  reader_close_panel,
  reader_continue_reading,
  reader_copied,
  reader_copy,
  reader_copy_ayah,
  reader_customize_appearance,
  reader_dark,
  reader_default,
  reader_dismiss_update,
  reader_downloading_offline_pack,
  reader_downloading_quran,
  reader_full_surah,
  reader_home_label,
  reader_jump,
  reader_juz,
  reader_juz_count,
  reader_juz_item,
  reader_larger_arabic_text,
  reader_light,
  reader_more_ayahs_unavailable,
  reader_navigation_description,
  reader_navigation_error,
  reader_navigation_loading,
  reader_network_unavailable,
  reader_new_version_ready,
  reader_no_translations,
  reader_no_verse_matches,
  reader_note_placeholder,
  reader_note_saved,
  reader_note_tafsir,
  reader_offline,
  reader_offline_cached,
  reader_offline_copy_unavailable,
  reader_offline_data_unavailable,
  reader_offline_download,
  reader_offline_download_failed,
  reader_offline_label,
  reader_offline_pack_ready,
  reader_offline_routes,
  reader_offline_title,
  reader_offline_working,
  reader_open_note_tafsir,
  reader_open_panel,
  reader_opening,
  reader_original,
  reader_page_abbreviation,
  reader_page_item,
  reader_page_of,
  reader_page_unavailable,
  reader_preparing_offline_pack,
  reader_primary_nav,
  reader_quran_book,
  reader_range_translation_unavailable,
  reader_reading,
  reader_reading_mode,
  reader_reload_open_tabs,
  reader_reload_update,
  reader_remove_bookmark,
  reader_remove_offline,
  reader_retry,
  reader_saved_on,
  reader_search_ayah,
  reader_search_label,
  reader_search_open_surah,
  reader_search_placeholder,
  reader_search_quran,
  reader_search_surah_matches,
  reader_search_surah_opener,
  reader_search_text_matches,
  reader_search_tip,
  reader_search_unavailable,
  reader_searching,
  reader_seo_breadcrumb_surah,
  reader_seo_home,
  reader_seo_juz_description,
  reader_seo_juz_index_description,
  reader_seo_juz_index_title,
  reader_seo_juz_title,
  reader_seo_page_description,
  reader_seo_page_title,
  reader_seo_quran,
  reader_seo_surah_description_translation,
  reader_seo_surah_description_uthmani,
  reader_seo_surah_page_title,
  reader_seo_surah_title,
  reader_seo_translation_juz_description,
  reader_seo_translation_page_description,
  reader_share,
  reader_share_verse,
  reader_sidebar_title,
  reader_sidebar_toggle,
  reader_sign_in,
  reader_site_panel,
  reader_smaller_arabic_text,
  reader_source,
  reader_stacked_clear,
  reader_stacked_count,
  reader_stacked_error,
  reader_stacked_full,
  reader_stacked_loading,
  reader_stacked_move_down,
  reader_stacked_move_up,
  reader_stacked_none_selected,
  reader_stacked_open,
  reader_stacked_primary_badge,
  reader_stacked_remove,
  reader_stacked_search_placeholder,
  reader_stacked_selected,
  reader_stacked_title,
  reader_staging_offline_pack,
  reader_storage,
  reader_surah_page,
  reader_surah_page_title,
  reader_surah_pages,
  reader_tafsir,
  reader_theme,
  reader_toggle_theme,
  reader_translation_unavailable,
  reader_your_note,
} from "$lib/i18n/m/reader";
import type { FooterResolvedCopy, NavResolvedCopy } from "$lib/i18n/marketing-copy";
import { getLocale } from "$lib/paraglide/runtime.js";

type BrowseMode = "surah" | "ayah" | "juz" | "page";
type RangeKind = "juz" | "page";

export interface ReaderUiCopy {
  readonly locale: UiLocale;
  readonly direction: UiDirection;
  readonly skipToContent: string;
  /** Label on the closed appearance trigger. Panel copy loads on open via reader-settings-copy.ts. */
  readonly appearanceTrigger: string;
  readonly shell: {
    readonly opening: string;
    readonly surahPage: (surah: number, page: number, count: number) => string;
    readonly surahPageTitle: (name: string, page: number, count: number) => string;
    readonly pageOf: (page: number, count: number) => string;
    readonly surahPagesLabel: string;
    readonly arabicTextSizeLabel: string;
    readonly smallerArabicTextLabel: string;
    readonly largerArabicTextLabel: string;
    readonly readingModeLabel: string;
    readonly ayahByAyah: string;
    readonly ayahs: string;
    readonly reading: string;
    readonly continueReading: (reference: string) => string;
    readonly jump: string;
    readonly retry: string;
    readonly translationUnavailable: string;
    readonly pageUnavailable: (page: number) => string;
    readonly offlineCopyUnavailable: string;
    readonly networkUnavailable: string;
    readonly offlineDataUnavailable: string;
    readonly moreAyahsUnavailable: string;
  };
  readonly sidebar: {
    readonly searchPlaceholder: string;
    readonly searchLabel: string;
    readonly clearSearch: string;
    readonly browseLabel: string;
    readonly mode: (mode: BrowseMode) => string;
    readonly loadingNavigation: string;
    readonly navigationError: string;
    readonly navigationDescription: string;
    readonly tip: string;
    readonly pageAbbreviation: string;
    readonly juzLabel: string;
    readonly rangeItem: (kind: RangeKind, index: number) => string;
  };
  readonly search: {
    readonly searching: string;
    readonly noVerseMatches: (query: string) => string;
    readonly surahMatches: (count: number, query: string) => string;
    readonly textMatches: (count: number, query: string) => string;
    readonly openSurah: string;
    readonly unavailable: string;
    readonly surahOpener: (name: string) => string;
    readonly ayah: (name: string, surah: number, ayah: number) => string;
  };
  readonly range: {
    readonly juz: string;
    readonly page: string;
    readonly pageAbbreviation: string;
    readonly fullSurah: string;
    readonly translationUnavailable: string;
    readonly item: (kind: RangeKind, index: number) => string;
    readonly juzCount: (count: number) => string;
  };
  readonly sources: {
    readonly source: string;
    readonly arabic: string;
    readonly original: string;
    readonly default: string;
    readonly noTranslations: string;
  };
  readonly verse: {
    readonly bookmark: string;
    readonly removeBookmark: string;
    readonly bookmarkVerse: string;
    readonly copy: string;
    readonly copied: string;
    readonly copyAyah: string;
    readonly share: string;
    readonly shareVerse: string;
    readonly noteTafsir: string;
    readonly openNoteTafsir: string;
    readonly closeNoteTafsir: string;
    readonly tafsir: string;
    readonly yourNote: string;
    readonly notePlaceholder: string;
    readonly noteSaved: string;
  };
  readonly nav: NavResolvedCopy & {
    readonly sidebarToggle: string;
    readonly sidebarTitle: string;
    readonly homeLabel: (siteName: string) => string;
  };
  readonly footer: FooterResolvedCopy;
  readonly footerLinks: FooterLinkLabels;
  readonly offline: {
    readonly label: string;
    readonly packReady: string;
    readonly preparingPack: string;
    readonly downloadingPack: string;
    readonly stagingPack: string;
    readonly downloadFailed: string;
    readonly download: string;
    readonly remove: string;
    readonly working: string;
    readonly routes: (count: number) => string;
    readonly savedOn: (date: string) => string;
    readonly storage: (usage: string, quota: string) => string;
    readonly preparingQuran: string;
  };
  readonly update: {
    readonly ready: string;
    readonly reloadDescription: string;
    readonly reloadOpenTabs: string;
    readonly dismiss: string;
  };
  readonly seo: {
    readonly home: string;
    readonly quran: string;
    readonly juzIndexTitle: string;
    readonly juzIndexDescription: string;
    readonly juzTitle: (index: number, first: string, last: string) => string;
    readonly juzDescription: (index: number, first: string, last: string) => string;
    readonly pageTitle: (index: number, first: string, last: string) => string;
    readonly pageDescription: (index: number, first: string, last: string) => string;
    readonly translationJuzDescription: (index: number, first: string, last: string) => string;
    readonly translationPageDescription: (index: number, first: string, last: string) => string;
    readonly surahTitle: (surah: number, name: string) => string;
    readonly surahPageTitle: (surah: number, name: string, page: number, count: number) => string;
    readonly surahDescriptionUthmani: (
      name: string,
      arabic: string,
      page: number,
      count: number,
      start: number,
      end: number,
    ) => string;
    readonly surahDescriptionTranslation: (
      name: string,
      arabic: string,
      page: number,
      count: number,
      start: number,
      end: number,
    ) => string;
    readonly breadcrumbSurah: (name: string) => string;
    readonly quranBook: string;
  };
  readonly stacked: {
    readonly title: string;
    readonly searchPlaceholder: string;
    readonly selected: string;
    readonly clear: string;
    readonly count: (n: number, max: number) => string;
    readonly full: (max: number) => string;
    readonly moveUp: string;
    readonly moveDown: string;
    readonly remove: string;
    readonly primaryBadge: string;
    readonly open: string;
    readonly loading: string;
    readonly error: string;
    readonly noneSelected: string;
  };
}

function createReaderUiCopy(locale: UiLocale): ReaderUiCopy {
  const options = { locale };
  const noArgs = <Inputs>(
    message: (inputs?: Inputs, options?: { locale?: UiLocale }) => string,
  ): string => message(undefined, options);

  const mode = (value: BrowseMode): string => {
    switch (value) {
      case "surah":
        return noArgs(reader_browse_surah);
      case "ayah":
        return noArgs(reader_browse_ayah);
      case "juz":
        return noArgs(reader_browse_juz);
      case "page":
        return noArgs(reader_browse_page);
    }
  };

  const rangeItem = (kind: RangeKind, index: number): string =>
    kind === "juz" ? reader_juz_item({ index }, options) : reader_page_item({ index }, options);

  return {
    locale,
    direction: uiDirection(locale),
    skipToContent: noArgs(skip_to_content),
    appearanceTrigger: noArgs(reader_customize_appearance),
    shell: {
      opening: noArgs(reader_opening),
      surahPage: (surah, page, count) => reader_surah_page({ surah, page, count }, options),
      surahPageTitle: (name, page, count) =>
        reader_surah_page_title({ name, page, count }, options),
      pageOf: (page, count) => reader_page_of({ page, count }, options),
      surahPagesLabel: noArgs(reader_surah_pages),
      arabicTextSizeLabel: noArgs(reader_arabic_text_size),
      smallerArabicTextLabel: noArgs(reader_smaller_arabic_text),
      largerArabicTextLabel: noArgs(reader_larger_arabic_text),
      readingModeLabel: noArgs(reader_reading_mode),
      ayahByAyah: noArgs(reader_ayah_by_ayah),
      ayahs: noArgs(reader_ayahs),
      reading: noArgs(reader_reading),
      continueReading: (reference) => reader_continue_reading({ reference }, options),
      jump: noArgs(reader_jump),
      retry: noArgs(reader_retry),
      translationUnavailable: noArgs(reader_translation_unavailable),
      pageUnavailable: (page) => reader_page_unavailable({ page }, options),
      offlineCopyUnavailable: noArgs(reader_offline_copy_unavailable),
      networkUnavailable: noArgs(reader_network_unavailable),
      offlineDataUnavailable: noArgs(reader_offline_data_unavailable),
      moreAyahsUnavailable: noArgs(reader_more_ayahs_unavailable),
    },
    sidebar: {
      searchPlaceholder: noArgs(reader_search_placeholder),
      searchLabel: noArgs(reader_search_label),
      clearSearch: noArgs(reader_clear_search),
      browseLabel: noArgs(reader_browse),
      mode,
      loadingNavigation: noArgs(reader_navigation_loading),
      navigationError: noArgs(reader_navigation_error),
      navigationDescription: noArgs(reader_navigation_description),
      tip: noArgs(reader_search_tip),
      pageAbbreviation: noArgs(reader_page_abbreviation),
      juzLabel: noArgs(reader_juz),
      rangeItem,
    },
    search: {
      searching: noArgs(reader_searching),
      noVerseMatches: (query) => reader_no_verse_matches({ query }, options),
      surahMatches: (count, query) => reader_search_surah_matches({ count, query }, options),
      textMatches: (count, query) => reader_search_text_matches({ count, query }, options),
      openSurah: noArgs(reader_search_open_surah),
      unavailable: noArgs(reader_search_unavailable),
      surahOpener: (name) => reader_search_surah_opener({ name }, options),
      ayah: (name, surah, ayah) => reader_search_ayah({ name, surah, ayah }, options),
    },
    range: {
      juz: noArgs(reader_juz),
      page: noArgs(reader_browse_page),
      pageAbbreviation: noArgs(reader_page_abbreviation),
      fullSurah: noArgs(reader_full_surah),
      translationUnavailable: noArgs(reader_range_translation_unavailable),
      item: rangeItem,
      juzCount: (count) => reader_juz_count({ count }, options),
    },
    sources: {
      source: noArgs(reader_source),
      arabic: noArgs(reader_arabic),
      original: noArgs(reader_original),
      default: noArgs(reader_default),
      noTranslations: noArgs(reader_no_translations),
    },
    verse: {
      bookmark: noArgs(reader_bookmark),
      removeBookmark: noArgs(reader_remove_bookmark),
      bookmarkVerse: noArgs(reader_bookmark_verse),
      copy: noArgs(reader_copy),
      copied: noArgs(reader_copied),
      copyAyah: noArgs(reader_copy_ayah),
      share: noArgs(reader_share),
      shareVerse: noArgs(reader_share_verse),
      noteTafsir: noArgs(reader_note_tafsir),
      openNoteTafsir: noArgs(reader_open_note_tafsir),
      closeNoteTafsir: noArgs(reader_close_note_tafsir),
      tafsir: noArgs(reader_tafsir),
      yourNote: noArgs(reader_your_note),
      notePlaceholder: noArgs(reader_note_placeholder),
      noteSaved: noArgs(reader_note_saved),
    },
    nav: {
      primaryLabel: noArgs(reader_primary_nav),
      offlineLabel: noArgs(reader_offline),
      offlineTitle: noArgs(reader_offline_title),
      offlineDetail: noArgs(reader_offline_cached),
      searchQuran: noArgs(reader_search_quran),
      account: noArgs(reader_account),
      signIn: noArgs(reader_sign_in),
      openPanel: noArgs(reader_open_panel),
      closePanel: noArgs(reader_close_panel),
      sitePanel: noArgs(reader_site_panel),
      appearance: noArgs(reader_appearance),
      toggleTheme: noArgs(reader_toggle_theme),
      theme: noArgs(reader_theme),
      language: noArgs(nav_language),
      changeLanguage: noArgs(nav_change_language),
      settings: noArgs(nav_settings),
      themeNames: {
        dark: noArgs(reader_dark),
        light: noArgs(reader_light),
      },
      sidebarToggle: noArgs(reader_sidebar_toggle),
      sidebarTitle: noArgs(reader_sidebar_title),
      homeLabel: (siteName) => reader_home_label({ siteName }, options),
    },
    footer: {
      blurb: noArgs(footer_blurb),
      socialX: noArgs(footer_social_x),
      productHeading: noArgs(footer_product_heading),
      productLabel: noArgs(footer_product_label),
      companyHeading: noArgs(footer_company_heading),
      companyLabel: noArgs(footer_company_label),
      legalHeading: noArgs(footer_legal_heading),
      legalLabel: noArgs(footer_legal_label),
      builtBy: noArgs(footer_built_by),
      projectBy: noArgs(footer_project_by),
    },
    footerLinks: {
      readQuran: noArgs(footer_read_quran),
      bookmarks: noArgs(footer_bookmarks),
      whatsInside: noArgs(footer_whats_inside),
      about: noArgs(footer_about),
      faq: noArgs(footer_faq),
      contact: noArgs(footer_contact),
      privacy: noArgs(footer_privacy),
      terms: noArgs(footer_terms),
    },
    offline: {
      label: noArgs(reader_offline_label),
      packReady: noArgs(reader_offline_pack_ready),
      preparingPack: noArgs(reader_preparing_offline_pack),
      downloadingPack: noArgs(reader_downloading_offline_pack),
      stagingPack: noArgs(reader_staging_offline_pack),
      downloadFailed: noArgs(reader_offline_download_failed),
      download: noArgs(reader_offline_download),
      remove: noArgs(reader_remove_offline),
      working: noArgs(reader_offline_working),
      routes: (count) => reader_offline_routes({ count }, options),
      savedOn: (date) => reader_saved_on({ date }, options),
      storage: (usage, quota) => reader_storage({ usage, quota }, options),
      preparingQuran: noArgs(reader_downloading_quran),
    },
    update: {
      ready: noArgs(reader_new_version_ready),
      reloadDescription: noArgs(reader_reload_update),
      reloadOpenTabs: noArgs(reader_reload_open_tabs),
      dismiss: noArgs(reader_dismiss_update),
    },
    seo: {
      home: noArgs(reader_seo_home),
      quran: noArgs(reader_seo_quran),
      juzIndexTitle: noArgs(reader_seo_juz_index_title),
      juzIndexDescription: noArgs(reader_seo_juz_index_description),
      juzTitle: (index, first, last) => reader_seo_juz_title({ index, first, last }, options),
      juzDescription: (index, first, last) =>
        reader_seo_juz_description({ index, first, last }, options),
      pageTitle: (index, first, last) => reader_seo_page_title({ index, first, last }, options),
      pageDescription: (index, first, last) =>
        reader_seo_page_description({ index, first, last }, options),
      translationJuzDescription: (index, first, last) =>
        reader_seo_translation_juz_description({ index, first, last }, options),
      translationPageDescription: (index, first, last) =>
        reader_seo_translation_page_description({ index, first, last }, options),
      surahTitle: (surah, name) => reader_seo_surah_title({ surah, name }, options),
      surahPageTitle: (surah, name, page, count) =>
        reader_seo_surah_page_title({ surah, name, page, count }, options),
      surahDescriptionUthmani: (name, arabic, page, count, start, end) =>
        reader_seo_surah_description_uthmani({ name, arabic, page, count, start, end }, options),
      surahDescriptionTranslation: (name, arabic, page, count, start, end) =>
        reader_seo_surah_description_translation(
          { name, arabic, page, count, start, end },
          options,
        ),
      breadcrumbSurah: (name) => reader_seo_breadcrumb_surah({ name }, options),
      quranBook: noArgs(reader_quran_book),
    },
    stacked: {
      title: noArgs(reader_stacked_title),
      searchPlaceholder: noArgs(reader_stacked_search_placeholder),
      selected: noArgs(reader_stacked_selected),
      clear: noArgs(reader_stacked_clear),
      count: (n, max) => reader_stacked_count({ n, max }, options),
      full: (max) => reader_stacked_full({ max }, options),
      moveUp: noArgs(reader_stacked_move_up),
      moveDown: noArgs(reader_stacked_move_down),
      remove: noArgs(reader_stacked_remove),
      primaryBadge: noArgs(reader_stacked_primary_badge),
      open: noArgs(reader_stacked_open),
      loading: noArgs(reader_stacked_loading),
      error: noArgs(reader_stacked_error),
      noneSelected: noArgs(reader_stacked_none_selected),
    },
  };
}

// SAFETY: paraglide is compiled for exactly the UI locales (en/ar in messages/), so getLocale() only ever returns a UiLocale at runtime.
export function getReaderUiCopy(locale: UiLocale = getLocale() as UiLocale): ReaderUiCopy {
  return createReaderUiCopy(locale);
}
