import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { PublicExplorer } from "@/components/public-explorer";
import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <main className="site-shell">
      <SiteHeader />
      <PublicExplorer />
      <section className="methodology" id="methodology">
        <div><p className="eyebrow">How to read this</p><h2>Each dot is a company. Every score is a comparison—not a verdict.</h2></div>
        <div className="methodology-copy">
          <p>Industry, batch, location, and descriptions come from public YC directory records. Target market and AI linkage are transparent rule-based inferences used to make the map easier to explore.</p>
          <p>The public directory covers companies from 2020 through the current year. The active fit model remains separately versioned, so search updates never silently change an existing score. This is an independent research tool, not an official YC product, acceptance probability, or investment recommendation.</p>
        </div>
      </section>
      <section className="cta-band"><div><h2>Bring your plan into the map.</h2><p>Sign in, upload a selectable-text PDF, approve the analysis, and receive a private visual report with practical improvements.</p></div><Link className="button-primary" href="/login">Start an analysis <ArrowRight size={16} /></Link></section>
      <section className="contact-band" id="contact">
        <div>
          <p className="eyebrow">Contact us</p>
          <h2>Found an issue?</h2>
        </div>
        <div className="contact-copy">
          <p>Send us a note and we’ll help you sort it out.</p>
          <a href="mailto:support@rxlab.app?subject=Issue">
            <Mail size={17} aria-hidden="true" />
            support@rxlab.app
          </a>
        </div>
      </section>
      <footer className="footer"><span>Application Signal · Independent directory analysis</span><span>Source: YC public directory mirror · Synced from Turso</span></footer>
    </main>
  );
}
