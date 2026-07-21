import Link from "next/link";
import { Suspense } from "react";
import { AppSidebar } from "@/components/app-shell";
import { SidebarNavigation } from "@/components/sidebar-navigation";
import { getBillingSummary } from "@/lib/billing/repository";
import { getDashboardShellData } from "@/lib/dashboard-shell";

async function DashboardSidebar() {
  const { user, chats } = await getDashboardShellData();
  const billing = await getBillingSummary(user.id);
  return <AppSidebar user={user} chats={chats} availablePoints={billing.availablePoints} />;
}

function DashboardSidebarLoading() {
  return (
    <aside className="app-sidebar app-sidebar-loading" aria-label="Loading workspace navigation">
      <Link href="/" className="brand"><span className="brand-mark">A</span><span>APPLICATION<br />SIGNAL</span></Link>
      <SidebarNavigation />
      <div className="sidebar-section">
        <div className="sidebar-heading"><span>Conversations</span></div>
        <div className="sidebar-loading-lines" aria-hidden="true"><span /><span /><span /><span /></div>
      </div>
      <div className="user-block" aria-hidden="true">
        <span className="user-avatar" />
        <span className="sidebar-loading-user"><i /><i /></span>
      </div>
    </aside>
  );
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-layout">
      <Suspense fallback={<DashboardSidebarLoading />}><DashboardSidebar /></Suspense>
      <main className="app-main">{children}</main>
    </div>
  );
}
