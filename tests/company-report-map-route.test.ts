import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ failCompanyResearchReport: vi.fn(), getCompanyResearchReport: vi.fn() }));

import { DELETE, GET } from "@/app/api/company-reports/[reportId]/map-input/route";
import { getCurrentUser } from "@/lib/auth";
import { failCompanyResearchReport, getCompanyResearchReport } from "@/lib/db/repository";

const context = { params: Promise.resolve({ reportId: "5d8f157e-802b-4b51-8f9c-4943863c0dc9" }) };

describe("company report map input route", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires authentication", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(new Request("https://example.test"), context)).status).toBe(401);
  });

  it("returns 404 outside the owner's available mapping state", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "owner", email: "owner@example.com", name: "Owner", roles: [] });
    vi.mocked(getCompanyResearchReport).mockResolvedValue(null as never);
    expect((await GET(new Request("https://example.test"), context)).status).toBe(404);
  });

  it("returns only the owner's temporary browser map input", async () => {
    const mapInput = { reportId: "5d8f157e-802b-4b51-8f9c-4943863c0dc9", targets: [{ companyId: 42, semanticText: "Payments infrastructure", textSource: "firecrawl" }] };
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "owner", email: "owner@example.com", name: "Owner", roles: [] });
    vi.mocked(getCompanyResearchReport).mockResolvedValue({ status: "mapping", mapInput } as never);
    const response = await GET(new Request("https://example.test"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(mapInput);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getCompanyResearchReport).toHaveBeenCalledWith("owner", "5d8f157e-802b-4b51-8f9c-4943863c0dc9");
  });

  it("clears temporary input when browser mapping fails", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "owner", email: "owner@example.com", name: "Owner", roles: [] });
    vi.mocked(getCompanyResearchReport).mockResolvedValue({ status: "mapping" } as never);
    const response = await DELETE(new Request("https://example.test", { method: "DELETE" }), context);
    expect(response.status).toBe(204);
    expect(failCompanyResearchReport).toHaveBeenCalledWith("5d8f157e-802b-4b51-8f9c-4943863c0dc9", "owner", "COMPANY_CLUSTER_MAP_FAILED");
  });
});
