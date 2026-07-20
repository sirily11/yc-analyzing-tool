"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileText, MessageSquareText, MoreHorizontal, Search, Trash2, X } from "lucide-react";
import {
  dashboardReportSearchHref,
  type DashboardReportCard,
  type DashboardReportSearch,
} from "@/lib/dashboard-reports";

type ContextMenu = { report: DashboardReportCard; x: number; y: number };

export function DashboardReportLibrary({ reports, totalReports, filteredReports, search, pageCount }: {
  reports: DashboardReportCard[];
  totalReports: number;
  filteredReports: number;
  search: DashboardReportSearch;
  pageCount: number;
}) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [items, setItems] = useState(reports);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DashboardReportCard | null>(null);
  const [confirmationStep, setConfirmationStep] = useState<1 | 2>(1);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setItems(reports), [reports]);

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  useEffect(() => {
    if (!menu) return;

    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function closeOnPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    function closeMenu() { setMenu(null); }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menu]);

  const filtersActive = Boolean(search.query || search.kind !== "all" || search.status !== "all");

  function resetFilters() {
    router.replace(dashboardReportSearchHref({ query: "", kind: "all", status: "all", page: 1 }), { scroll: false });
  }

  function filtersFromForm(form: HTMLFormElement): DashboardReportSearch {
    const data = new FormData(form);
    const kind = String(data.get("type") ?? "all");
    const status = String(data.get("status") ?? "all");
    return {
      query: String(data.get("q") ?? ""),
      kind: kind === "application" || kind === "company" ? kind : "all",
      status: status === "complete" || status === "active" || status === "failed" ? status : "all",
      page: 1,
    };
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    router.replace(dashboardReportSearchHref(filtersFromForm(event.currentTarget)), { scroll: false });
  }

  function scheduleSearch(form: HTMLFormElement) {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      router.replace(dashboardReportSearchHref(filtersFromForm(form)), { scroll: false });
    }, 300);
  }

  function openMenu(report: DashboardReportCard, x: number, y: number) {
    const menuWidth = 174;
    const menuHeight = 52;
    setMenu({
      report,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    });
  }

  function beginDelete(report: DashboardReportCard) {
    setMenu(null);
    setDeleteTarget(report);
    setConfirmationStep(1);
    setDeleteError(null);
  }

  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteTarget(null);
    setConfirmationStep(1);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || confirmationStep !== 2) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const endpoint = deleteTarget.kind === "company"
        ? `/api/company-reports/${deleteTarget.id}`
        : `/api/reports/${deleteTarget.id}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Could not delete this report.");
      }

      const deletedId = deleteTarget.id;
      const deletedKind = deleteTarget.kind;
      setItems((current) => current.filter((report) => report.id !== deletedId || report.kind !== deletedKind));
      setDeleteTarget(null);
      setConfirmationStep(1);
      if (items.length === 1 && search.page > 1) router.replace(dashboardReportSearchHref(search, search.page - 1), { scroll: false });
      else router.refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete this report.");
    } finally {
      setDeleting(false);
    }
  }

  if (!totalReports) {
    return <div className="empty-dashboard"><span><MessageSquareText size={21} /></span><h3>No reports yet.</h3><p>Analyze your startup or research public YC companies to create your first private visual report.</p><Link className="button-dark" href="/chat/new">Start the first analysis <ArrowRight size={15} /></Link></div>;
  }

  return (
    <>
      <form className="report-library-tools" action="/dashboard" method="get" key={`${search.query}:${search.kind}:${search.status}`} onSubmit={submitFilters}>
        <label className="report-search"><span>Search reports</span><span><Search size={15} /><input name="q" type="search" defaultValue={search.query} onChange={(event) => { const form = event.currentTarget.form; if (form) scheduleSearch(form); }} placeholder="Search title or summary" /></span></label>
        <label><span>Report type</span><select name="type" defaultValue={search.kind} onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="all">All reports</option><option value="application">Application reports</option><option value="company">Company research</option></select></label>
        <label><span>Status</span><select name="status" defaultValue={search.status} onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="all">All statuses</option><option value="complete">Complete</option><option value="active">In progress</option><option value="failed">Failed</option></select></label>
        <button className="button-dark report-library-submit" type="submit">Apply</button>
      </form>

      <div className="report-library-summary" aria-live="polite">
        <span>{filteredReports === totalReports ? `${totalReports} reports` : `${filteredReports} of ${totalReports} reports`}</span>
        {filtersActive && <button type="button" onClick={resetFilters}>Clear filters</button>}
      </div>

      {items.length ? (
        <div className="report-grid">
          {items.map((report) => (
            <article
              className="report-card"
              key={`${report.kind}-${report.id}`}
              onContextMenu={(event) => { event.preventDefault(); openMenu(report, event.clientX, event.clientY); }}
            >
              <Link
                className="report-card-link"
                href={report.href}
                onKeyDown={(event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  openMenu(report, bounds.right - 30, bounds.top + 30);
                }}
                aria-haspopup="menu"
              >
                <div className="report-card-top"><span className="report-doc-icon"><FileText size={18} /></span><span className="report-card-meta"><span className={`report-status ${report.status}`}>{report.status}</span><span className="mono-label">{report.meta}</span></span></div>
                <h3>{report.title}</h3>
                <p>{report.summary}</p>
                <div className="report-card-bottom"><span>{report.result}</span><ArrowRight size={16} /></div>
              </Link>
              <button
                className="report-card-menu"
                type="button"
                aria-label={`Open actions for ${report.title}`}
                aria-haspopup="menu"
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  openMenu(report, bounds.right, bounds.bottom + 5);
                }}
              ><MoreHorizontal size={17} /></button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-dashboard report-filter-empty"><span><Search size={21} /></span><h3>No matching reports.</h3><p>Try another search or clear the report filters.</p><button className="button-dark" type="button" onClick={resetFilters}>Clear filters</button></div>
      )}

      {pageCount > 1 && (
        <nav className="report-pagination" aria-label="Report pages">
          <button type="button" onClick={() => router.push(dashboardReportSearchHref(search, search.page - 1), { scroll: false })} disabled={search.page === 1}><ArrowLeft size={14} /> Previous</button>
          <span>Page {search.page} of {pageCount}</span>
          <button type="button" onClick={() => router.push(dashboardReportSearchHref(search, search.page + 1), { scroll: false })} disabled={search.page === pageCount}>Next <ArrowRight size={14} /></button>
        </nav>
      )}

      {menu && (
        <div ref={menuRef} className="chat-context-menu" role="menu" aria-label={`Actions for ${menu.report.title}`} style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" className="danger" onClick={() => beginDelete(menu.report)}><Trash2 size={13} /> Delete report</button>
        </div>
      )}

      {deleteTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeleteDialog(); }}>
          <section className="chat-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-report-title" aria-describedby="delete-report-description" onKeyDown={(event) => { if (event.key === "Escape") closeDeleteDialog(); }}>
            <button className="dialog-close" type="button" aria-label="Close delete confirmation" onClick={closeDeleteDialog} disabled={deleting}><X size={15} /></button>
            <span className="section-index danger-text">Confirmation {confirmationStep} of 2</span>
            <h2 id="delete-report-title">{confirmationStep === 1 ? "Delete this report?" : "Permanently delete report?"}</h2>
            <p id="delete-report-description">{confirmationStep === 1 ? `“${deleteTarget.title}” will be removed from your report library. The conversation and retained source PDF will remain available.` : `Final confirmation: delete “${deleteTarget.title}”. This report cannot be recovered.`}</p>
            {deleteError && <p className="dialog-error" role="alert">{deleteError}</p>}
            <div className="dialog-actions">
              <button className="button-ghost" type="button" autoFocus onClick={closeDeleteDialog} disabled={deleting}>Cancel</button>
              {confirmationStep === 1
                ? <button className="button-danger-outline" type="button" onClick={() => setConfirmationStep(2)}>Continue</button>
                : <button className="button-danger" type="button" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete report"}</button>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
