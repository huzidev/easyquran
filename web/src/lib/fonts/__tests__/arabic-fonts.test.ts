import { describe, expect, it, beforeEach, afterEach, vi } from "vite-plus/test";

vi.mock("$app/environment", () => ({ browser: true, dev: false }));

const fontFake = vi.hoisted(() => {
  const state = {
    fileCalls: 0,
    rejectFaceLoad: false,
  };
  const amiri = { id: "amiri", family: "Amiri", stack: "Amiri" };
  const lazy = {
    id: "scheherazade-new",
    family: "Scheherazade New",
    stack: "Scheherazade New",
    file: () => {
      state.fileCalls += 1;
      return Promise.resolve("/fonts/scheherazade-new.woff2");
    },
  };
  return {
    state,
    arabicFontDef: (id: string) => (id === "amiri" ? amiri : lazy),
  };
});

vi.mock("$lib/config/reader-fonts", () => ({ arabicFontDef: fontFake.arabicFontDef }));

const constructed: FakeFontFace[] = [];
const registered: FakeFontFace[] = [];

class FakeFontFace {
  readonly family: string;
  readonly source: string;
  readonly weight: string;

  constructor(family: string, source: string, descriptors: { weight: string }) {
    this.family = family;
    this.source = source;
    this.weight = descriptors.weight;
    constructed.push(this);
  }

  load(): Promise<void> {
    if (fontFake.state.rejectFaceLoad) return Promise.reject(new Error("face load failed"));
    return Promise.resolve();
  }
}

beforeEach(() => {
  constructed.length = 0;
  registered.length = 0;
  fontFake.state.fileCalls = 0;
  fontFake.state.rejectFaceLoad = false;
  vi.resetModules();
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    value: { add: (face: FakeFontFace) => registered.push(face) },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadArabicFont", () => {
  it("imports the file, constructs a woff2 FontFace, loads it, then registers it in document.fonts", async () => {
    const { loadArabicFont } = await import("$lib/fonts/arabic-fonts");
    await loadArabicFont("scheherazade-new");
    expect(fontFake.state.fileCalls).toBe(1);
    expect(constructed.length).toBe(1);
    expect(constructed[0]!.family).toBe("Scheherazade New");
    expect(constructed[0]!.source).toBe('url(/fonts/scheherazade-new.woff2) format("woff2")');
    expect(constructed[0]!.weight).toBe("400");
    expect(registered.length).toBe(1);
  });

  it("dedupes concurrent and sequential calls to a single import + register", async () => {
    const { loadArabicFont } = await import("$lib/fonts/arabic-fonts");
    const concurrent = await Promise.all([
      loadArabicFont("scheherazade-new"),
      loadArabicFont("scheherazade-new"),
    ]);
    expect(concurrent.length).toBe(2);
    await loadArabicFont("scheherazade-new");
    expect(fontFake.state.fileCalls).toBe(1);
    expect(constructed.length).toBe(1);
    expect(registered.length).toBe(1);
  });

  it("drops the cache entry when the load fails so the next call retries", async () => {
    fontFake.state.rejectFaceLoad = true;
    const { loadArabicFont } = await import("$lib/fonts/arabic-fonts");
    await loadArabicFont("scheherazade-new");
    expect(fontFake.state.fileCalls).toBe(1);
    expect(registered.length).toBe(0);
    fontFake.state.rejectFaceLoad = false;
    await loadArabicFont("scheherazade-new");
    expect(fontFake.state.fileCalls).toBe(2);
    expect(constructed.length).toBe(2);
    expect(registered.length).toBe(1);
  });

  it("resolves the default amiri id without constructing or registering a face", async () => {
    const { loadArabicFont } = await import("$lib/fonts/arabic-fonts");
    await loadArabicFont("amiri");
    expect(fontFake.state.fileCalls).toBe(0);
    expect(constructed.length).toBe(0);
    expect(registered.length).toBe(0);
  });
});
