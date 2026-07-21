import { describe, expect, it } from "vitest";
import { billingHistoryHref, parseBillingHistoryPage } from "@/lib/billing/history";

describe("billing history query pagination", () => {
  it("parses a positive page and falls back to the first page", () => {
    expect(parseBillingHistoryPage({ page: "3" })).toBe(3);
    expect(parseBillingHistoryPage({ page: ["2", "4"] })).toBe(2);
    expect(parseBillingHistoryPage({ page: "0" })).toBe(1);
    expect(parseBillingHistoryPage({ page: "not-a-page" })).toBe(1);
  });

  it("keeps the page number in history URLs", () => {
    expect(billingHistoryHref("/point/history", 2)).toBe("/point/history?page=2");
    expect(billingHistoryHref("/invoices", 1)).toBe("/invoices?page=1");
  });
});
