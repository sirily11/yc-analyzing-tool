import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/research/report-research", () => ({ reportResearchProgress: vi.fn() }));

import { getCurrentUser } from "@/lib/auth";
import { reportResearchProgress } from "@/lib/research/report-research";
import * as statusRoute from "@/app/api/reports/[reportId]/status/route";

describe("application report status route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves private no-store progress through a read-only GET", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(reportResearchProgress).mockResolvedValue({
      reportId: "report-1",
      status: "researching",
      jobs: { total: 5, running: 4, complete: 1, failed: 0 },
    } as never);

    const response = await statusRoute.GET(new Request("https://app.example/api/reports/report-1/status"), {
      params: Promise.resolve({ reportId: "report-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(reportResearchProgress).toHaveBeenCalledWith("user-1", "report-1");
    expect(await response.json()).toMatchObject({ status: "researching", jobs: { total: 5, complete: 1 } });
    expect((statusRoute as Record<string, unknown>).POST).toBeUndefined();
  });
});
