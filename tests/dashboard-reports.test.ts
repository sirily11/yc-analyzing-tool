import { describe, expect, it } from "vitest";
import { dashboardReportSearchHref, filterDashboardReports, paginateDashboardReports, parseDashboardReportSearchParams, type DashboardReportCard } from "@/lib/dashboard-reports";

const reports: DashboardReportCard[] = [
  {
    id: "application-1",
    kind: "application",
    href: "/reports/application-1",
    status: "complete",
    createdAt: "2026-07-20T01:00:00.000Z",
    title: "Acme Robotics",
    summary: "Warehouse automation for small operators.",
    result: "82/100 YC Fit",
    meta: "12 pages",
  },
  {
    id: "company-1",
    kind: "company",
    href: "/company-reports/company-1",
    status: "researching",
    createdAt: "2026-07-20T02:00:00.000Z",
    title: "Vertical AI landscape",
    summary: "Researching public YC companies.",
    result: "researching",
    meta: "Company research",
  },
  {
    id: "application-2",
    kind: "application",
    href: "/chat/chat-2",
    status: "failed",
    createdAt: "2026-07-20T03:00:00.000Z",
    title: "Healthcare workflow",
    summary: "This run did not complete.",
    result: "failed",
    meta: "Chat brief",
  },
];

describe("filterDashboardReports", () => {
  it("searches report text without case sensitivity", () => {
    expect(filterDashboardReports(reports, { query: "ROBOTICS", kind: "all", status: "all" }).map((report) => report.id)).toEqual(["application-1"]);
    expect(filterDashboardReports(reports, { query: "company research", kind: "all", status: "all" }).map((report) => report.id)).toEqual(["company-1"]);
  });

  it("combines report kind and grouped status filters", () => {
    expect(filterDashboardReports(reports, { query: "", kind: "company", status: "active" }).map((report) => report.id)).toEqual(["company-1"]);
    expect(filterDashboardReports(reports, { query: "", kind: "application", status: "failed" }).map((report) => report.id)).toEqual(["application-2"]);
  });
});

describe("paginateDashboardReports", () => {
  it("returns six reports per page and clamps a stale page after deletion", () => {
    const manyReports = Array.from({ length: 7 }, (_, index) => ({ ...reports[0], id: `report-${index + 1}` }));

    expect(paginateDashboardReports(manyReports, 1).reports).toHaveLength(6);
    expect(paginateDashboardReports(manyReports, 2)).toMatchObject({ currentPage: 2, pageCount: 2, reports: [{ id: "report-7" }] });
    expect(paginateDashboardReports(manyReports.slice(0, 6), 2)).toMatchObject({ currentPage: 1, pageCount: 1 });
  });
});

describe("dashboard report URL state", () => {
  it("parses valid search, filter, and page parameters", () => {
    expect(parseDashboardReportSearchParams({ q: "  robotics  ", type: "company", status: "active", page: "3" })).toEqual({
      query: "robotics",
      kind: "company",
      status: "active",
      page: 3,
    });
  });

  it("falls back safely for invalid parameters", () => {
    expect(parseDashboardReportSearchParams({ type: "unknown", status: "deleted", page: "-4" })).toEqual({
      query: "",
      kind: "all",
      status: "all",
      page: 1,
    });
  });

  it("builds a refresh-safe dashboard query string", () => {
    expect(dashboardReportSearchHref({ query: "vertical AI", kind: "company", status: "complete", page: 2 })).toBe("/dashboard?q=vertical+AI&type=company&status=complete&page=2#reports");
    expect(dashboardReportSearchHref({ query: "", kind: "all", status: "all", page: 1 })).toBe("/dashboard#reports");
  });
});
