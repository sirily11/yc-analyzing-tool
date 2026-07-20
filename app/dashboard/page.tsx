import Link from "next/link";
import { ArrowRight, FilePlus2, FileText, MessageSquareText, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requirePageUser } from "@/lib/auth";
import { listChats, listCompanyResearchReports, listReports } from "@/lib/db/repository";
import { companyResearchDraftSchema } from "@/lib/types/company-research";
import { createPageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";
export const metadata = createPageMetadata("dashboard", "/dashboard", { privatePage: true });

export default async function DashboardPage() {
  const user = await requirePageUser();
  const [chats, reports, companyReports] = await Promise.all([listChats(user.id), listReports(user.id), listCompanyResearchReports(user.id)]);
  const completeReports = reports.filter((report) => report.status === "complete");
  const average = completeReports.length ? Math.round(completeReports.reduce((sum, report) => sum + Number(report.prediction?.score ?? 0), 0) / completeReports.length) : 0;
  const companyReportCards = companyReports.map((report) => {
    const document = companyResearchDraftSchema.safeParse(report.document);
    return {
      id: report.id,
      href: report.status === "complete" ? `/company-reports/${report.id}` : `/chat/${report.chatId}`,
      status: report.status,
      createdAt: report.createdAt,
      title: document.success ? document.data.title : report.title,
      summary: document.success ? document.data.executiveSummary : report.status === "failed" ? "Public company research did not complete. Open the conversation to retry." : "Public-source company research is still in progress.",
      result: report.status === "complete" ? `${report.companyIds.length} companies` : report.status,
      meta: "Company research",
    };
  });
  const completedCount = completeReports.length + companyReports.filter((report) => report.status === "complete").length;
  const reportCards = [...companyReportCards, ...reports.map((report) => {
    const hasReportPage = ["researching", "drafting", "complete"].includes(report.status);
    return {
      id: report.id,
      href: hasReportPage ? `/reports/${report.id}` : `/chat/${report.chatId}`,
      status: report.status,
      createdAt: report.createdAt,
      title: report.document?.profile.companyName ?? report.profile?.companyName ?? report.sourceFile.name.replace(/\.pdf$/i, ""),
      summary: report.document?.executiveSummary ?? (report.status === "failed" ? "This run did not complete. Open the conversation to retry." : report.status === "drafting" ? "Public research is complete. The evidence-led dossier is being drafted." : report.status === "researching" ? "Researching five similar companies, their websites, founders, and related public sources." : "Analysis is still in progress."),
      result: report.status === "complete" ? `${Math.round(Number(report.prediction?.score ?? 0))}/100 YC Fit` : report.status === "researching" ? "Researching similar companies" : report.status,
      meta: report.sourceFile.kind === "chat" ? "Chat brief" : `${report.sourceFile.pages} pages`,
    };
  })].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id));
  return (
    <AppShell user={user} chats={chats}>
      <div className="dashboard-page">
        <header className="dashboard-header"><div><p className="eyebrow">Founder workspace</p><h1>Good afternoon, {user.name.split(" ")[0]}.</h1><p>Explore your application signals, compare revisions, and keep every report private.</p></div><Link className="button-primary" href="/chat/new"><FilePlus2 size={16} /> New analysis</Link></header>
        <section className="dashboard-stats"><div><span>Completed reports</span><strong>{completedCount}</strong><small>Application and company research</small></div><div><span>Average fit signal</span><strong>{average || "—"}{average ? "/100" : ""}</strong><small>Application reports only</small></div><div><span>Private conversations</span><strong>{chats.length}</strong><small>Owned by your RxLab identity</small></div></section>
        <section className="dashboard-section" id="reports"><div className="dashboard-section-title"><div><span className="section-index">Recent reports</span><h2>Your analysis library</h2></div><span className="privacy-pill"><ShieldCheck size={13} /> Private by default</span></div>
          {reportCards.length ? <div className="report-grid">{reportCards.map((report) => <Link className="report-card" href={report.href} key={`${report.meta}-${report.id}`}><div className="report-card-top"><span className="report-doc-icon"><FileText size={18} /></span><span className="report-card-meta"><span className={`report-status ${report.status}`}>{report.status}</span><span className="mono-label">{report.meta}</span></span></div><h3>{report.title}</h3><p>{report.summary}</p><div className="report-card-bottom"><span>{report.result}</span><ArrowRight size={16} /></div></Link>)}</div> : <div className="empty-dashboard"><span><MessageSquareText size={21} /></span><h3>No reports yet.</h3><p>Analyze your startup or research public YC companies to create your first private visual report.</p><Link className="button-dark" href="/chat/new">Start the first analysis <ArrowRight size={15} /></Link></div>}
        </section>
      </div>
    </AppShell>
  );
}
