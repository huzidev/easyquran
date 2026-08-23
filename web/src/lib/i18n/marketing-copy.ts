// Types and route helpers for the marketing surface. Deliberately message-free: every module that
// only needs a type or a URL must be able to import this without pulling a single localized string.
// Resolved copy lives in the per-namespace modules — chrome-copy.ts, appearance-copy.ts,
// landing-copy.ts. See docs/quran-system.md (Part 2, Message chunking).
import type { IconName } from "$lib/components/icon";
import type { NotificationsCopy } from "$lib/components/notifications/notifications-copy";
import type { OfflinePackCopy } from "$lib/components/status/offline-pack-copy";
import type { AccentId, SurfaceId, ThemeMode } from "$lib/config/site";
import { SUPPORTED_UI_LOCALES, UI_LOCALES, uiDirection, type UiLocale } from "$lib/i18n/locales";
import { marketingHref } from "$lib/i18n/marketing";
import { readerHomeHrefFor } from "$lib/i18n/reader";

export const MARKETING_LOCALES = SUPPORTED_UI_LOCALES;
export type MarketingLocale = UiLocale;
export type MarketingDirection = "ltr" | "rtl";

export interface LocaleLink {
  locale: MarketingLocale;
  direction: MarketingDirection;
  label: string;
  href: `/${string}`;
  current: boolean;
}

export interface BrandResolvedCopy {
  homeLabel: string;
}

export interface NavResolvedCopy {
  primaryLabel: string;
  offlineLabel: string;
  offlineTitle: string;
  offlineDetail: string;
  searchQuran: string;
  account: string;
  signIn: string;
  settings: string;
  openPanel: string;
  closePanel: string;
  sitePanel: string;
  appearance: string;
  toggleTheme: string;
  theme: string;
  language: string;
  changeLanguage: string;
  themeNames: Record<ThemeMode, string>;
}

export interface FooterResolvedCopy {
  blurb: string;
  socialX: string;
  productHeading: string;
  productLabel: string;
  companyHeading: string;
  companyLabel: string;
  legalHeading: string;
  legalLabel: string;
  builtBy: string;
  projectBy: string;
}

export interface FooterLink {
  id: string;
  href: `/${string}`;
  label: string;
}

export interface MarketingFooterLinks {
  product: FooterLink[];
  company: FooterLink[];
  legal: FooterLink[];
}

export interface SurfaceResolvedCopy {
  label: string;
  note: string;
}

export interface TweaksResolvedCopy {
  settings: string;
  theme: string;
  closePanel: string;
  mode: string;
  surface: string;
  accent: string;
  customColours: string;
  clear: string;
  offlinePack?: OfflinePackCopy;
  notifications?: NotificationsCopy;
  seedNames: Record<"bg" | "accent" | "pop", string>;
  colourLabel: string;
  accentOptionLabel: (name: string) => string;
  colourInputLabel: (name: string) => string;
  preset: string;
  resetToPresetLabel: (name: string) => string;
  toggleStatusLabel: (name: string, status: string) => string;
  derivedColours: string;
  copied: string;
  copyCss: string;
  reset: string;
  dataPrivacy: string;
  analytics: string;
  performance: string;
  on: string;
  off: string;
  performanceReload: string;
  themeNames: Record<ThemeMode, string>;
  surfaces: Record<SurfaceId, SurfaceResolvedCopy>;
  accents: Record<AccentId, string>;
}

export interface LandingCard {
  id: string;
  icon: IconName;
  chip: string;
  title: string;
  body: string;
}

export interface LandingRoadmapItem {
  id: string;
  title: string;
  body: string;
}

export interface LandingResolvedCopy {
  badge: string;
  heroTitle: string;
  heroIntro: string;
  primaryCta: string;
  secondaryCta: string;
  todayEyebrow: string;
  todayTitle: string;
  todayIntro: string;
  values: LandingCard[];
  roadmapEyebrow: string;
  roadmapTitle: string;
  roadmapIntro: string;
  coming: string;
  roadmap: LandingRoadmapItem[];
}

export interface MarketingSeoCopy {
  title: string;
  description: string;
  imageAlt: string;
}

export interface MarketingResolvedCopy {
  locale: MarketingLocale;
  direction: MarketingDirection;
  skipToContent: string;
  brand: BrandResolvedCopy;
  nav: NavResolvedCopy;
  footer: FooterResolvedCopy;
  tweaks: TweaksResolvedCopy;
  landing: LandingResolvedCopy;
  seo: MarketingSeoCopy;
}

export function marketingLocaleFromPath(pathname: string): MarketingLocale {
  return pathname === "/ar" || pathname.startsWith("/ar/") ? "ar" : "en";
}

export function marketingDirection(locale: MarketingLocale): MarketingDirection {
  return uiDirection(locale);
}

export function marketingHomeHref(locale: MarketingLocale): "/" | "/ar/" {
  const href = marketingHref("home", locale);
  // Every UiLocale is currently published for "home" (MARKETING_PUBLICATIONS.home), so this
  // never fires today — it exists so an unpublished locale fails loudly instead of a `null`
  // silently flowing through as a truthy href string.
  if (href === null) {
    throw new Error(`marketingHomeHref: "home" is not published for locale "${locale}"`);
  }
  // SAFETY: "home" is published for exactly en+ar and MARKETING_PATHS.home is "/", so the checked localizeHref output is "/" for en or "/ar/" for ar — no other value can pass the null check above.
  return href as "/" | "/ar/";
}

export function marketingReaderHomeHref(locale: MarketingLocale): "/en/app" | "/ar/app" {
  return readerHomeHrefFor(locale);
}

export function marketingLocaleLinks(current: MarketingLocale): LocaleLink[] {
  return MARKETING_LOCALES.map((locale) => ({
    locale,
    direction: UI_LOCALES[locale].direction,
    label: UI_LOCALES[locale].endonym,
    href: marketingHomeHref(locale),
    current: locale === current,
  }));
}
