import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

vi.mock("$app/environment", () => ({ browser: true, dev: false }));
vi.mock("$env/dynamic/public", () => ({ env: {} }));

import { prefs } from "../prefs.svelte";

const KEY = "easyquran.prefs";

describe("prefs cross-tab wiring", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-surface");
    document.documentElement.removeAttribute("data-accent");
    prefs.hydrate();
  });

  it("re-applies a foreign tab's prefs from a storage event", () => {
    expect(prefs.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe(undefined);
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ theme: "light", surface: "paper", accent: "gold", instantResume: true }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(prefs.theme).toBe("light");
    expect(prefs.surface).toBe("paper");
    expect(prefs.accent).toBe("gold");
    expect(prefs.instantResume).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.surface).toBe("paper");
    expect(document.documentElement.dataset.accent).toBe("gold");
  });

  it("drops invalid fields from a foreign tab instead of applying them", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ theme: "blue", surface: "nope", accent: 7, custom: { bg: "red" } }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(prefs.theme).toBe("dark");
    expect(prefs.surface).toBe("ink");
    expect(prefs.accent).toBe("emerald");
    expect(prefs.hasCustom).toBe(false);
  });

  it("ignores storage events for other keys", () => {
    window.localStorage.setItem("easyquran.reader", JSON.stringify({ v: 3 }));
    window.dispatchEvent(new StorageEvent("storage", { key: "easyquran.reader" }));
    expect(prefs.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe(undefined);
  });
});
