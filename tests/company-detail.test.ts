import { describe, expect, it } from "vitest";
import { parseYcCompanyPage } from "@/lib/yc/company-detail";

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

describe("YC company detail parser", () => {
  it("extracts public founder and company information", () => {
    const payload = {
      props: {
        company: {
          long_description: "Makes R&D faster & easier.",
          year_founded: 2025,
          team_size: 3,
          ycdc_status: "Active",
          tags: ["AI", "Biotech"],
          founders: [{
            user_id: 42,
            full_name: "Ada Lovelace",
            title: "Founder & CEO",
            founder_bio: "Builder's bio",
            linkedin_url: "https://www.linkedin.com/in/ada",
            twitter_url: "javascript:alert(1)",
          }],
        },
      },
    };
    const html = `<div data-page="${escapeAttribute(JSON.stringify(payload))}"></div>`;

    expect(parseYcCompanyPage(html)).toEqual({
      longDescription: "Makes R&D faster & easier.",
      yearFounded: 2025,
      teamSize: 3,
      status: "Active",
      tags: ["AI", "Biotech"],
      founders: [{
        id: 42,
        name: "Ada Lovelace",
        title: "Founder & CEO",
        bio: "Builder's bio",
        linkedIn: "https://www.linkedin.com/in/ada",
        twitter: null,
      }],
    });
  });

  it("rejects pages without the public company payload", () => {
    expect(() => parseYcCompanyPage("<html></html>")).toThrow("payload was not found");
  });
});
