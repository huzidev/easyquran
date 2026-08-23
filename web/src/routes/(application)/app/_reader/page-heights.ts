import { reader } from "$lib/stores/reader.svelte";
import { SvelteMap } from "svelte/reactivity";

export function widthBucket(width: number): number {
  return Math.max(320, Math.round(Math.max(width, 320) / 24) * 24);
}

/**
 * Measured page heights keyed by the layout inputs that can change them
 * (reader mode, Arabic font size/family, translation size/family, container
 * width bucket), so spacers keep an accurate height across layout changes
 * instead of resetting to an estimate.
 */
export class PageHeightCache {
  #heights = new SvelteMap<string, SvelteMap<number, number>>();

  #key(width: number): string {
    return `${reader.mode}:${reader.arabicSizePx}:${reader.arabicFont}:${reader.translationSizePx}:${reader.translationFamily}:${widthBucket(width)}`;
  }

  #defaultHeight(width: number): number {
    const fontScale = Number.parseFloat(reader.arabicSizePx) / 33;
    const widthScale = Math.min(2.3, Math.max(0.85, Math.sqrt(1050 / widthBucket(width))));
    return Math.round((reader.isReadingMode ? 720 : 1320) * fontScale * widthScale);
  }

  get(localPage: number, width: number): number {
    return this.#heights.get(this.#key(width))?.get(localPage) ?? this.#defaultHeight(width);
  }

  save(localPage: number, height: number, width: number): void {
    if (!Number.isFinite(height) || height <= 0) return;
    const key = this.#key(width);
    let heights = this.#heights.get(key);
    if (!heights) {
      heights = new SvelteMap<number, number>();
      this.#heights.set(key, heights);
    }
    const rounded = Math.ceil(height);
    if (heights.get(localPage) !== rounded) heights.set(localPage, rounded);
  }
}

/**
 * Page height without expandable verse notes, so toggling a note does not
 * poison the cached height used for that page's spacer.
 */
export function stablePageHeight(node: HTMLElement, rect?: DOMRect): number {
  const nodeRect = rect ?? node.getBoundingClientRect();
  let height = nodeRect.height;
  for (const note of node.querySelectorAll<HTMLElement>(".verse-note")) {
    const style = getComputedStyle(note);
    height -=
      note.getBoundingClientRect().height +
      Number.parseFloat(style.marginTop || "0") +
      Number.parseFloat(style.marginBottom || "0");
  }
  return height;
}
