import { browser } from "$app/environment";

import { arabicFontDef, type ArabicFontId } from "$lib/config/reader-fonts";

const loads = new Map<ArabicFontId, Promise<void>>();

function startLoad(id: ArabicFontId): Promise<void> {
  const def = arabicFontDef(id);
  if (!def.file) return Promise.resolve();
  return def
    .file()
    .then((url) => {
      const face = new FontFace(def.family, `url(${url}) format("woff2")`, { weight: "400" });
      return face.load().then(() => {
        document.fonts.add(face);
      });
    })
    .catch(() => {
      loads.delete(id);
    });
}

export function loadArabicFont(id: ArabicFontId): Promise<void> {
  if (!browser) return Promise.resolve();
  const pending = loads.get(id);
  if (pending) return pending;
  const started = startLoad(id);
  loads.set(id, started);
  return started;
}
