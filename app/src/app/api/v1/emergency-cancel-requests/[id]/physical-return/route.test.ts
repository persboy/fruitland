import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/emergencyCancelService", () => ({ recordPhysicalReturn: vi.fn() }));

const REQ_ID = "64b7f0c2a1b2c3d4e5f60719";
const DTO = {
  id: REQ_ID,
  deliveryRunId: "r1",
  requestedByCourierId: "c1",
  reason: "r",
  status: "approved",
  requestedAt: "2026-01-01T00:00:00.000Z",
  reviewedByAdminUserId: "a1",
  reviewedAt: "2026-01-01T00:05:00.000Z",
  rejectionReason: null,
  replacementOrderIds: ["o2"],
  physicalReturn: { returned: true, recordedByAdminUserId: "a1", recordedAt: "2026-01-02T00:00:00.000Z" },
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/v1/emergency-cancel-requests/${id}/physical-return`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

describe("POST /api/v1/emergency-cancel-requests/[id]/physical-return", () => {
  let requireAdmin: ReturnType<typeof vi.fn>;
  let recordPhysicalReturn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAdmin } = (await import("@/lib/server/auth/guard")) as unknown as { requireAdmin: typeof requireAdmin });
    ({ recordPhysicalReturn } = (await import("@/lib/server/services/emergencyCancelService")) as unknown as {
      recordPhysicalReturn: typeof recordPhysicalReturn;
    });
    requireAdmin.mockReturnValue({ userId: "a1", role: "admin" });
    recordPhysicalReturn.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  it("requires admin authentication", async () => {
    requireAdmin.mockImplementation(() => {
      throw AppError.unauthorized("x", "UNAUTHENTICATED");
    });
    expect((await post(REQ_ID, { returned: true })).status).toBe(401);
    expect(recordPhysicalReturn).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean 'returned'", async () => {
    const res = await post(REQ_ID, { returned: "yes" });
    expect(res.status).toBe(400);
    expect(recordPhysicalReturn).not.toHaveBeenCalled();
  });

  it("records returned=true", async () => {
    const res = await post(REQ_ID, { returned: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(DTO);
    expect(recordPhysicalReturn).toHaveBeenCalledWith({ userId: "a1", role: "admin" }, REQ_ID, true);
  });

  it("surfaces a not-approved-yet conflict from the service", async () => {
    recordPhysicalReturn.mockRejectedValue(AppError.conflict("x", "EMERGENCY_CANCEL_NOT_APPROVED"));
    const res = await post(REQ_ID, { returned: false });
    expect(res.status).toBe(409);
  });
});
