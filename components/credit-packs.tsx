"use client";

import { useState } from "react";

type CreditPack = { id: string; points: number; amountCents: number };

export function CreditPacks({ packs, enabled }: { packs: CreditPack[]; enabled: boolean }) {
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function checkout(packId: string) {
    setPendingPack(packId);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Checkout could not be created");
      window.location.assign(body.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be created");
      setPendingPack(null);
    }
  }

  return (
    <div>
      <div className="credit-pack-grid">
        {packs.map((pack) => (
          <article className="credit-pack-card" key={pack.id}>
            <span className="eyebrow">Prepaid credits</span>
            <strong>{pack.points.toLocaleString("en-US")}</strong>
            <p>points</p>
            <div className="credit-pack-price">${(pack.amountCents / 100).toFixed(2)} USD</div>
            <button className="button-dark" type="button" disabled={!enabled || pendingPack !== null} onClick={() => checkout(pack.id)}>
              {pendingPack === pack.id ? "Opening checkout…" : enabled ? "Buy points" : "Purchases unavailable"}
            </button>
          </article>
        ))}
      </div>
      {error ? <p className="credits-error" role="alert">{error}</p> : null}
    </div>
  );
}

