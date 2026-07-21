"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Coins, LayoutDashboard, Radar } from "lucide-react";

export function SidebarNavigation({ availablePoints }: { availablePoints?: number }) {
  const pathname = usePathname();
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    function updateHash() { setHash(window.location.hash); }

    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, [pathname]);

  const reportsSelected = pathname === "/dashboard" && hash === "#reports";
  const overviewSelected = pathname === "/dashboard" && hash !== null && !reportsSelected;
  const creditsSelected = pathname === "/credits";

  return (
    <nav className="app-nav">
      <Link href="/dashboard" aria-current={overviewSelected ? "page" : undefined}><LayoutDashboard size={15} /> Overview</Link>
      <Link href="/dashboard#reports" aria-current={reportsSelected ? "page" : undefined}><Radar size={15} /> Reports</Link>
      <Link href="/credits" className="credits-nav-link" aria-current={creditsSelected ? "page" : undefined}>
        <Coins size={15} /> Credits
        {availablePoints !== undefined && <strong>{availablePoints.toLocaleString("en-US")}</strong>}
      </Link>
    </nav>
  );
}
