import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("$app/environment", () => ({ dev: false }));
vi.mock("$env/dynamic/public", () => ({ env: {} }));

import { SITE } from "$lib/config/site";
import { siteJsonLdGraph } from "$lib/seo/site-schema";

describe("siteJsonLdGraph", () => {
  const graph = siteJsonLdGraph();
  const [website, organization] = graph["@graph"];

  it("includes both WebSite and Organization nodes", () => {
    expect(website["@type"]).toBe("WebSite");
    expect(organization["@type"]).toBe("Organization");
  });

  it("gives both nodes a non-empty name and description", () => {
    for (const node of [website, organization]) {
      expect(node.name.length).toBeGreaterThan(0);
      expect(node.description.length).toBeGreaterThan(0);
    }
  });

  it("exposes a customer support contact point with email and contact url", () => {
    const contact = organization.contactPoint[0];
    expect(contact?.["@type"]).toBe("ContactPoint");
    expect(contact?.contactType).toBe("customer support");
    expect(contact?.email).toContain("@");
    expect(contact?.url.endsWith("/contact")).toBe(true);
  });

  it("links the organization to at least two profiles", () => {
    expect(organization.sameAs.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the website url, publisher reference and logo url", () => {
    expect(website.url).toBe(SITE.url);
    expect(website.publisher["@id"]).toBe(`${SITE.url}/#organization`);
    expect(organization.logo.url.length).toBeGreaterThan(0);
  });

  it("serializes without undefined values on required keys", () => {
    const parsed: unknown = JSON.parse(JSON.stringify(graph));
    expect(parsed).toBeTypeOf("object");
    for (const key of [
      "@context",
      "@graph[0].name",
      "@graph[0].description",
      "@graph[0].publisher",
      "@graph[1].name",
      "@graph[1].description",
      "@graph[1].contactPoint",
    ]) {
      expect(parsed).toHaveProperty(key);
    }
  });

  it("publishes a contact email on SITE", () => {
    expect(SITE.contactEmail).toContain("@");
  });
});
