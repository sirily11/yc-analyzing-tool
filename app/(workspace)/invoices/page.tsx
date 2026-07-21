import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BillingPagination } from "@/components/billing-pagination";
import { requirePageUser } from "@/lib/auth";
import { parseBillingHistoryPage, type BillingHistorySearchParams } from "@/lib/billing/history";
import { getInvoiceHistory } from "@/lib/billing/repository";

export const dynamic = "force-dynamic";

function date(value: Date) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<BillingHistorySearchParams> }) {
  const user = await requirePageUser();
  const requestedPage = parseBillingHistoryPage(await searchParams);
  const history = await getInvoiceHistory(user.id, requestedPage);
  return (
    <div className="credits-page billing-history-page">
      <header className="billing-history-header">
        <div>
          <span className="eyebrow">Billing & usage</span>
          <h1>Invoices</h1>
          <p>Paid top-ups and their Stripe invoice documents, newest first.</p>
        </div>
        <Link className="button-ghost" href="/credits"><ArrowLeft size={14} /> Back to credits</Link>
      </header>
      <section className="credits-section">
        <div className="credits-section-heading"><span className="eyebrow">Paid top-ups</span><p>{history.total.toLocaleString("en-US")} total invoices</p></div>
        <div className="credit-list">
          {history.invoices.length ? history.invoices.map((invoice) => (
            <div className="credit-row topup" key={invoice.id}>
              <span><strong>{invoice.points.toLocaleString("en-US")} points</strong><small>{date(invoice.paidAt ?? invoice.createdAt)} · ${(invoice.amountCents / 100).toFixed(2)} {invoice.currency.toUpperCase()}</small></span>
              <span className="invoice-links">
                {invoice.hostedInvoiceUrl ? <Link href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">Invoice</Link> : null}
                {invoice.invoicePdfUrl ? <Link href={invoice.invoicePdfUrl} target="_blank" rel="noreferrer">PDF</Link> : null}
                {!invoice.hostedInvoiceUrl && !invoice.invoicePdfUrl ? <small>Paid</small> : null}
              </span>
            </div>
          )) : <p className="credits-empty">No paid top-ups yet.</p>}
        </div>
        <BillingPagination pathname="/invoices" currentPage={history.currentPage} pageCount={history.pageCount} />
      </section>
    </div>
  );
}
