import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { mapError } from "@/lib/server/maps/errors";
import { GET } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/maps/service", () => ({ createMapService: vi.fn() }));

const RESULT = [{ id: null, name: "بیمارستان ولیعصر", coordinates: { latitude: 36.6, longitude: 48.4 }, address: null, category: null, meta: { provider: "neshan", providerPlaceId: null, resolvedAt: "x" } }];
const get = (query: string) => GET(new NextRequest(`http://localhost/api/v1/maps/search${query}`));

describe("GET /api/v1/maps/search", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let createMapService: ReturnType<typeof vi.fn>;
  let searchPlaces: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ createMapService } = (await import("@/lib/server/maps/service")) as unknown as { createMapService: typeof createMapService });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    searchPlaces = vi.fn().mockResolvedValue(RESULT);
    createMapService.mockReturnValue({ searchPlaces });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
    expect((await get("?query=x")).status).toBe(401);
  });

  it("rejects a missing/empty query", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?query=  ")).status).toBe(400);
  });

  it("rejects lat given without lng (and vice versa)", async () => {
    expect((await get("?query=x&lat=36.6"))
      .status).toBe(400);
    expect((await get("?query=x&lng=48.4")).status).toBe(400);
  });

  it("rejects malformed/out-of-range near coordinates", async () => {
    expect((await get("?query=x&lat=999&lng=48.4")).status).toBe(400);
    expect((await get("?query=x&lat=abc&lng=48.4")).status).toBe(400);
  });

  it("rejects a limit outside the allowed range", async () => {
    expect((await get("?query=x&limit=0")).status).toBe(400);
    expect((await get("?query=x&limit=21")).status).toBe(400);
    expect((await get("?query=x&limit=1.5")).status).toBe(400);
  });

  it("works without a near point and returns the normalized results", async () => {
    const res = await get("?query=بیمارستان");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(RESULT);
    expect(searchPlaces).toHaveBeenCalledWith("بیمارستان", { near: undefined, limit: undefined });
  });

  it("passes near and limit through when given", async () => {
    await get("?query=بیمارستان&lat=36.6769&lng=48.4963&limit=5");
    expect(searchPlaces).toHaveBeenCalledWith("بیمارستان", { near: { latitude: 36.6769, longitude: 48.4963 }, limit: 5 });
  });

  it("honors an explicit provider", async () => {
    await get("?query=x&provider=google");
    expect(createMapService).toHaveBeenCalledWith({ provider: "google" });
  });

  it("maps a provider error", async () => {
    searchPlaces.mockRejectedValue(mapError("mapir", "searchPlaces", "UNSUPPORTED_OPERATION"));
    const res = await get("?query=x");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("MAP_UNSUPPORTED_OPERATION");
  });
});
