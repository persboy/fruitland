import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { GET } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/emergencyCancelService", () => ({ getEmergencyCancelRequest: vi.fn() }));

const REQ_ID = "64b7f0c2a1b2c3d4e5f60719";
const DTO = {
  id: REQ_ID,
  deliveryRunId: "r1",
  requestedByCourierId: "c1",
  reason: "پیک تصادف کرد",
  status: "pending",
  requestedAt: "2026-01-01T00:00:00.000Z",
  reviewedByAdminUserId: null,
  reviewedAt: null,
  rejectionReason: null,
  replacementOrderIds: [],
  physicalReturn: null,
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new NextRequest(`http://localhost/api/v1/emergency-cancel-requests/${id}`), ctx(id));

describe("GET /api/v1/emergency-cancel-requests/[id]", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let getEmergencyCancelRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ getEmergencyCancelRequest } = (await import("@/lib/server/services/emergencyCancelService")) as unknown as {
      getEmergencyCancelRequest: typeof getEmergencyCancelRequest;
    });
    requireAuth.mockReturnValue({ userId: "a1", role: "admin" });
    getEmergencyCancelRequest.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    requireAuth.mockImplementation(() => {
      throw AppError.unauthorized("x", "UNAUTHENTICATED");
    });
    expect((await get(REQ_ID)).status).toBe(401);
    expect(getEmergencyCancelRequest).not.toHaveBeenCalled();
  });

  it("returns the request for an admin", async () => {
    const res = await get(REQ_ID);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(DTO);
  });

  it("another courier's request (or a nonexistent one) is a 404, via the service's ownership check", async () => {
    requireAuth.mockReturnValue({ userId: "other-courier", role: "courier" });
    getEmergencyCancelRequest.mockRejectedValue(AppError.notFound("درخواست یافت نشد", "EMERGENCY_CANCEL_REQUEST_NOT_FOUND"));
    const res = await get(REQ_ID);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("EMERGENCY_CANCEL_REQUEST_NOT_FOUND");
  });
});
