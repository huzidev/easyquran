import { browser } from "$app/environment";
import {
  ACCENTS,
  DEFAULTS,
  SURFACES,
  type AccentId,
  type SurfaceId,
  type ThemeMode,
} from "$lib/config/site";
import { asLiteral, asObject, asString, onStorageKey, readJSON, writeJSON } from "$lib/storage";
import { deriveTokens, tokensToCss, type CustomSeeds } from "$lib/theme/derive";

const STORAGE_KEY = "easyquran.prefs";

const CUSTOM_PROPS = [
  "--bg",
  "--bg-1",
  "--bg-2",
  "--bg-3",
  "--bg-elev",
  "--line",
  "--line-2",
  "--line-3",
  "--fg",
  "--fg-2",
  "--fg-3",
  "--fg-4",
  "--accent",
  "--accent-soft",
  "--accent-line",
  "--accent-fg",
  "--ring",
  "--pop",
  "--pop-soft",
] as const;

export interface Prefs {
  theme: ThemeMode;
  surface: SurfaceId;
  accent: AccentId;
  custom: CustomSeeds;
  instantResume: boolean;
}

type PrefPatch = Partial<Prefs>;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- guards asObject() dictionary values (raw localStorage JSON); the string check below is the parse
const isHex = (v: unknown): v is string => {
  const s = asString(v);
  return s !== undefined && /^#[0-9a-f]{6}$/i.test(s);
};

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the untyped localStorage JSON boundary (asObject value); this function is the parser (isHex validates each seed)
function cleanCustom(raw: unknown): CustomSeeds {
  const out: CustomSeeds = {};
  const c = asObject(raw);
  if (!c) return out;
  if (isHex(c.bg)) out.bg = c.bg;
  if (isHex(c.accent)) out.accent = c.accent;
  if (isHex(c.pop)) out.pop = c.pop;
  return out;
}

function load(): Prefs {
  const base: Prefs = { ...DEFAULTS, instantResume: false, custom: {} };
  if (!browser) return base;
  const stored = asObject(readJSON(STORAGE_KEY));
  const surface = stored?.surface;
  const accent = stored?.accent;
  return {
    theme: asLiteral(stored?.theme, ["dark", "light"] as const) ?? base.theme,
    surface: SURFACES.find((s) => s.id === surface)?.id ?? base.surface,
    accent: ACCENTS.find((a) => a.id === accent)?.id ?? base.accent,
    custom: cleanCustom(stored?.custom),
    instantResume: stored?.instantResume === true,
  };
}

class PrefsStore {
  #prefs = $state<Prefs>({ ...DEFAULTS, instantResume: false, custom: {} });
  #hydrated = false;

  hydrate(): void {
    if (this.#hydrated || !browser) return;
    this.#hydrated = true;
    this.#prefs = { ...this.#prefs, ...load() };
    onStorageKey(STORAGE_KEY, () => {
      this.#prefs = load();
      this.apply();
    });
  }

  get current(): Readonly<Prefs> {
    return this.#prefs;
  }
  get theme(): ThemeMode {
    return this.#prefs.theme;
  }
  get surface(): SurfaceId {
    return this.#prefs.surface;
  }
  get accent(): AccentId {
    return this.#prefs.accent;
  }
  get instantResume(): boolean {
    return this.#prefs.instantResume;
  }
  get custom(): Readonly<CustomSeeds> {
    return this.#prefs.custom;
  }
  get hasCustom(): boolean {
    const c = this.#prefs.custom;
    return Boolean(c.bg || c.accent || c.pop);
  }

  get customTokens(): Record<string, string> {
    return deriveTokens(this.#prefs.custom);
  }

  css(): string {
    const selector =
      `[data-theme="${this.#prefs.theme}"][data-surface="${this.#prefs.surface}"]` +
      `[data-accent="${this.#prefs.accent}"]`;
    return tokensToCss(this.customTokens, selector);
  }

  apply(): void {
    if (!browser) return;
    const el = document.documentElement;
    el.dataset.theme = this.#prefs.theme;
    el.dataset.surface = this.#prefs.surface;
    el.dataset.accent = this.#prefs.accent;

    const tokens = this.customTokens;
    for (const prop of CUSTOM_PROPS) {
      const value = tokens[prop];
      if (value) el.style.setProperty(prop, value);
      else el.style.removeProperty(prop);
    }
  }

  set(patch: PrefPatch): void {
    this.#prefs = { ...this.#prefs, ...patch };
    if (browser) {
      writeJSON(STORAGE_KEY, this.#prefs);
      this.apply();
      window.dispatchEvent(new CustomEvent("easyquran:pref", { detail: patch }));
    }
  }

  setTheme(theme: ThemeMode): void {
    this.set({ theme });
  }
  setSurface(surface: SurfaceId): void {
    this.set({ surface });
  }
  setAccent(accent: AccentId): void {
    const { accent: _dropped, ...rest } = this.#prefs.custom;
    this.set({ accent, custom: rest });
  }
  setInstantResume(value: boolean): void {
    this.set({ instantResume: value });
  }
  toggleTheme(): void {
    this.set({ theme: this.#prefs.theme === "dark" ? "light" : "dark" });
  }

  setCustom(key: keyof CustomSeeds, hex: string | undefined): void {
    const next = { ...this.#prefs.custom };
    if (hex && isHex(hex)) next[key] = hex;
    else delete next[key];
    this.set({ custom: next });
  }

  clearCustom(): void {
    this.set({ custom: {} });
  }

  reset(): void {
    this.set({ ...DEFAULTS, instantResume: false, custom: {} });
  }
}

export const prefs = new PrefsStore();
