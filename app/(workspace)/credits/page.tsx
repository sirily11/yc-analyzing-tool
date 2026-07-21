import Link from "next/link";
import { CreditPacks } from "@/components/credit-packs";
import { requirePageUser } from "@/lib/auth";
import { getBillingSummary } from "@/lib/billing/repository";

export const dynamic = "force-dynamic";

function points(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await requirePageUser();
  const [summary, query] = await Promise.all([getBillingSummary(user.id), searchParams]);
  return (
    <div className="credits-page">
      <header className="credits-header">
        <div>
          <span className="eyebrow">Billing & usage</span>
          <h1>Credits</h1>
          <p>Prepay for AI and public-web research. One thousand points cover one US dollar of provider usage.</p>
        </div>
        <div className="credit-balance-card">
          <span>Available balance</span>
          <strong>{summary.availablePoints.toLocaleString("en-US")}</strong>
          <small>points{summary.reservedPoints ? ` · ${summary.reservedPoints.toLocaleString("en-US")} reserved` : ""}</small>
        </div>
      </header>

      {query.checkout === "success" ? <div className="credits-notice success">Payment received. Your points appear after Stripe confirms the payment.</div> : null}
      {query.checkout === "cancelled" ? <div className="credits-notice">Checkout was cancelled. No points were added.</div> : null}

      <section className="credits-section">
        <div className="credits-section-heading"><span className="eyebrow">Top up</span><p>1,000 points = $1.29 USD</p></div>
        <CreditPacks packs={summary.packs} enabled={summary.enabled} />
      </section>

      <section className="credits-section credits-history-grid">
        <div>
          <div className="credits-section-heading"><span className="eyebrow">Point history</span><p>Provider details stay private.</p></div>
          <div className="credit-list">
            {summary.ledger.length ? summary.ledger.map((entry) => (
              <div className="credit-row" key={entry.id}>
                <span><strong>{entry.description}</strong><small>{date(entry.createdAt)}</small></span>
                <b className={entry.pointsDelta >= 0 ? "positive" : ""}>{points(entry.pointsDelta)}</b>
              </div>
            )) : <p className="credits-empty">No point activity yet.</p>}
          </div>
          <Link className="button-ghost history-view-all" href="/point/history?page=1">View all point usage</Link>
        </div>
        <div>
          <div className="credits-section-heading"><span className="eyebrow">Top-ups & invoices</span><p>Invoices are issued by Stripe.</p></div>
          <div className="credit-list">
            {summary.topups.length ? summary.topups.map((topup) => (
              <div className="credit-row topup" key={topup.id}>
                <span><strong>{topup.points.toLocaleString("en-US")} points</strong><small>{date(topup.paidAt ?? topup.createdAt)} · paid</small></span>
                <span className="invoice-links">
                  {topup.hostedInvoiceUrl ? <Link href={topup.hostedInvoiceUrl} target="_blank" rel="noreferrer">Invoice</Link> : null}
                  {topup.invoicePdfUrl ? <Link href={topup.invoicePdfUrl} target="_blank" rel="noreferrer">PDF</Link> : null}
                  {!topup.hostedInvoiceUrl && !topup.invoicePdfUrl ? <small>${(topup.amountCents / 100).toFixed(2)}</small> : null}
                </span>
              </div>
            )) : <p className="credits-empty">No paid top-ups yet.</p>}
          </div>
          <Link className="button-ghost history-view-all" href="/invoices?page=1">View all invoices</Link>
        </div>
      </section>
    </div>
  );
}
