import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { authStatus, getCurrentUser, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  async function authenticate() {
    "use server";
    await signIn("rxlab", { redirectTo: "/dashboard" });
  }

  return (
    <main className="auth-page">
      <section className="auth-art">
        <Link className="brand" href="/"><span className="brand-mark">A</span><span>APPLICATION SIGNAL</span></Link>
        <h1>Private analysis. Public context.</h1>
        <p className="mono-label">Independent YC directory analysis · Owner-scoped document storage</p>
      </section>
      <section className="auth-card">
        <p className="eyebrow">Founder workspace</p>
        <h2>Sign in to analyze.</h2>
        <p>Your chats and reports are private to your RxLab identity. Uploaded PDFs are retained in configured S3 storage so restored approvals can continue.</p>
        {!authStatus.configured && <div className="notice"><strong>Authentication is not configured.</strong><br />Add the RxLab OIDC values from <code>.env.example</code>. For local-only development, set <code>DEV_BYPASS_AUTH=true</code>.</div>}
        <form action={authenticate}><button className="button-dark" type="submit" disabled={!authStatus.configured}><LockKeyhole size={16} /> Continue with RxLab <ArrowRight size={16} /></button></form>
        <Link href="/" style={{ marginTop: 24, color: "var(--muted)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}><ArrowLeft size={14} /> Return to the public map</Link>
      </section>
    </main>
  );
}
