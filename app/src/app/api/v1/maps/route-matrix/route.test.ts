import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/maps/service", () => ({ createMapService: vi.fn() }));

const p1 = { latitude: 36.6769, longitude: 48.4963 };
const p2 = { latitude: 36.68, longitude: 48.5 };
const RESULT = { rows: [[{ distanceMeters: 100, durationSeconds: 10 }]], meta: { provider: "google", providerPlaceId: null, resolvedAt: "x" } };

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/v1/maps/route-matrix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/v1/maps/route-matrix", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let createMapService: ReturnType<typeof vi.fn>;
  let getRouteMatrix: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ createMapService } = (await import("@/lib/server/maps/service")) as unknown as { createMapService: typeof createMapService });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    getRouteMatrix = vi.fn().mockResolvedValue(RESULT);
    createMapService.mockReturnValue({ getRouteMatrix });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
    expect((await post({ origins: [p1], destinations: [p2] })).status).toBe(401);
  });

  it("rejects empty origins/destinations", async () => {
    expect((await post({ origins: [], destinations: [p2] })).status).toBe(400);
    expect((await post({ origins: [p1], destinations: [] })).status).toBe(400);
  });

  it("rejects more than 25 points on either side", async () => {
    const many = Array.from({ length: 26 }, () => p1);
    expect((await post({ origins: many, destinations: [p2] })).status).toBe(400);
  });

  it("rejects an invalid point inside the array", async () => {
    expect((await post({ origins: [p1, { latitude: 999, longitude: 0 }], destinations: [p2] })).status).toBe(400);
  });

  it("returns the normalized matrix for the default provider", async () => {
    const res = await post({ origins: [p1], destinations: [p2] });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(RESULT);
    expect(getRouteMatrix).toHaveBeenCalledWith([p1], [p2]);
  });

  it("honors an explicit provider", async () => {
    await post({ origins: [p1], destinations: [p2], provider: "google" });
    expect(createMapService).toHaveBeenCalledWith({ provider: "google" });
  });

  it("maps UNSUPPORTED_OPERATION (e.g. Neshan/Map.ir lack route matrix) to 400", async () => {
    const { mapError } = await import("@/lib/server/maps/errors");
    getRouteMatrix.mockRejectedValue(mapError("neshan", "getRouteMatrix", "UNSUPPORTED_OPERATION"));
    const res = await post({ origins: [p1], destinations: [p2] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("MAP_UNSUPPORTED_OPERATION");
  });
});
