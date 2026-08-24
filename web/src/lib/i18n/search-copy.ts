import type { UiDirection, UiLocale } from "$lib/i18n/locales";
import { uiDirection } from "$lib/i18n/locales";
import { getLocale } from "$lib/paraglide/runtime.js";
import {
  search_arabic_only_note,
  search_cached,
  search_count,
  search_download,
  search_downloading,
  search_empty_idle,
  search_error_section,
  search_filter_none,
  search_filter_open,
  search_filter_placeholder,
  search_filter_selected,
  search_filter_title,
  search_input_label,
  search_load_more,
  search_loading_more,
  search_manage_storage,
  search_nav_juz,
  search_nav_page,
  search_nav_place_count,
  search_nav_place_medinan,
  search_nav_place_meccan,
  search_nav_sajda_obligatory,
  search_nav_sajda_recommended,
  search_no_results,
  search_pick_prompt,
  search_placeholder,
  search_results_label,
  search_retry,
  search_section_nav,
  search_rtl_disabled,
  search_section_quran,
  search_section_surahs,
  search_title,
  search_too_short,
} from "$lib/i18n/m/search";

export interface SearchCopy {
  readonly locale: UiLocale;
  readonly direction: UiDirection;
  readonly title: string;
  readonly inputLabel: string;
  readonly placeholder: string;
  readonly resultsLabel: string;
  readonly sectionQuran: string;
  readonly sectionSurahs: string;
  readonly sectionNav: string;
  readonly navJuz: (num: number) => string;
  readonly navPage: (num: number) => string;
  readonly navSajdaRecommended: string;
  readonly navSajdaObligatory: string;
  readonly navPlaceMeccan: string;
  readonly navPlaceMedinan: string;
  readonly navPlaceCount: (count: number) => string;
  readonly count: (count: number) => string;
  readonly loadMore: string;
  readonly loadingMore: string;
  readonly emptyIdle: string;
  readonly tooShort: string;
  readonly noResults: string;
  readonly arabicOnlyNote: string;
  readonly rtlDisabled: string;
  readonly filterOpen: string;
  readonly filterTitle: string;
  readonly filterPlaceholder: string;
  readonly filterNone: string;
  readonly filterSelected: (count: number) => string;
  readonly download: string;
  readonly downloading: string;
  readonly cached: string;
  readonly manageStorage: string;
  readonly errorSection: string;
  readonly retry: string;
  readonly pickPrompt: string;
}

/**
 * Search page copy. Loaded only by the search route subtree, never eagerly: the
 * `search` namespace is a lazy chunk. Import from the search route and its tests
 * only — see docs/quran-system.md (Part 2, Message chunking).
 */
// SAFETY: paraglide is compiled for exactly the UI locales (en/ar in messages/), so getLocale() only ever returns a UiLocale at runtime.
export function getSearchCopy(locale: UiLocale = getLocale() as UiLocale): SearchCopy {
  const options = { locale } as const;
  const noArgs = (
    message: (inputs?: undefined, options?: { locale?: UiLocale }) => string,
  ): string => message(undefined, options);
  return {
    locale,
    direction: uiDirection(locale),
    title: noArgs(search_title),
    inputLabel: noArgs(search_input_label),
    placeholder: noArgs(search_placeholder),
    resultsLabel: noArgs(search_results_label),
    sectionQuran: noArgs(search_section_quran),
    sectionSurahs: noArgs(search_section_surahs),
    sectionNav: noArgs(search_section_nav),
    navJuz: (num) => search_nav_juz({ num }, options),
    navPage: (num) => search_nav_page({ num }, options),
    navSajdaRecommended: noArgs(search_nav_sajda_recommended),
    navSajdaObligatory: noArgs(search_nav_sajda_obligatory),
    navPlaceMeccan: noArgs(search_nav_place_meccan),
    navPlaceMedinan: noArgs(search_nav_place_medinan),
    navPlaceCount: (count) => search_nav_place_count({ count }, options),
    count: (count) => search_count({ count }, options),
    loadMore: noArgs(search_load_more),
    loadingMore: noArgs(search_loading_more),
    emptyIdle: noArgs(search_empty_idle),
    tooShort: noArgs(search_too_short),
    noResults: noArgs(search_no_results),
    arabicOnlyNote: noArgs(search_arabic_only_note),
    rtlDisabled: noArgs(search_rtl_disabled),
    filterOpen: noArgs(search_filter_open),
    filterTitle: noArgs(search_filter_title),
    filterPlaceholder: noArgs(search_filter_placeholder),
    filterNone: noArgs(search_filter_none),
    filterSelected: (count) => search_filter_selected({ count }, options),
    download: noArgs(search_download),
    downloading: noArgs(search_downloading),
    cached: noArgs(search_cached),
    manageStorage: noArgs(search_manage_storage),
    errorSection: noArgs(search_error_section),
    retry: noArgs(search_retry),
    pickPrompt: noArgs(search_pick_prompt),
  };
}
