import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/emergencyCancelService", () => ({ requestEmergencyCancel: vi.fn() }));

const RUN_ID = "64b7f0c2a1b2c3d4e5f60718";
const DTO = {
  id: "64b7f0c2a1b2c3d4e5f60719",
  deliveryRunId: RUN_ID,
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
const post = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/v1/delivery-runs/${id}/emergency-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

describe("POST /api/v1/delivery-runs/[id]/emergency-cancel", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let requestEmergencyCancel: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ requestEmergencyCancel } = (await import("@/lib/server/services/emergencyCancelService")) as unknown as {
      requestEmergencyCancel: typeof requestEmergencyCancel;
    });
    requireAuth.mockReturnValue({ userId: "c1", role: "courier" });
    requestEmergencyCancel.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    requireAuth.mockImplementation(() => {
      throw AppError.unauthorized("x", "UNAUTHENTICATED");
    });
    expect((await post(RUN_ID, { reason: "x" })).status).toBe(401);
    expect(requestEmergencyCancel).not.toHaveBeenCalled();
  });

  it("rejects an empty reason before calling the service", async () => {
    const res = await post(RUN_ID, { reason: "   " });
    expect(res.status).toBe(400);
    expect(requestEmergencyCancel).not.toHaveBeenCalled();
  });

  it("creates the request and returns 201", async () => {
    const res = await post(RUN_ID, { reason: "پیک تصادف کرد" });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toEqual(DTO);
    expect(requestEmergencyCancel).toHaveBeenCalledWith({ userId: "c1", role: "courier" }, RUN_ID, "پیک تصادف کرد");
  });

  it("another courier's run is passed straight through as the service's 404", async () => {
    requestEmergencyCancel.mockRejectedValue(AppError.notFound("ماموریت یافت نشد", "DELIVERY_RUN_NOT_FOUND"));
    const res = await post(RUN_ID, { reason: "x" });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("DELIVERY_RUN_NOT_FOUND");
  });

  it("a non-courier role is rejected by the service, not the route", async () => {
    requireAuth.mockReturnValue({ userId: "a1", role: "admin" });
    requestEmergencyCancel.mockRejectedValue(AppError.forbidden("x", "FORBIDDEN_ROLE"));
    const res = await post(RUN_ID, { reason: "x" });
    expect(res.status).toBe(403);
  });
});
