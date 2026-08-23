import { footerLinksFor, type FooterLinkLabels } from "$lib/i18n/footer-links";
import {
  brand_home_label,
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
  nav_account,
  nav_appearance,
  nav_change_language,
  nav_close_panel,
  nav_language,
  nav_offline_detail,
  nav_offline_label,
  nav_offline_title,
  nav_open_panel,
  nav_primary_label,
  nav_search_quran,
  nav_settings,
  nav_sign_in,
  nav_site_panel,
  nav_theme,
  nav_toggle_theme,
  skip_to_content,
  tweaks_customize_appearance,
} from "$lib/i18n/m/chrome";
import { theme_dark, theme_light } from "$lib/i18n/m/theme";
import type {
  BrandResolvedCopy,
  FooterResolvedCopy,
  MarketingDirection,
  MarketingFooterLinks,
  MarketingLocale,
  NavResolvedCopy,
} from "$lib/i18n/marketing-copy";
import { marketingDirection, marketingReaderHomeHref } from "$lib/i18n/marketing-copy";

/**
 * Site chrome: the copy every marketing page renders. This is the localization floor — everything
 * else must live in a per-page namespace so a page never downloads copy it does not render.
 * See docs/quran-system.md (Part 2, Message chunking).
 */
export interface ChromeResolvedCopy {
  locale: MarketingLocale;
  direction: MarketingDirection;
  skipToContent: string;
  brand: BrandResolvedCopy;
  nav: NavResolvedCopy;
  footer: FooterResolvedCopy;
  /** Label on the closed appearance trigger. The panel copy itself is loaded on open. */
  appearanceTrigger: string;
}

export function marketingFooterLinks(locale: MarketingLocale): MarketingFooterLinks {
  return footerLinksFor(locale, footerLinkLabels(locale), marketingReaderHomeHref(locale));
}

function footerLinkLabels(locale: MarketingLocale): FooterLinkLabels {
  return {
    readQuran: footer_read_quran(undefined, { locale }),
    bookmarks: footer_bookmarks(undefined, { locale }),
    whatsInside: footer_whats_inside(undefined, { locale }),
    about: footer_about(undefined, { locale }),
    faq: footer_faq(undefined, { locale }),
    contact: footer_contact(undefined, { locale }),
    privacy: footer_privacy(undefined, { locale }),
    terms: footer_terms(undefined, { locale }),
  };
}

export function resolveChromeCopy(locale: MarketingLocale): ChromeResolvedCopy {
  return {
    locale,
    direction: marketingDirection(locale),
    skipToContent: skip_to_content(undefined, { locale }),
    brand: { homeLabel: brand_home_label(undefined, { locale }) },
    appearanceTrigger: tweaks_customize_appearance(undefined, { locale }),
    nav: {
      primaryLabel: nav_primary_label(undefined, { locale }),
      offlineLabel: nav_offline_label(undefined, { locale }),
      offlineTitle: nav_offline_title(undefined, { locale }),
      offlineDetail: nav_offline_detail(undefined, { locale }),
      searchQuran: nav_search_quran(undefined, { locale }),
      account: nav_account(undefined, { locale }),
      signIn: nav_sign_in(undefined, { locale }),
      settings: nav_settings(undefined, { locale }),
      openPanel: nav_open_panel(undefined, { locale }),
      closePanel: nav_close_panel(undefined, { locale }),
      sitePanel: nav_site_panel(undefined, { locale }),
      appearance: nav_appearance(undefined, { locale }),
      toggleTheme: nav_toggle_theme(undefined, { locale }),
      theme: nav_theme(undefined, { locale }),
      language: nav_language(undefined, { locale }),
      changeLanguage: nav_change_language(undefined, { locale }),
      themeNames: {
        dark: theme_dark(undefined, { locale }),
        light: theme_light(undefined, { locale }),
      },
    },
    footer: {
      blurb: footer_blurb(undefined, { locale }),
      socialX: footer_social_x(undefined, { locale }),
      productHeading: footer_product_heading(undefined, { locale }),
      productLabel: footer_product_label(undefined, { locale }),
      companyHeading: footer_company_heading(undefined, { locale }),
      companyLabel: footer_company_label(undefined, { locale }),
      legalHeading: footer_legal_heading(undefined, { locale }),
      legalLabel: footer_legal_label(undefined, { locale }),
      builtBy: footer_built_by(undefined, { locale }),
      projectBy: footer_project_by(undefined, { locale }),
    },
  };
}
