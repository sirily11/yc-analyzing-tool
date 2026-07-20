export const DASHBOARD_REPORTS_PER_PAGE = 6;

export type DashboardReportKind = "application" | "company";
export type DashboardReportFilter = "all" | DashboardReportKind;
export type DashboardReportStatusFilter = "all" | "complete" | "active" | "failed";

export type DashboardReportSearch = {
  query: string;
  kind: DashboardReportFilter;
  status: DashboardReportStatusFilter;
  page: number;
};

export type DashboardReportSearchParams = Record<string, string | string[] | undefined>;

export type DashboardReportCard = {
  id: string;
  kind: DashboardReportKind;
  href: string;
  status: string;
  createdAt: string;
  title: string;
  summary: string;
  result: string;
  meta: string;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseDashboardReportSearchParams(searchParams: DashboardReportSearchParams): DashboardReportSearch {
  const query = (firstSearchParam(searchParams.q) ?? "").trim().slice(0, 200);
  const requestedKind = firstSearchParam(searchParams.type);
  const requestedStatus = firstSearchParam(searchParams.status);
  const requestedPage = Number.parseInt(firstSearchParam(searchParams.page) ?? "1", 10);

  return {
    query,
    kind: requestedKind === "application" || requestedKind === "company" ? requestedKind : "all",
    status: requestedStatus === "complete" || requestedStatus === "active" || requestedStatus === "failed" ? requestedStatus : "all",
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  };
}

export function dashboardReportSearchHref(search: DashboardReportSearch, page = search.page) {
  const params = new URLSearchParams();
  const query = search.query.trim();
  if (query) params.set("q", query);
  if (search.kind !== "all") params.set("type", search.kind);
  if (search.status !== "all") params.set("status", search.status);
  if (page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return `/dashboard${queryString ? `?${queryString}` : ""}#reports`;
}

function matchesStatus(status: string, filter: DashboardReportStatusFilter) {
  if (filter === "all") return true;
  if (filter === "active") return !["complete", "failed"].includes(status);
  return status === filter;
}

export function filterDashboardReports(
  reports: DashboardReportCard[],
  options: {
    query: string;
    kind: DashboardReportFilter;
    status: DashboardReportStatusFilter;
  },
) {
  const query = options.query.trim().toLocaleLowerCase();
  return reports.filter((report) => {
    if (options.kind !== "all" && report.kind !== options.kind) return false;
    if (!matchesStatus(report.status, options.status)) return false;
    if (!query) return true;
    return [report.title, report.summary, report.result, report.meta, report.status]
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
}

export function paginateDashboardReports(reports: DashboardReportCard[], requestedPage: number, pageSize = DASHBOARD_REPORTS_PER_PAGE) {
  const pageCount = Math.max(1, Math.ceil(reports.length / pageSize));
  const currentPage = Math.min(Math.max(1, requestedPage), pageCount);
  return {
    currentPage,
    pageCount,
    reports: reports.slice((currentPage - 1) * pageSize, currentPage * pageSize),
  };
}
