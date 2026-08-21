import { SITE } from "$lib/config/site";
import { baseEnglishPageCopy } from "$lib/i18n/base-english-copy";

export interface ContactPointNode {
  "@type": "ContactPoint";
  contactType: string;
  email: string;
  url: string;
  availableLanguage: string[];
}

export interface LogoNode {
  "@type": "ImageObject";
  url: string;
  width: number;
  height: number;
}

export interface WebsiteNode {
  "@type": "WebSite";
  "@id": string;
  name: string;
  description: string;
  url: string;
  inLanguage: string;
  publisher: { "@id": string };
}

export interface OrganizationNode {
  "@type": "Organization";
  "@id": string;
  name: string;
  description: string;
  url: string;
  logo: LogoNode;
  sameAs: string[];
  contactPoint: ContactPointNode[];
}

export interface SiteJsonLdGraph {
  "@context": string;
  "@graph": [WebsiteNode, OrganizationNode];
}

export function siteJsonLdGraph(): SiteJsonLdGraph {
  const description = baseEnglishPageCopy("home").description;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE.url}/#website`,
        name: SITE.name,
        description,
        url: SITE.url,
        inLanguage: "en",
        publisher: { "@id": `${SITE.url}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE.url}/#organization`,
        name: SITE.name,
        description,
        url: SITE.url,
        logo: {
          "@type": "ImageObject",
          url: `${SITE.url}/logo.png`,
          width: 512,
          height: 512,
        },
        sameAs: [SITE.github, SITE.ownerUrl],
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: SITE.contactEmail,
            url: `${SITE.url}/contact`,
            availableLanguage: ["en", "ar"],
          },
        ],
      },
    ],
  };
}
