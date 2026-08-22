import { SITE } from "$lib/config/site";
import { MARKETING_PAGES } from "$lib/config/site-structure";
import { baseEnglishPageCopy } from "$lib/i18n/base-english-copy";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  hr: "---",
});
turndown.remove(["script", "style", "canvas", "noscript", "template"]);
turndown.addRule("stripSvg", {
  filter: (node) => node.nodeName.toLowerCase() === "svg",
  replacement: () => "",
});
turndown.addRule("stripAriaHidden", {
  filter: (node) =>
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- turndown types filter nodes as HTMLElement but walks every DOM node at runtime (text/comment nodes have no getAttribute); this probe is the only boundary check
    typeof node.getAttribute === "function" &&
    node.getAttribute("aria-hidden") === "true",
  replacement: () => "",
});
turndown.addRule("cleanHeading", {
  filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
  replacement: (content, node) => {
    const level = Number(node.nodeName.slice(1));
    const text = (content || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
    return `\n\n${"#".repeat(level)} ${text}\n\n`;
  },
});

export function htmlToMarkdown(html: string): string {
  const main = html.match(/<main[^>]*>[\s\S]*?<\/main>/i);
  const body = main ? main[0] : html;
  const md = turndown
    .turndown(body)
    .replace(/^›\s+.*$/gm, "")
    .replace(/ *copy$/gm, "")
    .replace(/ *copied ✓$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return md + "\n";
}

function mdVariantUrl(href: string): string {
  const path = href === "/" ? "/index.md" : `${href}.md`;
  return `${SITE.url}${path}`;
}

export function renderLlmsIndex(): string {
  const pageLines = MARKETING_PAGES.map((p) => {
    const copy = baseEnglishPageCopy(p.id);
    return `- [${copy.label}](${mdVariantUrl(p.href)}): ${copy.description}`;
  });
  return (
    [
      `# ${SITE.domain}`,
      "",
      `> ${baseEnglishPageCopy("home").description}`,
      "",
      SITE.url,
      "",
      "## When to use",
      "",
      "- Reading or quoting the Quran (Uthmani Arabic text) for any surah, juz, or mushaf page",
      "- Looking up a passage by surah and ayah number",
      "- Comparing translations of the same passage",
      "- Getting clean, citable text of a surah or page without browser chrome",
      "- Sharing a URL that opens a specific passage for a user",
      "- Not for: tafsir or commentary, hadith, audio, or word-by-word Arabic grammar analysis (not offered)",
      "",
      "## How to call",
      "",
      `- Surah: \`/app/<slug>\` (e.g. [al-fatihah](${SITE.url}/app/al-fatihah))`,
      "- Surah page N (N >= 2): `/app/<slug>/page/N`",
      "- Juz: `/app/juz/<1-30>`",
      "- Mushaf page: `/app/page/<1-604>`",
      "- Translation: `/app/<slug>/t/<lang>/<translator>`",
      "- Every route above (reader and marketing) also serves markdown: send `Accept: text/markdown` or append `.md` to the path",
      `- Site map: [sitemap.xml](${SITE.url}/sitemap.xml) lists every reader URL; the six marketing pages in one file: [llms-full.txt](${SITE.url}/llms-full.txt)`,
      "",
      ...pageLines,
      "",
      "## Optional",
      "",
      `- [Full content of every marketing page](${SITE.url}/llms-full.txt): concatenated markdown of the six marketing pages (Quran content lives on the reader routes above)`,
    ].join("\n") + "\n"
  );
}

export function mdToPlain(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];

  for (let line of lines) {
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue;

    line = line.replace(/^(#{1,6})\s+(.*?)\s*#*\s*$/, "$2");

    line = line.replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1");

    line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

    line = line.replace(/\*\*([^*]+)\*\*/g, "$1");
    line = line.replace(/__([^_]+)__/g, "$1");
    line = line.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
    line = line.replace(/(^|[^_\w])_([^_\n]+)_(?![\w])/g, "$1$2");

    out.push(line);
  }

  return (
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

export const pagePath = (slug: string): string => (slug === "index" ? "/" : `/${slug}`);

export const textVariantEntries = (): { slug: string }[] =>
  MARKETING_PAGES.filter((p) => p.href === "/" || !p.href.slice(1).includes("/")).map((p) => ({
    slug: p.href === "/" ? "index" : p.href.replace(/^\//, ""),
  }));
