import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createTopupCheckout } from "@/lib/billing/stripe";

const requestSchema = z.object({ packId: z.string().min(1).max(40) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid credit pack" }, { status: 400 });
  try {
    const result = await createTopupCheckout(user, input.data.packId);
    return Response.json({ url: result.checkoutUrl }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "CHECKOUT_FAILED";
    const status = code === "INVALID_CREDIT_PACK" ? 400 : code === "BILLING_NOT_ENABLED" ? 503 : 500;
    console.error("Stripe Checkout creation failed", { code });
    return Response.json({ error: status === 503 ? "Credit purchases are not available yet" : "Checkout could not be created" }, { status });
  }
}

