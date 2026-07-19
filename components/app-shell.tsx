import Link from "next/link";
import { FilePlus2, LayoutDashboard, LogOut, Radar } from "lucide-react";
import type { AppUser } from "@/lib/auth";
import { signOut } from "@/lib/auth";
import { ChatHistory } from "@/components/chat-history";

type ShellChat = { id: string; title: string; updatedAt: Date };

export function AppShell({ user, chats, children }: { user: AppUser; chats: ShellChat[]; children: React.ReactNode }) {
  async function leave() { "use server"; await signOut({ redirectTo: "/" }); }
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Link href="/" className="brand"><span className="brand-mark">A</span><span>APPLICATION<br />SIGNAL</span></Link>
        <nav className="app-nav">
          <Link href="/dashboard"><LayoutDashboard size={15} /> Overview</Link>
          <Link href="/dashboard#reports"><Radar size={15} /> Reports</Link>
        </nav>
        <div className="sidebar-section"><div className="sidebar-heading"><span>Conversations</span><Link href="/chat/new" aria-label="New analysis"><FilePlus2 size={14} /></Link></div><ChatHistory chats={chats.slice(0, 8).map(({ id, title }) => ({ id, title }))} /></div>
        <div className="user-block"><span className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.isDevelopmentBypass ? "Local development" : user.email}</small></span><form action={leave}><button aria-label="Sign out"><LogOut size={14} /></button></form></div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
