import {
  accent_azure_label,
  accent_emerald_label,
  accent_gold_label,
  accent_plum_label,
  surface_contrast_label,
  surface_contrast_note,
  surface_ink_label,
  surface_ink_note,
  surface_mocha_label,
  surface_mocha_note,
  surface_paper_label,
  surface_paper_note,
  surface_slate_label,
  surface_slate_note,
  tweaks_accent,
  tweaks_analytics,
  tweaks_background,
  tweaks_clear,
  tweaks_close_panel,
  tweaks_copied,
  tweaks_copy_css,
  tweaks_custom_colours,
  tweaks_data_privacy,
  tweaks_derived_colours,
  tweaks_mode,
  tweaks_off,
  tweaks_on,
  tweaks_performance,
  tweaks_performance_reload,
  tweaks_pop,
  tweaks_reset,
  tweaks_settings,
  tweaks_surface,
  tweaks_theme,
} from "$lib/i18n/m/appearance";
import {
  tweaks_accent_option,
  tweaks_colour_input,
  tweaks_colour_label,
  tweaks_preset,
  tweaks_reset_to_preset,
  tweaks_toggle_status,
} from "$lib/i18n/m/controls";
import { theme_dark, theme_light } from "$lib/i18n/m/theme";
import type { MarketingLocale, TweaksResolvedCopy } from "$lib/i18n/marketing-copy";

/**
 * Marketing appearance panel copy. Loaded lazily when the panel opens — it is the largest single
 * block of chrome copy and nothing renders it until the user asks for it. offlinePack and
 * notifications stay undefined: the marketing panel never renders them, and resolving them would
 * pull the whole settings namespace into a marketing-page download.
 * See docs/quran-system.md (Part 2, Message chunking).
 */
export function resolveAppearanceCopy(locale: MarketingLocale): TweaksResolvedCopy {
  return {
    settings: tweaks_settings(undefined, { locale }),
    theme: tweaks_theme(undefined, { locale }),
    closePanel: tweaks_close_panel(undefined, { locale }),
    mode: tweaks_mode(undefined, { locale }),
    surface: tweaks_surface(undefined, { locale }),
    accent: tweaks_accent(undefined, { locale }),
    customColours: tweaks_custom_colours(undefined, { locale }),
    clear: tweaks_clear(undefined, { locale }),
    seedNames: {
      bg: tweaks_background(undefined, { locale }),
      accent: tweaks_accent(undefined, { locale }),
      pop: tweaks_pop(undefined, { locale }),
    },
    colourLabel: tweaks_colour_label(undefined, { locale }),
    accentOptionLabel: (name) => tweaks_accent_option({ name }, { locale }),
    colourInputLabel: (name) => tweaks_colour_input({ name }, { locale }),
    preset: tweaks_preset(undefined, { locale }),
    resetToPresetLabel: (name) => tweaks_reset_to_preset({ name }, { locale }),
    toggleStatusLabel: (name, status) => tweaks_toggle_status({ name, status }, { locale }),
    derivedColours: tweaks_derived_colours(undefined, { locale }),
    copied: tweaks_copied(undefined, { locale }),
    copyCss: tweaks_copy_css(undefined, { locale }),
    reset: tweaks_reset(undefined, { locale }),
    dataPrivacy: tweaks_data_privacy(undefined, { locale }),
    analytics: tweaks_analytics(undefined, { locale }),
    performance: tweaks_performance(undefined, { locale }),
    on: tweaks_on(undefined, { locale }),
    off: tweaks_off(undefined, { locale }),
    performanceReload: tweaks_performance_reload(undefined, { locale }),
    themeNames: {
      dark: theme_dark(undefined, { locale }),
      light: theme_light(undefined, { locale }),
    },
    surfaces: {
      ink: {
        label: surface_ink_label(undefined, { locale }),
        note: surface_ink_note(undefined, { locale }),
      },
      paper: {
        label: surface_paper_label(undefined, { locale }),
        note: surface_paper_note(undefined, { locale }),
      },
      slate: {
        label: surface_slate_label(undefined, { locale }),
        note: surface_slate_note(undefined, { locale }),
      },
      mocha: {
        label: surface_mocha_label(undefined, { locale }),
        note: surface_mocha_note(undefined, { locale }),
      },
      contrast: {
        label: surface_contrast_label(undefined, { locale }),
        note: surface_contrast_note(undefined, { locale }),
      },
    },
    accents: {
      emerald: accent_emerald_label(undefined, { locale }),
      gold: accent_gold_label(undefined, { locale }),
      azure: accent_azure_label(undefined, { locale }),
      plum: accent_plum_label(undefined, { locale }),
    },
  };
}
