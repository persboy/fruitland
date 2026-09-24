import { describe, expect, it } from "vitest";
import { MAP_ERROR_CODES, MapProviderError, errorFromHttpStatus, mapError, unsupportedOperation } from "./errors";
import { MAP_CAPABILITIES } from "./provider";
import { FakeMapProvider } from "./testing/FakeMapProvider";

describe("MapProviderError", () => {
  it("matches the documented shape and is safe to serialize", () => {
    const err = mapError("google", "reverseGeocode", "RATE_LIMIT");
    expect(err).toBeInstanceOf(Error);
    expect(err.toSafeJSON()).toEqual({
      provider: "google",
      operation: "reverseGeocode",
      code: "RATE_LIMIT",
      message: "Provider rate limit reached",
      retryable: true,
    });
    expect(Object.keys(err.toSafeJSON()).sort()).toEqual(["code", "message", "operation", "provider", "retryable"]);
  });

  it.each([
    ["TIMEOUT", true, true],
    ["NETWORK", true, true],
    ["PROVIDER_UNAVAILABLE", true, true],
    ["RATE_LIMIT", true, false], // retried on the same provider, but not a fallback trigger
    ["AUTH_FAILED", false, false],
    ["INVALID_REQUEST", false, false],
    ["NO_RESULT", false, false],
    ["INVALID_RESPONSE", false, false],
    ["UNSUPPORTED_OPERATION", false, false],
  ] as const)("%s → retryable=%s, fallbackEligible=%s", (code, retryable, fallback) => {
    const err = mapError("neshan", "geocode", code);
    expect(err.retryable).toBe(retryable);
    expect(err.fallbackEligible).toBe(fallback);
  });

  it("covers every code with a default message", () => {
    for (const code of MAP_ERROR_CODES) expect(mapError("mapir", "searchPlaces", code).message.length).toBeGreaterThan(0);
  });

  it("allows an explicit retryable override", () => {
    const err = new MapProviderError({ provider: "neshan", operation: "getRoute", code: "INVALID_RESPONSE", message: "x", retryable: true });
    expect(err.retryable).toBe(true);
  });
});

describe("errorFromHttpStatus", () => {
  it.each([
    [400, "INVALID_REQUEST"],
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [404, "NO_RESULT"],
    [422, "INVALID_REQUEST"],
    [429, "RATE_LIMIT"],
    [500, "PROVIDER_UNAVAILABLE"],
    [503, "PROVIDER_UNAVAILABLE"],
    [302, "INVALID_RESPONSE"],
  ])("HTTP %i → %s", (status, code) => {
    expect(errorFromHttpStatus("google", "getRoute", status).code).toBe(code);
  });
});

describe("unsupportedOperation", () => {
  it("is a non-retryable, non-fallback error", () => {
    const err = unsupportedOperation("mapir", "getRouteMatrix");
    expect(err.code).toBe("UNSUPPORTED_OPERATION");
    expect(err.retryable).toBe(false);
    expect(err.fallbackEligible).toBe(false);
  });
});

describe("FakeMapProvider (contract usability)", () => {
  it("implements MapProvider, records calls, and declares capabilities for every operation", async () => {
    const fake = new FakeMapProvider("google");
    expect(Object.keys(fake.capabilities).sort()).toEqual([...MAP_CAPABILITIES].sort());

    const point = { latitude: 36.6769, longitude: 48.4963 };
    const result = await fake.reverseGeocode(point);
    expect(result.meta.provider).toBe("google");
    expect(result.address.street).toBeNull(); // unknown parts are explicit null
    expect((await fake.getRoute(point, point)).geometry).toBeNull();
    expect(fake.calls.map((c) => c.operation)).toEqual(["reverseGeocode", "getRoute"]);
  });

  it("can be told to fail with a normalized error", async () => {
    const fake = new FakeMapProvider();
    fake.failWith = mapError("neshan", "geocode", "TIMEOUT");
    await expect(fake.geocode("زنجان")).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });
});
