import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Application Signal home">
        <span className="brand-mark">A</span>
        <span>APPLICATION SIGNAL</span>
      </Link>
      <span className="topbar-meta">PUBLIC DIRECTORY · 2022—2026 YTD</span>
      <nav className="topbar-actions" aria-label="Primary navigation">
        <a className="button-ghost" href="#methodology">Methodology</a>
        <Link className="button-primary" href="/login">
          Analyze a plan <ArrowUpRight size={15} />
        </Link>
      </nav>
    </header>
  );
}
