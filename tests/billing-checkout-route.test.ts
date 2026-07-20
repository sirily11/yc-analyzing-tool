import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ createTopupCheckout: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { createTopupCheckout } from "@/lib/billing/stripe";
import { POST } from "@/app/api/billing/checkout/route";

describe("POST /api/billing/checkout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ packId: "points_1000" }) }));
    expect(response.status).toBe(401);
  });

  it("passes only the authenticated user and server pack identifier to checkout", async () => {
    const user = { id: "user-1", name: "Founder", email: "founder@example.com", roles: [] };
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(createTopupCheckout).mockResolvedValue({ topupId: "topup-1", checkoutUrl: "https://checkout.stripe.com/test" });
    const response = await POST(new Request("http://localhost/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId: "points_1000", amountCents: 1 }),
    }));
    expect(response.status).toBe(201);
    expect(createTopupCheckout).toHaveBeenCalledWith(user, "points_1000");
    await expect(response.json()).resolves.toEqual({ url: "https://checkout.stripe.com/test" });
  });
});

