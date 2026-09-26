import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { mapError } from "@/lib/server/maps/errors";
import { GET } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/maps/service", () => ({ createMapService: vi.fn() }));

const RESULT = [{ coordinates: { latitude: 36.6, longitude: 48.4 }, formattedAddress: "زنجان", address: null, meta: { provider: "google", providerPlaceId: null, resolvedAt: "x" } }];
const get = (query: string) => GET(new NextRequest(`http://localhost/api/v1/maps/geocode${query}`));

describe("GET /api/v1/maps/geocode", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let createMapService: ReturnType<typeof vi.fn>;
  let geocode: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ createMapService } = (await import("@/lib/server/maps/service")) as unknown as { createMapService: typeof createMapService });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    geocode = vi.fn().mockResolvedValue(RESULT);
    createMapService.mockReturnValue({ geocode });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
    expect((await get("?address=زنجان")).status).toBe(401);
    expect(geocode).not.toHaveBeenCalled();
  });

  it("rejects a missing/empty address", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?address=")).status).toBe(400);
    expect(createMapService).not.toHaveBeenCalled();
  });

  it("rejects an unknown provider", async () => {
    expect((await get("?address=زنجان&provider=osm")).status).toBe(400);
  });

  it("returns the normalized results for the default provider", async () => {
    const res = await get("?address=زنجان");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(RESULT);
    expect(createMapService).toHaveBeenCalledWith({ provider: undefined });
    expect(geocode).toHaveBeenCalledWith("زنجان");
  });

  it("honors an explicit provider", async () => {
    await get("?address=زنجان&provider=neshan");
    expect(createMapService).toHaveBeenCalledWith({ provider: "neshan" });
  });

  it("maps a provider error and never leaks its raw message", async () => {
    geocode.mockRejectedValue(mapError("neshan", "geocode", "UNSUPPORTED_OPERATION", "internal detail: key=SECRET"));
    const res = await get("?address=زنجان");
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("MAP_UNSUPPORTED_OPERATION");
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
});
