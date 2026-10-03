import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/emergencyCancelService", () => ({ reviewEmergencyCancelRequest: vi.fn() }));

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
  physicalReturn: null,
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/v1/emergency-cancel-requests/${id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

describe("POST /api/v1/emergency-cancel-requests/[id]/review", () => {
  let requireAdmin: ReturnType<typeof vi.fn>;
  let reviewEmergencyCancelRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAdmin } = (await import("@/lib/server/auth/guard")) as unknown as { requireAdmin: typeof requireAdmin });
    ({ reviewEmergencyCancelRequest } = (await import("@/lib/server/services/emergencyCancelService")) as unknown as {
      reviewEmergencyCancelRequest: typeof reviewEmergencyCancelRequest;
    });
    requireAdmin.mockReturnValue({ userId: "a1", role: "admin" });
    reviewEmergencyCancelRequest.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  it("requires admin authentication", async () => {
    requireAdmin.mockImplementation(() => {
      throw AppError.unauthorized("x", "UNAUTHENTICATED");
    });
    expect((await post(REQ_ID, { decision: "approve" })).status).toBe(401);
    expect(reviewEmergencyCancelRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid decision value before calling the service", async () => {
    const res = await post(REQ_ID, { decision: "maybe" });
    expect(res.status).toBe(400);
    expect(reviewEmergencyCancelRequest).not.toHaveBeenCalled();
  });

  it("requires a rejection reason when rejecting", async () => {
    const res = await post(REQ_ID, { decision: "reject" });
    expect(res.status).toBe(400);
    expect(reviewEmergencyCancelRequest).not.toHaveBeenCalled();
  });

  it("approves without needing a rejection reason", async () => {
    const res = await post(REQ_ID, { decision: "approve" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(DTO);
    expect(reviewEmergencyCancelRequest).toHaveBeenCalledWith({ userId: "a1", role: "admin" }, REQ_ID, "approve", undefined);
  });

  it("rejects with a reason", async () => {
    const res = await post(REQ_ID, { decision: "reject", rejectionReason: "مشکل حل شد" });
    expect(res.status).toBe(200);
    expect(reviewEmergencyCancelRequest).toHaveBeenCalledWith({ userId: "a1", role: "admin" }, REQ_ID, "reject", "مشکل حل شد");
  });

  it("a non-admin is rejected before the service is ever called", async () => {
    requireAdmin.mockImplementation(() => {
      throw AppError.forbidden("x", "FORBIDDEN_ROLE");
    });
    const res = await post(REQ_ID, { decision: "approve" });
    expect(res.status).toBe(403);
    expect(reviewEmergencyCancelRequest).not.toHaveBeenCalled();
  });

  it("an environment-limitation error (no replica set) surfaces as a generic 500, not a leaked internal", async () => {
    reviewEmergencyCancelRequest.mockRejectedValue(new Error("needs a replica set"));
    const res = await post(REQ_ID, { decision: "approve" });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
