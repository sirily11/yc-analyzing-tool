import Link from "next/link";
import { ArrowRight, FilePlus2, FileText, MessageSquareText, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requirePageUser } from "@/lib/auth";
import { listChats, listReports } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requirePageUser();
  const [chats, reports] = await Promise.all([listChats(user.id), listReports(user.id)]);
  const completeReports = reports.filter((report) => report.status === "complete");
  const average = completeReports.length ? Math.round(completeReports.reduce((sum, report) => sum + Number(report.prediction?.score ?? 0), 0) / completeReports.length) : 0;
  return (
    <AppShell user={user} chats={chats}>
      <div className="dashboard-page">
        <header className="dashboard-header"><div><p className="eyebrow">Founder workspace</p><h1>Good afternoon, {user.name.split(" ")[0]}.</h1><p>Explore your application signals, compare revisions, and keep every report private.</p></div><Link className="button-primary" href="/chat/new"><FilePlus2 size={16} /> New analysis</Link></header>
        <section className="dashboard-stats"><div><span>Completed reports</span><strong>{completeReports.length}</strong><small>Immutable, versioned analyses</small></div><div><span>Average fit signal</span><strong>{average || "—"}{average ? "/100" : ""}</strong><small>Not an acceptance probability</small></div><div><span>Private conversations</span><strong>{chats.length}</strong><small>Owned by your RxLab identity</small></div></section>
        <section className="dashboard-section" id="reports"><div className="dashboard-section-title"><div><span className="section-index">Recent reports</span><h2>Your application library</h2></div><span className="privacy-pill"><ShieldCheck size={13} /> Private by default</span></div>
          {reports.length ? <div className="report-grid">{reports.map((report) => <Link className="report-card" href={report.status === "complete" ? `/reports/${report.id}` : `/chat/${report.chatId}`} key={report.id}><span className={`report-status ${report.status}`}>{report.status}</span><div className="report-card-top"><span className="report-doc-icon"><FileText size={18} /></span><span className="mono-label">{report.sourceFile.kind === "chat" ? "Chat brief" : `${report.sourceFile.pages} pages`}</span></div><h3>{report.document?.profile.companyName ?? report.sourceFile.name.replace(/\.pdf$/i, "")}</h3><p>{report.document?.executiveSummary ?? (report.status === "failed" ? "This run did not complete. Open the conversation to retry." : "Analysis is still in progress.")}</p><div className="report-card-bottom"><span>{report.status === "complete" ? `${Math.round(Number(report.prediction?.score ?? 0))}/100 YC Fit` : report.status}</span><ArrowRight size={16} /></div></Link>)}</div> : <div className="empty-dashboard"><span><MessageSquareText size={21} /></span><h3>No reports yet.</h3><p>Describe your startup or upload a business plan, then approve the analysis to create your first visual report.</p><Link className="button-dark" href="/chat/new">Start the first analysis <ArrowRight size={15} /></Link></div>}
        </section>
      </div>
    </AppShell>
  );
}
