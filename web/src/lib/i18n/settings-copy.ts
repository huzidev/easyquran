import { offlinePackStatus, type OfflinePackCopy } from "$lib/components/status/offline-pack-copy";
import type { UiDirection, UiLocale } from "$lib/i18n/locales";
import { uiDirection } from "$lib/i18n/locales";
import { QuranScript } from "$lib/data/quran-types";
import { reader_new_version_ready, reader_reload_open_tabs } from "$lib/i18n/m/reader";
import { getLocale } from "$lib/paraglide/runtime.js";
import {
  settings_account_device_note,
  settings_account_intro,
  settings_account_open,
  settings_account_sign_in,
  settings_account_signed_in_as,
  settings_account_signed_in_heading,
  settings_account_signed_out_note,
  settings_appearance_intro,
  settings_privacy_check_updates,
  settings_privacy_intro,
  settings_privacy_sign_out,
  settings_privacy_sign_out_error,
  settings_privacy_sync_note,
  settings_privacy_up_to_date,
  settings_privacy_version,
  settings_reading_arabic_font,
  settings_reading_font_amiri,
  settings_reading_font_noto,
  settings_reading_font_sans,
  settings_reading_font_scheherazade,
  settings_reading_font_serif,
  settings_reading_intro,
  settings_reading_preview,
  settings_reading_sample,
  settings_reading_translation_font,
  settings_reading_translation_size,
  settings_section_account,
  settings_section_appearance,
  settings_section_privacy,
  settings_section_reading,
  settings_section_storage,
  settings_sections_label,
  settings_storage_arabic_error,
  settings_storage_busy_error,
  settings_storage_cap_note,
  settings_storage_clear_pages,
  settings_storage_clear_pages_done,
  settings_storage_clear_pages_unavailable,
  settings_storage_downloads_heading,
  settings_storage_empty,
  settings_storage_error,
  settings_storage_estimate_note,
  settings_storage_freed,
  settings_storage_in_use,
  settings_storage_intro,
  settings_storage_layer_arabic,
  settings_storage_layer_data,
  settings_storage_layer_other,
  settings_storage_layer_pack,
  settings_storage_layer_pages,
  settings_storage_layer_translations,
  settings_storage_last_used,
  settings_storage_loading,
  settings_storage_never_used,
  settings_storage_offline_pack_note,
  settings_storage_pack_bar_preparing,
  settings_storage_pack_bar_ready,
  settings_storage_pack_busy,
  settings_storage_pack_heading,
  settings_storage_pack_retry,
  settings_storage_pack_routes,
  settings_storage_pack_saved,
  settings_storage_pack_status_active,
  settings_storage_pack_status_downloading,
  settings_storage_pack_status_error,
  settings_storage_pack_status_off,
  settings_storage_pack_status_on,
  settings_storage_pack_status_staging,
  settings_storage_pack_toggle_off,
  settings_storage_pack_toggle_on,
  settings_storage_pack_usage,
  settings_storage_opfs_absent,
  settings_storage_persist_declined,
  settings_storage_persist_denied,
  settings_storage_persist_granted,
  settings_storage_persist_heading,
  settings_storage_persist_request,
  settings_storage_persist_unavailable,
  settings_storage_quota_note,
  settings_storage_quota_warning,
  settings_storage_remove,
  settings_storage_remove_all,
  settings_storage_remove_all_confirm,
  settings_storage_remove_cancel,
  settings_storage_remove_confirm_action,
  settings_storage_remove_confirm_title,
  settings_storage_removed,
  settings_storage_removed_all,
  settings_storage_required_group,
  settings_storage_required_note,
  settings_storage_retention_note,
  settings_storage_script_indopak,
  settings_storage_script_simple_clean,
  settings_storage_script_tajweed,
  settings_storage_script_translation,
  settings_storage_script_uthmani,
  settings_storage_retry,
  settings_storage_store_idb,
  settings_storage_store_memory,
  settings_storage_store_opfs,
  settings_storage_usage,
  settings_storage_used_of,
  settings_title,
} from "$lib/i18n/m/settings";
import {
  reader_arabic_text_size,
  reader_ayah_by_ayah,
  reader_reading,
} from "$lib/i18n/m/reader";
import {
  reader_analytics,
  reader_mode,
  reader_notifications,
  reader_notifications_blocked,
  reader_notifications_browser_unsupported,
  reader_notifications_checking,
  reader_notifications_error,
  reader_notifications_off,
  reader_notifications_off_updates,
  reader_notifications_on,
  reader_notifications_unavailable,
  reader_off,
  reader_on,
  reader_performance,
  reader_performance_reload,
} from "$lib/i18n/m/reader-settings";
import { getReaderSettingsCopy, type ReaderSettingsCopy } from "$lib/i18n/reader-settings-copy";

export type { ReaderSettingsCopy };

export interface SettingsCopy {
  readonly locale: UiLocale;
  readonly direction: UiDirection;
  readonly title: string;
  readonly sectionsLabel: string;
  readonly nav: {
    readonly storage: string;
    readonly appearance: string;
    readonly reading: string;
    readonly privacy: string;
    readonly account: string;
  };
  readonly storage: {
    readonly intro: string;
    readonly usage: string;
    readonly usedOf: (used: string) => string;
    readonly quotaNote: (quota: string) => string;
    readonly layers: {
      readonly arabic: string;
      readonly translations: string;
      readonly pack: string;
      readonly pages: string;
      readonly data: string;
      readonly other: string;
    };
    readonly quotaWarning: string;
    readonly capNote: string;
    readonly retentionNote: string;
    readonly downloadsHeading: string;
    readonly lastUsed: (when: string) => string;
    readonly neverUsed: string;
    readonly inUse: string;
    readonly requiredGroup: string;
    readonly requiredNote: string;
    readonly scripts: Readonly<Record<QuranScript, string>>;
    readonly stores: {
      readonly opfs: string;
      readonly idb: string;
      readonly memory: string;
    };
    readonly remove: string;
    readonly removeConfirmTitle: (name: string) => string;
    readonly removeConfirmAction: string;
    readonly removeCancel: string;
    readonly busyError: string;
    readonly arabicError: string;
    readonly removeAll: string;
    readonly removeAllConfirm: string;
    readonly freed: (size: string) => string;
    readonly removed: (name: string) => string;
    readonly removedAll: string;
    readonly clearPages: string;
    readonly clearPagesDone: string;
    readonly clearPagesUnavailable: string;
    readonly persistHeading: string;
    readonly persistGranted: string;
    readonly persistDenied: string;
    readonly persistDeclined: string;
    readonly persistRequest: string;
    readonly persistUnavailable: string;
    readonly empty: string;
    readonly opfsAbsent: string;
    readonly loading: string;
    readonly error: string;
    readonly retry: string;
    readonly estimateNote: string;
    readonly offlinePackNote: string;
    readonly offlinePack: OfflinePackCopy;
  };
  readonly appearance: {
    readonly intro: string;
    readonly panel: ReaderSettingsCopy;
  };
  readonly reading: {
    readonly intro: string;
    readonly arabicFont: string;
    readonly fontNames: {
      readonly amiri: string;
      readonly scheherazade: string;
      readonly notoNaskh: string;
    };
    readonly translationFont: string;
    readonly fontFamilies: {
      readonly sans: string;
      readonly serif: string;
    };
    readonly arabicSize: string;
    readonly translationSize: string;
    readonly preview: string;
    readonly sample: string;
    readonly mode: string;
    readonly modeNames: {
      readonly verse: string;
      readonly reading: string;
    };
  };
  readonly privacy: {
    readonly intro: string;
    readonly analytics: string;
    readonly performance: string;
    readonly performanceReload: string;
    readonly on: string;
    readonly off: string;
    readonly notifications: string;
    readonly notificationsStatus: {
      readonly unavailable: string;
      readonly checking: string;
      readonly browserUnsupported: string;
      readonly blocked: string;
      readonly error: string;
      readonly on: string;
      readonly offUpdates: string;
      readonly off: string;
    };
    readonly version: string;
    readonly checkUpdates: string;
    readonly upToDate: string;
    readonly updateAvailable: string;
    readonly reloadUpdate: string;
    readonly syncNote: string;
    readonly signOut: string;
    readonly signOutError: string;
  };
  readonly account: {
    readonly intro: string;
    readonly signedInHeading: string;
    readonly signedInAs: (name: string) => string;
    readonly signedOutNote: string;
    readonly signIn: string;
    readonly open: string;
    readonly deviceNote: string;
  };
}

/**
 * Settings page copy. Loaded only by the settings route, never eagerly: the `settings` namespace
 * is a lazy chunk, and the appearance section reuses the reader-settings resolver so its messages
 * are not duplicated under new keys. See docs/quran-system.md (Part 2, Message chunking).
 */
// SAFETY: paraglide is compiled for exactly the UI locales (en/ar in messages/), so getLocale() only ever returns a UiLocale at runtime.
export function getSettingsCopy(locale: UiLocale = getLocale() as UiLocale): SettingsCopy {
  const options = { locale } as const;
  const noArgs = (
    message: (inputs?: undefined, options?: { locale?: UiLocale }) => string,
  ): string => message(undefined, options);
  return {
    locale,
    direction: uiDirection(locale),
    title: noArgs(settings_title),
    sectionsLabel: noArgs(settings_sections_label),
    nav: {
      storage: noArgs(settings_section_storage),
      appearance: noArgs(settings_section_appearance),
      reading: noArgs(settings_section_reading),
      privacy: noArgs(settings_section_privacy),
      account: noArgs(settings_section_account),
    },
    storage: {
      intro: noArgs(settings_storage_intro),
      usage: noArgs(settings_storage_usage),
      usedOf: (used: string) => settings_storage_used_of({ used }, options),
      quotaNote: (quota: string) => settings_storage_quota_note({ quota }, options),
      layers: {
        arabic: noArgs(settings_storage_layer_arabic),
        translations: noArgs(settings_storage_layer_translations),
        pack: noArgs(settings_storage_layer_pack),
        pages: noArgs(settings_storage_layer_pages),
        data: noArgs(settings_storage_layer_data),
        other: noArgs(settings_storage_layer_other),
      },
      quotaWarning: noArgs(settings_storage_quota_warning),
      capNote: noArgs(settings_storage_cap_note),
      retentionNote: noArgs(settings_storage_retention_note),
      downloadsHeading: noArgs(settings_storage_downloads_heading),
      lastUsed: (when) => settings_storage_last_used({ when }, options),
      neverUsed: noArgs(settings_storage_never_used),
      inUse: noArgs(settings_storage_in_use),
      requiredGroup: noArgs(settings_storage_required_group),
      requiredNote: noArgs(settings_storage_required_note),
      scripts: {
        [QuranScript.Uthmani]: noArgs(settings_storage_script_uthmani),
        [QuranScript.SimpleClean]: noArgs(settings_storage_script_simple_clean),
        [QuranScript.IndoPak]: noArgs(settings_storage_script_indopak),
        [QuranScript.Tajweed]: noArgs(settings_storage_script_tajweed),
        [QuranScript.Translation]: noArgs(settings_storage_script_translation),
      },
      stores: {
        opfs: noArgs(settings_storage_store_opfs),
        idb: noArgs(settings_storage_store_idb),
        memory: noArgs(settings_storage_store_memory),
      },
      remove: noArgs(settings_storage_remove),
      removeConfirmTitle: (name) => settings_storage_remove_confirm_title({ name }, options),
      removeConfirmAction: noArgs(settings_storage_remove_confirm_action),
      removeCancel: noArgs(settings_storage_remove_cancel),
      busyError: noArgs(settings_storage_busy_error),
      arabicError: noArgs(settings_storage_arabic_error),
      removeAll: noArgs(settings_storage_remove_all),
      removeAllConfirm: noArgs(settings_storage_remove_all_confirm),
      freed: (size) => settings_storage_freed({ size }, options),
      removed: (name) => settings_storage_removed({ name }, options),
      removedAll: noArgs(settings_storage_removed_all),
      clearPages: noArgs(settings_storage_clear_pages),
      clearPagesDone: noArgs(settings_storage_clear_pages_done),
      clearPagesUnavailable: noArgs(settings_storage_clear_pages_unavailable),
      persistHeading: noArgs(settings_storage_persist_heading),
      persistGranted: noArgs(settings_storage_persist_granted),
      persistDenied: noArgs(settings_storage_persist_denied),
      persistDeclined: noArgs(settings_storage_persist_declined),
      persistRequest: noArgs(settings_storage_persist_request),
      persistUnavailable: noArgs(settings_storage_persist_unavailable),
      empty: noArgs(settings_storage_empty),
      opfsAbsent: noArgs(settings_storage_opfs_absent),
      loading: noArgs(settings_storage_loading),
      error: noArgs(settings_storage_error),
      retry: noArgs(settings_storage_retry),
      estimateNote: noArgs(settings_storage_estimate_note),
      offlinePackNote: noArgs(settings_storage_offline_pack_note),
      offlinePack: {
        heading: noArgs(settings_storage_pack_heading),
        status: offlinePackStatus({
          active: (entries) => settings_storage_pack_status_active({ entries }, options),
          on: noArgs(settings_storage_pack_status_on),
          downloading: noArgs(settings_storage_pack_status_downloading),
          staging: noArgs(settings_storage_pack_status_staging),
          error: noArgs(settings_storage_pack_status_error),
          off: noArgs(settings_storage_pack_status_off),
        }),
        routes: (entries: number, size: string) =>
          settings_storage_pack_routes({ entries, size }, options),
        saved: (when: Date) =>
          settings_storage_pack_saved({ when: when.toLocaleDateString(locale) }, options),
        usage: (used: string) => settings_storage_pack_usage({ used }, options),
        toggleOn: noArgs(settings_storage_pack_toggle_on),
        toggleOff: noArgs(settings_storage_pack_toggle_off),
        busy: noArgs(settings_storage_pack_busy),
        retry: noArgs(settings_storage_pack_retry),
        barPreparing: noArgs(settings_storage_pack_bar_preparing),
        barReady: noArgs(settings_storage_pack_bar_ready),
      },
    },
    appearance: {
      intro: noArgs(settings_appearance_intro),
      panel: getReaderSettingsCopy(locale),
    },
    reading: {
      intro: noArgs(settings_reading_intro),
      arabicFont: noArgs(settings_reading_arabic_font),
      fontNames: {
        amiri: noArgs(settings_reading_font_amiri),
        scheherazade: noArgs(settings_reading_font_scheherazade),
        notoNaskh: noArgs(settings_reading_font_noto),
      },
      translationFont: noArgs(settings_reading_translation_font),
      fontFamilies: {
        sans: noArgs(settings_reading_font_sans),
        serif: noArgs(settings_reading_font_serif),
      },
      arabicSize: noArgs(reader_arabic_text_size),
      translationSize: noArgs(settings_reading_translation_size),
      preview: noArgs(settings_reading_preview),
      sample: noArgs(settings_reading_sample),
      mode: noArgs(reader_mode),
      modeNames: {
        verse: noArgs(reader_ayah_by_ayah),
        reading: noArgs(reader_reading),
      },
    },
    privacy: {
      intro: noArgs(settings_privacy_intro),
      analytics: noArgs(reader_analytics),
      performance: noArgs(reader_performance),
      performanceReload: noArgs(reader_performance_reload),
      on: noArgs(reader_on),
      off: noArgs(reader_off),
      notifications: noArgs(reader_notifications),
      notificationsStatus: {
        unavailable: noArgs(reader_notifications_unavailable),
        checking: noArgs(reader_notifications_checking),
        browserUnsupported: noArgs(reader_notifications_browser_unsupported),
        blocked: noArgs(reader_notifications_blocked),
        error: noArgs(reader_notifications_error),
        on: noArgs(reader_notifications_on),
        offUpdates: noArgs(reader_notifications_off_updates),
        off: noArgs(reader_notifications_off),
      },
      version: noArgs(settings_privacy_version),
      checkUpdates: noArgs(settings_privacy_check_updates),
      upToDate: noArgs(settings_privacy_up_to_date),
      updateAvailable: noArgs(reader_new_version_ready),
      reloadUpdate: noArgs(reader_reload_open_tabs),
      syncNote: noArgs(settings_privacy_sync_note),
      signOut: noArgs(settings_privacy_sign_out),
      signOutError: noArgs(settings_privacy_sign_out_error),
    },
    account: {
      intro: noArgs(settings_account_intro),
      signedInHeading: noArgs(settings_account_signed_in_heading),
      signedInAs: (name) => settings_account_signed_in_as({ name }, options),
      signedOutNote: noArgs(settings_account_signed_out_note),
      signIn: noArgs(settings_account_sign_in),
      open: noArgs(settings_account_open),
      deviceNote: noArgs(settings_account_device_note),
    },
  };
}
