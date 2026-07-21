"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Pencil, Trash2, X } from "lucide-react";
import { MAX_CHAT_TITLE_LENGTH, normalizeChatTitle } from "@/lib/chat-title";

type HistoryChat = { id: string; title: string; updatedAt: Date };
type ContextMenu = { chat: HistoryChat; x: number; y: number };

/** Compact relative age for hover tooltips, e.g. "now", "10m", "3h", "1d", "1w". */
function relativeAge(date: Date): string {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return `${Math.floor(seconds / 604_800)}w`;
}

export function ChatHistory({ chats }: { chats: HistoryChat[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState(chats);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<HistoryChat | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryChat | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setItems(chats), [chats]);

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

  function openMenu(chat: HistoryChat, x: number, y: number) {
    const menuWidth = 174;
    const menuHeight = 82;
    setMenu({
      chat,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    });
  }

  function beginRename(chat: HistoryChat) {
    setMenu(null);
    setRenameTarget(chat);
    setTitleDraft(chat.title);
    setRenameError(null);
  }

  function beginDelete(chat: HistoryChat) {
    setMenu(null);
    setDeleteTarget(chat);
    setDeleteError(null);
  }

  async function saveRename(event: React.FormEvent) {
    event.preventDefault();
    if (!renameTarget) return;

    const title = normalizeChatTitle(titleDraft);
    if (!title) { setRenameError("Title cannot be empty."); return; }
    if (title === renameTarget.title) { setRenameTarget(null); return; }

    setSaving(true);
    setRenameError(null);
    try {
      const response = await fetch(`/api/chats/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const result = await response.json() as { title?: string; error?: string };
      if (!response.ok || !result.title) throw new Error(result.error ?? "Could not rename this conversation.");
      setItems((current) => current.map((chat) => chat.id === renameTarget.id ? { ...chat, title: result.title! } : chat));
      setRenameTarget(null);
      router.refresh();
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : "Could not rename this conversation.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/chats/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Could not delete this conversation.");
      }

      const deletedId = deleteTarget.id;
      setItems((current) => current.filter((chat) => chat.id !== deletedId));
      setDeleteTarget(null);
      if (pathname === `/chat/${deletedId}`) router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete this conversation.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="chat-links">
        {items.map((chat) => (
          <Link
            href={`/chat/${chat.id}`}
            key={chat.id}
            title={relativeAge(chat.updatedAt)}
            onContextMenu={(event) => { event.preventDefault(); openMenu(chat, event.clientX, event.clientY); }}
            onKeyDown={(event) => {
              if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              openMenu(chat, bounds.left + 20, bounds.top + bounds.height / 2);
            }}
            aria-haspopup="menu"
          >
            <MessageSquareText size={13} />
            <span>{chat.title}</span>
          </Link>
        ))}
        {!items.length && <p>No conversations yet.</p>}
      </div>

      {menu && (
        <div ref={menuRef} className="chat-context-menu" role="menu" aria-label={`Actions for ${menu.chat.title}`} style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" onClick={() => beginRename(menu.chat)}><Pencil size={13} /> Rename</button>
          <button type="button" role="menuitem" className="danger" onClick={() => beginDelete(menu.chat)}><Trash2 size={13} /> Delete</button>
        </div>
      )}

      {renameTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setRenameTarget(null); }}>
          <section className="chat-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-chat-title" onKeyDown={(event) => { if (event.key === "Escape" && !saving) setRenameTarget(null); }}>
            <button className="dialog-close" type="button" aria-label="Close rename dialog" onClick={() => setRenameTarget(null)} disabled={saving}><X size={15} /></button>
            <span className="section-index">Conversation</span>
            <h2 id="rename-chat-title">Rename conversation</h2>
            <form onSubmit={saveRename}>
              <label htmlFor="chat-history-title">Title</label>
              <input id="chat-history-title" autoFocus maxLength={MAX_CHAT_TITLE_LENGTH} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} disabled={saving} />
              {renameError && <p className="dialog-error" role="alert">{renameError}</p>}
              <div className="dialog-actions"><button className="button-ghost" type="button" onClick={() => setRenameTarget(null)} disabled={saving}>Cancel</button><button className="button-dark" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></div>
            </form>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null); }}>
          <section className="chat-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-chat-title" aria-describedby="delete-chat-description" onKeyDown={(event) => { if (event.key === "Escape" && !deleting) setDeleteTarget(null); }}>
            <button className="dialog-close" type="button" aria-label="Close delete confirmation" onClick={() => setDeleteTarget(null)} disabled={deleting}><X size={15} /></button>
            <span className="section-index danger-text">Permanent action</span>
            <h2 id="delete-chat-title">Delete conversation?</h2>
            <p id="delete-chat-description">“{deleteTarget.title}”, its messages, reports, and stored PDFs will be permanently deleted. This cannot be undone.</p>
            {deleteError && <p className="dialog-error" role="alert">{deleteError}</p>}
            <div className="dialog-actions"><button className="button-ghost" type="button" autoFocus onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button><button className="button-danger" type="button" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete conversation"}</button></div>
          </section>
        </div>
      )}
    </>
  );
}
