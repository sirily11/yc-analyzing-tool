import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { billingHistoryHref } from "@/lib/billing/history";

export function BillingPagination({
  pathname,
  currentPage,
  pageCount,
}: {
  pathname: "/point/history" | "/invoices";
  currentPage: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="billing-pagination" aria-label="History pages">
      {currentPage > 1
        ? <Link href={billingHistoryHref(pathname, currentPage - 1)}><ArrowLeft size={14} /> Previous</Link>
        : <span className="disabled"><ArrowLeft size={14} /> Previous</span>}
      <span>Page {currentPage} of {pageCount}</span>
      {currentPage < pageCount
        ? <Link href={billingHistoryHref(pathname, currentPage + 1)}>Next <ArrowRight size={14} /></Link>
        : <span className="disabled">Next <ArrowRight size={14} /></span>}
    </nav>
  );
}
