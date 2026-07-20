import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db/repository", () => ({ deleteCompanyResearchReport: vi.fn(), deleteReport: vi.fn() }));

import { DELETE as deleteApplicationReport } from "@/app/api/reports/[reportId]/route";
import { DELETE as deleteCompanyReport } from "@/app/api/company-reports/[reportId]/route";
import { getCurrentUser } from "@/lib/auth";
import { deleteCompanyResearchReport, deleteReport } from "@/lib/db/repository";

const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedDeleteReport = vi.mocked(deleteReport);
const mockedDeleteCompanyReport = vi.mocked(deleteCompanyResearchReport);
const user = { id: "user-1", name: "Founder", email: "founder@example.com", roles: [] };

describe("report DELETE routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication before deleting either report kind", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    const applicationResponse = await deleteApplicationReport(new Request("http://localhost/api/reports/report-1", { method: "DELETE" }), { params: Promise.resolve({ reportId: "report-1" }) });
    const companyResponse = await deleteCompanyReport(new Request("http://localhost/api/company-reports/report-2", { method: "DELETE" }), { params: Promise.resolve({ reportId: "report-2" }) });

    expect(applicationResponse.status).toBe(401);
    expect(companyResponse.status).toBe(401);
    expect(mockedDeleteReport).not.toHaveBeenCalled();
    expect(mockedDeleteCompanyReport).not.toHaveBeenCalled();
  });

  it("deletes application reports only through the authenticated user's scope", async () => {
    mockedGetCurrentUser.mockResolvedValue(user);
    mockedDeleteReport.mockResolvedValue({ id: "report-1" });

    const response = await deleteApplicationReport(new Request("http://localhost/api/reports/report-1", { method: "DELETE" }), { params: Promise.resolve({ reportId: "report-1" }) });

    expect(response.status).toBe(204);
    expect(mockedDeleteReport).toHaveBeenCalledWith("user-1", "report-1");
  });

  it("deletes company reports only through the authenticated user's scope", async () => {
    mockedGetCurrentUser.mockResolvedValue(user);
    mockedDeleteCompanyReport.mockResolvedValue({ id: "report-2" });

    const response = await deleteCompanyReport(new Request("http://localhost/api/company-reports/report-2", { method: "DELETE" }), { params: Promise.resolve({ reportId: "report-2" }) });

    expect(response.status).toBe(204);
    expect(mockedDeleteCompanyReport).toHaveBeenCalledWith("user-1", "report-2");
  });

  it("does not reveal reports outside the user's scope", async () => {
    mockedGetCurrentUser.mockResolvedValue(user);
    mockedDeleteReport.mockResolvedValue(null);

    const response = await deleteApplicationReport(new Request("http://localhost/api/reports/other-report", { method: "DELETE" }), { params: Promise.resolve({ reportId: "other-report" }) });

    expect(response.status).toBe(404);
  });
});

