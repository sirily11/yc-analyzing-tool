import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BillingPagination } from "@/components/billing-pagination";
import { requirePageUser } from "@/lib/auth";
import { parseBillingHistoryPage, type BillingHistorySearchParams } from "@/lib/billing/history";
import { getPointHistory } from "@/lib/billing/repository";

export const dynamic = "force-dynamic";

function points(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export default async function PointHistoryPage({ searchParams }: { searchParams: Promise<BillingHistorySearchParams> }) {
  const user = await requirePageUser();
  const requestedPage = parseBillingHistoryPage(await searchParams);
  const history = await getPointHistory(user.id, requestedPage);
  return (
    <div className="credits-page billing-history-page">
      <header className="billing-history-header">
        <div>
          <span className="eyebrow">Billing & usage</span>
          <h1>Point history</h1>
          <p>All point activity, newest first. Provider details stay private.</p>
        </div>
        <Link className="button-ghost" href="/credits"><ArrowLeft size={14} /> Back to credits</Link>
      </header>
      <section className="credits-section">
        <div className="credits-section-heading"><span className="eyebrow">Usage</span><p>{history.total.toLocaleString("en-US")} total entries</p></div>
        <div className="credit-list">
          {history.entries.length ? history.entries.map((entry) => (
            <div className="credit-row" key={entry.id}>
              <span><strong>{entry.description}</strong><small>{date(entry.createdAt)}</small></span>
              <b className={entry.pointsDelta >= 0 ? "positive" : ""}>{points(entry.pointsDelta)}</b>
            </div>
          )) : <p className="credits-empty">No point activity yet.</p>}
        </div>
        <BillingPagination pathname="/point/history" currentPage={history.currentPage} pageCount={history.pageCount} />
      </section>
    </div>
  );
}
