import { SITE } from "$lib/config/site";
import { mdSiblingPathFor } from "$lib/accept-parse";

export {
  appendVaryAccept,
  notAcceptableBody,
  parseAccept,
  preferredType,
  varyWithAccept,
} from "$lib/accept-parse";
export type { AcceptEntry, MdNegotiation } from "$lib/accept-parse";

export interface MdSibling {
  readonly canonicalPath: string;
  readonly mdPath: string;
}

export function mdSiblingRequest(pathname: string): MdSibling | null {
  const mdPath = mdSiblingPathFor(pathname);
  if (mdPath === null) return null;
  return { canonicalPath: pathname, mdPath };
}

export function agentNotFoundMarkdown(): string {
  return [
    `# ${SITE.name} — page not found`,
    "",
    "This page does not exist on EasyQuran.",
    "",
    `- [Home](${SITE.url}/)`,
    `- [llms.txt](${SITE.url}/llms.txt)`,
    `- [Full site content](${SITE.url}/llms-full.txt)`,
    `- [Sitemap](${SITE.url}/sitemap.xml)`,
    `- [Read Al Fatihah](${SITE.url}/app/al-fatihah)`,
    `- [Juz index](${SITE.url}/app/juz)`,
    `- [FAQ](${SITE.url}/faq)`,
    `- [Contact](${SITE.url}/contact)`,
    "",
  ].join("\n");
}
