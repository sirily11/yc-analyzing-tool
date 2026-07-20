import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePlus2, ShieldCheck } from "lucide-react";
import { DashboardReportLibrary } from "@/components/dashboard-report-library";
import { getDashboardShellData } from "@/lib/dashboard-shell";
import { dashboardReportSearchHref, filterDashboardReports, paginateDashboardReports, parseDashboardReportSearchParams, type DashboardReportCard, type DashboardReportSearchParams } from "@/lib/dashboard-reports";
import { listCompanyResearchReports, listReports } from "@/lib/db/repository";
import { companyResearchDraftSchema } from "@/lib/types/company-research";
import { createPageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";
export const metadata = createPageMetadata("dashboard", "/dashboard", { privatePage: true });

export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardReportSearchParams> }) {
  const { user, chats } = await getDashboardShellData();
  const reportSearch = parseDashboardReportSearchParams(await searchParams);
  const [reports, companyReports] = await Promise.all([listReports(user.id), listCompanyResearchReports(user.id)]);
  const completeReports = reports.filter((report) => report.status === "complete");
  const average = completeReports.length ? Math.round(completeReports.reduce((sum, report) => sum + Number(report.prediction?.score ?? 0), 0) / completeReports.length) : 0;
  const companyReportCards: DashboardReportCard[] = companyReports.map((report) => {
    const document = companyResearchDraftSchema.safeParse(report.document);
    return {
      id: report.id,
      kind: "company",
      href: report.status === "complete" ? `/company-reports/${report.id}` : `/chat/${report.chatId}`,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      title: document.success ? document.data.title : report.title,
      summary: document.success ? document.data.executiveSummary : report.status === "failed" ? "Public company research did not complete. Open the conversation to retry." : "Public-source company research is still in progress.",
      result: report.status === "complete" ? `${report.companyIds.length} companies` : report.status,
      meta: "Company research",
    };
  });
  const completedCount = completeReports.length + companyReports.filter((report) => report.status === "complete").length;
  const applicationReportCards: DashboardReportCard[] = reports.map((report) => {
    const hasReportPage = ["researching", "drafting", "complete"].includes(report.status);
    return {
      id: report.id,
      kind: "application",
      href: hasReportPage ? `/reports/${report.id}` : `/chat/${report.chatId}`,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      title: report.document?.profile.companyName ?? report.profile?.companyName ?? report.sourceFile.name.replace(/\.pdf$/i, ""),
      summary: report.document?.executiveSummary ?? (report.status === "failed" ? "This run did not complete. Open the conversation to retry." : report.status === "drafting" ? "Public research is complete. The evidence-led dossier is being drafted." : report.status === "researching" ? "Researching five similar companies, their websites, founders, and related public sources." : "Analysis is still in progress."),
      result: report.status === "complete" ? `${Math.round(Number(report.prediction?.score ?? 0))}/100 YC Fit` : report.status === "researching" ? "Researching similar companies" : report.status,
      meta: report.sourceFile.kind === "chat" ? "Chat brief" : `${report.sourceFile.pages} pages`,
    };
  });
  const reportCards = [...companyReportCards, ...applicationReportCards]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id));
  const filteredReports = filterDashboardReports(reportCards, reportSearch);
  const reportPage = paginateDashboardReports(filteredReports, reportSearch.page);
  if (reportPage.currentPage !== reportSearch.page) redirect(dashboardReportSearchHref(reportSearch, reportPage.currentPage));
  return (
    <div className="dashboard-page">
      <header className="dashboard-header"><div><p className="eyebrow">Founder workspace</p><h1>Good afternoon, {user.name.split(" ")[0]}.</h1><p>Explore your application signals, compare revisions, and keep every report private.</p></div><Link className="button-primary" href="/chat/new"><FilePlus2 size={16} /> New analysis</Link></header>
      <section className="dashboard-stats"><div><span>Completed reports</span><strong>{completedCount}</strong><small>Application and company research</small></div><div><span>Average fit signal</span><strong>{average || "—"}{average ? "/100" : ""}</strong><small>Application reports only</small></div><div><span>Private conversations</span><strong>{chats.length}</strong><small>Owned by your RxLab identity</small></div></section>
      <section className="dashboard-section" id="reports"><div className="dashboard-section-title"><div><span className="section-index">Recent reports</span><h2>Your analysis library</h2></div><span className="privacy-pill"><ShieldCheck size={13} /> Private by default</span></div>
        <DashboardReportLibrary reports={reportPage.reports} totalReports={reportCards.length} filteredReports={filteredReports.length} search={{ ...reportSearch, page: reportPage.currentPage }} pageCount={reportPage.pageCount} />
      </section>
    </div>
  );
}
