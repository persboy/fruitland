import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode, reverseGeocode, searchPlaces } from "./mapApi";

function jsonResponse(body: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}
const success = <T>(data: T) => ({ success: true, data, message: null, pagination: null, error: null });

describe("mapApi (thin wrapper over the existing apiFetch — no second HTTP client)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reverseGeocode calls the internal GET endpoint with lat/lng in the query, and returns the normalized result untouched", async () => {
    const RESULT = { address: { formattedAddress: "x" }, meta: { provider: "neshan" } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(success(RESULT)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await reverseGeocode({ latitude: 36.6769, longitude: 48.4963 });
    expect(result).toEqual(RESULT);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/v1/maps/reverse-geocode?lat=36.6769&lng=48.4963");
  });

  it("searchPlaces sends query, near, and limit — and omits near when not given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(success([])));
    vi.stubGlobal("fetch", fetchMock);
    await searchPlaces("زنجان", { near: { latitude: 1, longitude: 2 }, limit: 5 });
    let [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`/api/v1/maps/search?${new URLSearchParams({ query: "زنجان", lat: "1", lng: "2", limit: "5" }).toString()}`);

    await searchPlaces("زنجان");
    [url] = fetchMock.mock.calls[1] as [string];
    expect(url).not.toContain("lat=");
  });

  it("geocode encodes the address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(success([])));
    vi.stubGlobal("fetch", fetchMock);
    await geocode("زنجان، خیابان سعدی");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`/api/v1/maps/geocode?${new URLSearchParams({ address: "زنجان، خیابان سعدی" }).toString()}`);
  });
});
