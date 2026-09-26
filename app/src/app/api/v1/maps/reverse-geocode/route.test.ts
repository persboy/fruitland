import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { mapError } from "@/lib/server/maps/errors";
import { GET } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/maps/service", () => ({ createMapService: vi.fn() }));

const RESULT = {
  address: {
    province: "زنجان", city: "زنجان", district: null, neighborhood: null, street: null,
    alley: null, plaque: null, unit: null, postalCode: null,
    formattedAddress: "زنجان", coordinates: { latitude: 36.6769, longitude: 48.4963 },
  },
  meta: { provider: "neshan", providerPlaceId: null, resolvedAt: "2026-01-01T00:00:00.000Z" },
};

const get = (query: string) => GET(new NextRequest(`http://localhost/api/v1/maps/reverse-geocode${query}`));

describe("GET /api/v1/maps/reverse-geocode", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let createMapService: ReturnType<typeof vi.fn>;
  let reverseGeocode: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ createMapService } = (await import("@/lib/server/maps/service")) as unknown as { createMapService: typeof createMapService });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    reverseGeocode = vi.fn().mockResolvedValue(RESULT);
    createMapService.mockReturnValue({ reverseGeocode });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication before doing anything else", async () => {
    requireAuth.mockImplementation(() => {
      throw AppError.unauthorized("لازم است وارد حساب کاربری خود شوید", "UNAUTHENTICATED");
    });
    const res = await get("?lat=36.6769&lng=48.4963");
    expect(res.status).toBe(401);
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  describe("validation", () => {
    it("rejects a missing lat/lng", async () => {
      const res = await get("");
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(createMapService).not.toHaveBeenCalled();
    });

    it("rejects an out-of-range latitude", async () => {
      const res = await get("?lat=999&lng=48.4963");
      expect(res.status).toBe(400);
      expect(createMapService).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric lat", async () => {
      const res = await get("?lat=abc&lng=48.4963");
      expect(res.status).toBe(400);
    });

    it("rejects an unknown provider", async () => {
      const res = await get("?lat=36.6769&lng=48.4963&provider=bing");
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(createMapService).not.toHaveBeenCalled();
    });
  });

  describe("success and provider selection", () => {
    it("calls the default provider (no override) and returns the normalized result", async () => {
      const res = await get("?lat=36.6769&lng=48.4963");
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, data: RESULT, message: null, pagination: null, error: null });
      expect(createMapService).toHaveBeenCalledWith({ provider: undefined });
      expect(reverseGeocode).toHaveBeenCalledWith({ latitude: 36.6769, longitude: 48.4963 });
    });

    it("passes an explicit provider straight through to MapService", async () => {
      await get("?lat=36.6769&lng=48.4963&provider=google");
      expect(createMapService).toHaveBeenCalledWith({ provider: "google" });
    });
  });

  describe("error mapping (MapProviderError → HTTP status)", () => {
    it.each([
      ["INVALID_REQUEST", 400, "MAP_INVALID_REQUEST"],
      ["UNSUPPORTED_OPERATION", 400, "MAP_UNSUPPORTED_OPERATION"],
      ["NO_RESULT", 404, "MAP_NO_RESULT"],
      ["RATE_LIMIT", 429, "MAP_PROVIDER_RATE_LIMIT"],
      ["AUTH_FAILED", 502, "MAP_PROVIDER_AUTH_FAILED"],
      ["NETWORK", 502, "MAP_PROVIDER_NETWORK_ERROR"],
      ["INVALID_RESPONSE", 502, "MAP_PROVIDER_INVALID_RESPONSE"],
      ["PROVIDER_UNAVAILABLE", 502, "MAP_PROVIDER_UNAVAILABLE"],
      ["TIMEOUT", 504, "MAP_PROVIDER_TIMEOUT"],
    ] as const)("%s → HTTP %i (%s)", async (code, status, appCode) => {
      reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", code));
      const res = await get("?lat=36.6769&lng=48.4963");
      const body = await res.json();
      expect(res.status).toBe(status);
      expect(body.error.code).toBe(appCode);
    });

    it("an unexpected internal error becomes a generic 500 with no leaked detail", async () => {
      reverseGeocode.mockRejectedValue(new Error("ECONNRESET at 10.0.0.5:443"));
      const res = await get("?lat=36.6769&lng=48.4963");
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    });
  });

  describe("security", () => {
    it("never forwards the provider error's own message (which could contain sensitive detail) to the client", async () => {
      reverseGeocode.mockRejectedValue(mapError("google", "reverseGeocode", "AUTH_FAILED", "key=SECRET-ABC rejected by upstream"));
      const res = await get("?lat=36.6769&lng=48.4963");
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain("SECRET-ABC");
      expect(body.error.message).toBe("سرویس نقشه در دسترس نیست");
    });
  });
});
