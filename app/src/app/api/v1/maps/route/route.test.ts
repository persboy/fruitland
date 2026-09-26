import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { mapError } from "@/lib/server/maps/errors";
import { POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/maps/service", () => ({ createMapService: vi.fn() }));

const origin = { latitude: 36.6769, longitude: 48.4963 };
const destination = { latitude: 36.68, longitude: 48.5 };
const RESULT = { distanceMeters: 4200, durationSeconds: 780, origin, destination, geometry: null, meta: { provider: "neshan", providerPlaceId: null, resolvedAt: "x" } };

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/v1/maps/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/v1/maps/route", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let createMapService: ReturnType<typeof vi.fn>;
  let getRoute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ createMapService } = (await import("@/lib/server/maps/service")) as unknown as { createMapService: typeof createMapService });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    getRoute = vi.fn().mockResolvedValue(RESULT);
    createMapService.mockReturnValue({ getRoute });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
    expect((await post({ origin, destination })).status).toBe(401);
  });

  it("rejects missing origin/destination", async () => {
    expect((await post({ origin })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it("rejects out-of-range coordinates", async () => {
    expect((await post({ origin: { latitude: 999, longitude: 0 }, destination })).status).toBe(400);
  });

  it("rejects an invalid vehicleType", async () => {
    expect((await post({ origin, destination, vehicleType: "spaceship" })).status).toBe(400);
    expect(createMapService).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean includeGeometry (malformed route options)", async () => {
    expect((await post({ origin, destination, includeGeometry: "yes" })).status).toBe(400);
  });

  it("accepts every documented vehicleType and passes it through", async () => {
    for (const vehicleType of ["car", "motorcycle", "bicycle"] as const) {
      getRoute.mockClear();
      await post({ origin, destination, vehicleType });
      expect(getRoute).toHaveBeenCalledWith(origin, destination, { vehicleType, includeGeometry: undefined });
    }
  });

  it("returns the normalized route for the default provider", async () => {
    const res = await post({ origin, destination });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(RESULT);
    expect(createMapService).toHaveBeenCalledWith({ provider: undefined });
  });

  it("honors an explicit provider", async () => {
    await post({ origin, destination, provider: "google" });
    expect(createMapService).toHaveBeenCalledWith({ provider: "google" });
  });

  it("maps a retryable-provider-failure-after-exhaustion error (PROVIDER_UNAVAILABLE) to 502", async () => {
    getRoute.mockRejectedValue(mapError("neshan", "getRoute", "PROVIDER_UNAVAILABLE"));
    const res = await post({ origin, destination });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("MAP_PROVIDER_UNAVAILABLE");
  });

  it("rejects malformed JSON body", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/maps/route", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }));
    expect(res.status).toBe(400);
  });
});
