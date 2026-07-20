import { describe, expect, it } from "vitest";
import { createPageMetadata, PAGE_SHARE } from "@/lib/site-metadata";

describe("share metadata", () => {
  it("defines share copy for every page surface", () => {
    expect(Object.keys(PAGE_SHARE)).toEqual([
      "home",
      "login",
      "dashboard",
      "newAnalysis",
      "chat",
      "report",
      "companyReport",
    ]);

    for (const page of Object.values(PAGE_SHARE)) {
      expect(page.browserTitle.length).toBeGreaterThan(0);
      expect(page.socialTitle.length).toBeGreaterThan(0);
      expect(page.description.length).toBeGreaterThan(0);
      expect(page.eyebrow.length).toBeGreaterThan(0);
    }
  });

  it("keeps private route metadata useful for sharing without indexing it", () => {
    const metadata = createPageMetadata("chat", "/chat/example", { privatePage: true });

    expect(metadata.alternates).toEqual({ canonical: "/chat/example" });
    expect(metadata.openGraph).toMatchObject({
      title: PAGE_SHARE.chat.socialTitle,
      description: PAGE_SHARE.chat.description,
      url: "/chat/example",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: PAGE_SHARE.chat.socialTitle,
      description: PAGE_SHARE.chat.description,
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
