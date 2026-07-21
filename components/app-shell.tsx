import Link from "next/link";
import { FilePlus2, LogOut } from "lucide-react";
import type { AppUser } from "@/lib/auth";
import { signOut } from "@/lib/auth";
import { ChatHistory } from "@/components/chat-history";
import { SidebarNavigation } from "@/components/sidebar-navigation";

type ShellChat = { id: string; title: string; updatedAt: Date };

export function AppSidebar({ user, chats, availablePoints }: { user: AppUser; chats: ShellChat[]; availablePoints: number }) {
  async function leave() { "use server"; await signOut({ redirectTo: "/" }); }
  return (
    <aside className="app-sidebar">
      <Link href="/" className="brand"><span className="brand-mark">A</span><span>APPLICATION<br />SIGNAL</span></Link>
      <SidebarNavigation availablePoints={availablePoints} />
      <div className="sidebar-section"><div className="sidebar-heading"><span>Conversations</span><Link href="/chat/new" aria-label="New analysis"><FilePlus2 size={14} /></Link></div><ChatHistory chats={chats.slice(0, 8).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))} /></div>
      <div className="user-block"><span className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.isDevelopmentBypass ? "Local development" : user.email}</small></span><form action={leave}><button aria-label="Sign out"><LogOut size={14} /></button></form></div>
    </aside>
  );
}
