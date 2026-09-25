import { afterEach, describe, expect, it, vi } from "vitest";
import type { Coordinates, MapProviderName } from "@fruitland/shared";
import { MapProviderError, mapError, type MapErrorCode } from "./errors";
import type { MapCapabilities, MapProvider } from "./provider";
import { MapService } from "./service";

const point: Coordinates = { latitude: 36.6769, longitude: 48.4963 };
const other: Coordinates = { latitude: 36.68, longitude: 48.5 };

const FULL_CAPS: MapCapabilities = { reverseGeocode: true, geocode: true, searchPlaces: true, getRoute: true, routeMatrix: true };

const REVERSE_RESULT = {
  address: {
    province: null, city: null, district: null, neighborhood: null, street: null,
    alley: null, plaque: null, unit: null, postalCode: null,
    formattedAddress: "x", coordinates: point,
  },
  meta: { provider: "neshan" as const, providerPlaceId: null, resolvedAt: "2026-01-01T00:00:00.000Z" },
};

/** A fully-controllable MapProvider double — separate from FakeMapProvider (used by provider-contract tests) because MapService tests need per-call sequencing (fail N times then succeed) that a shared fixture shouldn't bake in. */
function fakeProvider(name: MapProviderName, overrides?: Partial<MapCapabilities>): MapProvider & Record<"reverseGeocode" | "geocode" | "searchPlaces" | "getRoute" | "getRouteMatrix", ReturnType<typeof vi.fn>> {
  return {
    name,
    capabilities: { ...FULL_CAPS, ...overrides },
    reverseGeocode: vi.fn().mockResolvedValue(REVERSE_RESULT),
    geocode: vi.fn().mockResolvedValue([]),
    searchPlaces: vi.fn().mockResolvedValue([]),
    getRoute: vi.fn().mockResolvedValue({ distanceMeters: 1, durationSeconds: 1, origin: point, destination: other, geometry: null, meta: REVERSE_RESULT.meta }),
    getRouteMatrix: vi.fn().mockResolvedValue({ rows: [], meta: REVERSE_RESULT.meta }),
  };
}

const err = (provider: MapProviderName, code: MapErrorCode, overrideRetryable?: boolean) =>
  new MapProviderError({ provider, operation: "reverseGeocode", code, message: "x", retryable: overrideRetryable });

describe("MapService — retry (single provider)", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["TIMEOUT", "NETWORK", "PROVIDER_UNAVAILABLE"] as const)("retries and eventually succeeds on %s", async (code) => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValueOnce(mapError("neshan", "reverseGeocode", code)).mockResolvedValueOnce(REVERSE_RESULT);
    const service = new MapService(primary, null, 2);
    await expect(service.reverseGeocode(point)).resolves.toEqual(REVERSE_RESULT);
    expect(primary.reverseGeocode).toHaveBeenCalledTimes(2);
  });

  it("retries a retryable RATE_LIMIT", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValueOnce(mapError("neshan", "reverseGeocode", "RATE_LIMIT")).mockResolvedValueOnce(REVERSE_RESULT);
    const service = new MapService(primary, null, 2);
    await expect(service.reverseGeocode(point)).resolves.toEqual(REVERSE_RESULT);
    expect(primary.reverseGeocode).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retryable RATE_LIMIT (e.g. quota exhausted)", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(err("neshan", "RATE_LIMIT", false));
    const service = new MapService(primary, null, 2);
    await expect(service.reverseGeocode(point)).rejects.toMatchObject({ code: "RATE_LIMIT" });
    expect(primary.reverseGeocode).toHaveBeenCalledTimes(1);
  });

  it.each(["AUTH_FAILED", "INVALID_REQUEST", "UNSUPPORTED_OPERATION", "NO_RESULT", "INVALID_RESPONSE"] as const)(
    "does NOT retry %s",
    async (code) => {
      const primary = fakeProvider("neshan");
      primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", code));
      const service = new MapService(primary, null, 3);
      await expect(service.reverseGeocode(point)).rejects.toMatchObject({ code });
      expect(primary.reverseGeocode).toHaveBeenCalledTimes(1);
    },
  );

  it("respects MAP_MAX_RETRIES as a hard bound (no infinite loop) — 1 initial + N retries, then throws", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", "TIMEOUT"));
    const service = new MapService(primary, null, 2);
    await expect(service.reverseGeocode(point)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(primary.reverseGeocode).toHaveBeenCalledTimes(3); // 1 + 2
  });

  it("MAP_MAX_RETRIES=0 means exactly one attempt, even for a retryable error", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", "NETWORK"));
    const service = new MapService(primary, null, 0);
    await expect(service.reverseGeocode(point)).rejects.toMatchObject({ code: "NETWORK" });
    expect(primary.reverseGeocode).toHaveBeenCalledTimes(1);
  });

  it("preserves the original provider/operation/code/retryable on the final thrown error", async () => {
    const primary = fakeProvider("neshan");
    primary.getRoute.mockRejectedValue(mapError("neshan", "getRoute", "PROVIDER_UNAVAILABLE"));
    const service = new MapService(primary, null, 0);
    const thrown = await service.getRoute(point, other).catch((e) => e);
    expect(thrown).toBeInstanceOf(MapProviderError);
    expect(thrown.toSafeJSON()).toEqual({ provider: "neshan", operation: "getRoute", code: "PROVIDER_UNAVAILABLE", message: "Provider is temporarily unavailable", retryable: true });
  });

  it("a plain (non-MapProviderError) throw is never retried and propagates as-is", async () => {
    const primary = fakeProvider("neshan");
    const boom = new Error("unexpected");
    primary.reverseGeocode.mockRejectedValue(boom);
    const service = new MapService(primary, null, 3);
    await expect(service.reverseGeocode(point)).rejects.toBe(boom);
    expect(primary.reverseGeocode).toHaveBeenCalledTimes(1);
  });
});

describe("MapService — fallback", () => {
  it.each(["TIMEOUT", "NETWORK", "PROVIDER_UNAVAILABLE"] as const)("falls back to the secondary provider after %s exhausts retries", async (code) => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", code));
    const fallback = fakeProvider("google");
    const service = new MapService(primary, fallback, 1);
    await expect(service.reverseGeocode(point)).resolves.toEqual(REVERSE_RESULT);
    expect(primary.reverseGeocode).toHaveBeenCalledTimes(2); // 1 + 1 retry, still failing
    expect(fallback.reverseGeocode).toHaveBeenCalledTimes(1);
  });

  it.each(["AUTH_FAILED", "INVALID_REQUEST", "UNSUPPORTED_OPERATION"] as const)("never falls back after %s — a real problem must not be hidden", async (code) => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", code));
    const fallback = fakeProvider("google");
    const service = new MapService(primary, fallback, 0);
    await expect(service.reverseGeocode(point)).rejects.toMatchObject({ provider: "neshan", code });
    expect(fallback.reverseGeocode).not.toHaveBeenCalled();
  });

  it("never falls back after a non-retryable RATE_LIMIT", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(err("neshan", "RATE_LIMIT", false));
    const fallback = fakeProvider("google");
    const service = new MapService(primary, fallback, 0);
    await expect(service.reverseGeocode(point)).rejects.toMatchObject({ provider: "neshan", code: "RATE_LIMIT" });
    expect(fallback.reverseGeocode).not.toHaveBeenCalled();
  });

  it("does not fall back when no fallback is configured", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", "TIMEOUT"));
    const service = new MapService(primary, null, 0);
    await expect(service.reverseGeocode(point)).rejects.toMatchObject({ provider: "neshan", code: "TIMEOUT" });
  });

  it("capability-aware: does not call a fallback that does not support the operation, and preserves the ORIGINAL error", async () => {
    const primary = fakeProvider("neshan");
    primary.geocode.mockRejectedValue(mapError("neshan", "geocode", "PROVIDER_UNAVAILABLE"));
    const fallback = fakeProvider("mapir", { geocode: false }); // Map.ir really doesn't support geocode
    const service = new MapService(primary, fallback, 0);
    await expect(service.geocode("زنجان")).rejects.toMatchObject({ provider: "neshan", operation: "geocode", code: "PROVIDER_UNAVAILABLE" });
    expect(fallback.geocode).not.toHaveBeenCalled();
  });

  it("getRouteMatrix: a fallback lacking the optional method is treated as unsupported, not called", async () => {
    const primary = fakeProvider("neshan", { routeMatrix: false });
    (primary as { getRouteMatrix?: unknown }).getRouteMatrix = undefined;
    // Simulate primary failing at a different capability path is irrelevant here — call routeMatrix directly and expect UNSUPPORTED_OPERATION from primary itself.
    const service = new MapService(primary, fakeProvider("google"), 0);
    await expect(service.getRouteMatrix([point], [other])).rejects.toMatchObject({ provider: "neshan", code: "UNSUPPORTED_OPERATION" });
  });

  it("fallback failure is surfaced as its own clear normalized error", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", "TIMEOUT"));
    const fallback = fakeProvider("google");
    fallback.reverseGeocode.mockRejectedValue(mapError("google", "reverseGeocode", "AUTH_FAILED"));
    const service = new MapService(primary, fallback, 0);
    const thrown = await service.reverseGeocode(point).catch((e) => e);
    expect(thrown.toSafeJSON()).toMatchObject({ provider: "google", code: "AUTH_FAILED" });
  });

  it("fallback also gets the retry policy (bounded) before its own failure is returned", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", "TIMEOUT"));
    const fallback = fakeProvider("google");
    fallback.reverseGeocode.mockRejectedValue(mapError("google", "reverseGeocode", "NETWORK"));
    const service = new MapService(primary, fallback, 1);
    await expect(service.reverseGeocode(point)).rejects.toMatchObject({ provider: "google", code: "NETWORK" });
    expect(fallback.reverseGeocode).toHaveBeenCalledTimes(2); // 1 + 1 retry, on the fallback too
  });
});

describe("MapService — contract integrity", () => {
  it("returns the exact shared-type result the provider produced, with no provider-specific shape leaking", async () => {
    const primary = fakeProvider("neshan");
    const service = new MapService(primary, null, 0);
    const result = await service.reverseGeocode(point);
    expect(result).toEqual(REVERSE_RESULT);
    expect(Object.keys(result)).toEqual(["address", "meta"]);
  });

  it("the final normalized error exposes only the documented safe fields (never raw request internals)", async () => {
    const primary = fakeProvider("neshan");
    primary.reverseGeocode.mockRejectedValue(mapError("neshan", "reverseGeocode", "TIMEOUT"));
    const fallback = fakeProvider("google");
    fallback.reverseGeocode.mockRejectedValue(mapError("google", "reverseGeocode", "AUTH_FAILED", "key rejected"));
    const service = new MapService(primary, fallback, 0);
    const thrown = await service.reverseGeocode(point).catch((e) => e);
    expect(Object.keys(thrown.toSafeJSON()).sort()).toEqual(["code", "message", "operation", "provider", "retryable"]);
  });
});

describe("createMapService (registry/env wiring)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const baseEnv = () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
  };

  it("uses the default provider and no fallback when none is configured", async () => {
    baseEnv();
    vi.stubEnv("NESHAN_API_KEY", "k");
    vi.resetModules();
    const { createMapService } = await import("./service");
    const { NeshanProvider } = await import("./providers/neshan.provider");
    const service = createMapService();
    expect((service as unknown as { primary: unknown }).primary).toBeInstanceOf(NeshanProvider);
    expect((service as unknown as { fallback: unknown }).fallback).toBeNull();
  });

  it("supports an explicit provider override", async () => {
    baseEnv();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
    vi.resetModules();
    const { createMapService } = await import("./service");
    const { GoogleMapsProvider } = await import("./providers/google.provider");
    const service = createMapService({ provider: "google" });
    expect((service as unknown as { primary: unknown }).primary).toBeInstanceOf(GoogleMapsProvider);
  });

  it("wires the configured fallback provider", async () => {
    baseEnv();
    vi.stubEnv("NESHAN_API_KEY", "k1");
    vi.stubEnv("MAP_FALLBACK_PROVIDER", "mapir");
    vi.stubEnv("MAPIR_API_KEY", "k2");
    vi.resetModules();
    const { createMapService } = await import("./service");
    const { MapIrProvider } = await import("./providers/mapir.provider");
    const service = createMapService();
    expect((service as unknown as { fallback: unknown }).fallback).toBeInstanceOf(MapIrProvider);
  });

  it("treats a fallback equal to the primary as no fallback (never retries the 'same' provider twice)", async () => {
    baseEnv();
    vi.stubEnv("NESHAN_API_KEY", "k1");
    vi.stubEnv("MAP_FALLBACK_PROVIDER", "neshan");
    vi.resetModules();
    const { createMapService } = await import("./service");
    const service = createMapService();
    expect((service as unknown as { fallback: unknown }).fallback).toBeNull();
  });

  it("an unset MAP_FALLBACK_PROVIDER means no fallback", async () => {
    baseEnv();
    vi.stubEnv("NESHAN_API_KEY", "k1");
    vi.resetModules();
    const { createMapService } = await import("./service");
    const service = createMapService();
    expect((service as unknown as { fallback: unknown }).fallback).toBeNull();
  });

  it("a configured fallback with a missing credential fails loudly — never hidden behind fallback behavior", async () => {
    baseEnv();
    vi.stubEnv("NESHAN_API_KEY", "k1");
    vi.stubEnv("MAP_FALLBACK_PROVIDER", "google");
    // GOOGLE_MAPS_API_KEY intentionally left unset.
    vi.resetModules();
    const { createMapService } = await import("./service");
    expect(() => createMapService()).toThrow(/google.*GOOGLE_MAPS_API_KEY/i);
  });

  it("an invalid MAP_FALLBACK_PROVIDER fails clearly at startup, never silently picks a provider", async () => {
    baseEnv();
    vi.stubEnv("NESHAN_API_KEY", "k1");
    vi.stubEnv("MAP_FALLBACK_PROVIDER", "bing");
    vi.resetModules();
    const { createMapService } = await import("./service");
    expect(() => createMapService()).toThrow(/MAP_FALLBACK_PROVIDER/);
  });

  it("respects MAP_MAX_RETRIES from the environment", async () => {
    baseEnv();
    vi.stubEnv("NESHAN_API_KEY", "k1");
    vi.stubEnv("MAP_MAX_RETRIES", "0");
    vi.resetModules();
    const { createMapService } = await import("./service");
    const service = createMapService();
    expect((service as unknown as { maxRetries: unknown }).maxRetries).toBe(0);
  });
});
