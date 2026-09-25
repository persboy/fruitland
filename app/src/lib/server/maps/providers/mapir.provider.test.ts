import { describe, expect, it, vi } from "vitest";
import { MapIrProvider } from "./mapir.provider";

const KEY = "mapir.SECRET-KEY-456";
const point = { latitude: 35.72379, longitude: 51.33417 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function make(fetchImpl: typeof fetch) {
  return new MapIrProvider({ apiKey: KEY, timeoutMs: 1000, fetchImpl });
}
const respond = (...responses: Response[]) => {
  const fn = vi.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};

// Field names and sample shape taken from help.map.ir's official Reverse Geocoding output table.
const REVERSE_DOC_EXAMPLE = {
  address: "تهران، تهران، صادقیه، خیابان آیت‌الله کاشانی، خیابان شهید محمد منتظری، پلاک ۱۲",
  postal_address: "تهران، آیت‌الله کاشانی، منتظری",
  address_compact: "تهران، صادقیه، آیت‌الله کاشانی، منتظری",
  last: "خیابان شهید محمد منتظری",
  name: "خیابان شهید محمد منتظری",
  poi: null,
  country: "ایران",
  province: "تهران",
  county: "تهران",
  rural_district: null,
  city: "تهران",
  village: null,
  region: "منطقه ۵",
  neighborhood: "صادقیه",
  primary: "آیت‌الله کاشانی",
  plaque: 12,
  postal_code: "1471813578",
  geom: { type: "point", coordinates: [51.33417, 35.72379] },
  type: "point",
};

describe("MapIrProvider capabilities", () => {
  it("declares exactly what is verified from official docs", () => {
    expect(make(respond()).capabilities).toEqual({
      reverseGeocode: true,
      geocode: false,
      searchPlaces: false,
      getRoute: false,
      routeMatrix: false,
    });
  });

  it.each([
    ["geocode", () => make(respond()).geocode("زنجان")],
    ["searchPlaces", () => make(respond()).searchPlaces("زنجان")],
    ["getRoute", () => make(respond()).getRoute(point, point)],
  ] as const)("%s is honestly unsupported (never faked)", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ provider: "mapir", code: "UNSUPPORTED_OPERATION", retryable: false });
  });
});

describe("reverseGeocode", () => {
  it("maps the official field table into the normalized address", async () => {
    const fetchImpl = respond(json(REVERSE_DOC_EXAMPLE));
    const result = await make(fetchImpl).reverseGeocode(point);

    expect(result.address).toEqual({
      province: "تهران",
      city: "تهران",
      district: "منطقه ۵", // Map.ir's "region"
      neighborhood: "صادقیه",
      street: "آیت‌الله کاشانی", // Map.ir's "primary"
      plaque: "12",
      alley: null, // Map.ir's reverse response has no discrete alley field
      unit: null,
      postalCode: "1471813578",
      formattedAddress: REVERSE_DOC_EXAMPLE.address,
      coordinates: point,
    });
    expect(result.meta.provider).toBe("mapir");

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://map.ir/reverse/?lat=35.72379&lon=51.33417");
    expect(init.headers["x-api-key"]).toBe(KEY);
    expect(url).not.toContain(KEY);
  });

  it("never invents alley/unit/plaque, and leaves them null when absent", async () => {
    const { plaque, ...withoutPlaque } = REVERSE_DOC_EXAMPLE;
    void plaque;
    const result = await make(respond(json({ ...withoutPlaque, region: null, neighborhood: null, primary: null, postal_code: null }))).reverseGeocode(point);
    expect(result.address.district).toBeNull();
    expect(result.address.neighborhood).toBeNull();
    expect(result.address.street).toBeNull();
    expect(result.address.plaque).toBeNull();
    expect(result.address.postalCode).toBeNull();
    expect(result.address.alley).toBeNull();
    expect(result.address.unit).toBeNull();
  });

  it("rejects invalid coordinates without calling Map.ir", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).reverseGeocode({ latitude: 500, longitude: 0 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no usable address in the response → NO_RESULT", async () => {
    await expect(make(respond(json({ province: "تهران" }))).reverseGeocode(point)).rejects.toMatchObject({ code: "NO_RESULT" });
    await expect(make(respond(json({ address: "" }))).reverseGeocode(point)).rejects.toMatchObject({ code: "NO_RESULT" });
  });

  it("non-JSON / non-object body → INVALID_RESPONSE", async () => {
    await expect(make(respond(new Response("<html>", { status: 200 }))).reverseGeocode(point)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(make(respond(json([1, 2, 3]))).reverseGeocode(point)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("errors — generic HTTP mapping (Map.ir documents no custom error codes)", () => {
  it.each([
    [401, "AUTH_FAILED", false], // corp.map.ir/map-services/unauthorized: missing/invalid token -> 401
    [403, "AUTH_FAILED", false],
    [429, "RATE_LIMIT", true],
    [400, "INVALID_REQUEST", false],
    [500, "PROVIDER_UNAVAILABLE", true],
    [503, "PROVIDER_UNAVAILABLE", true],
  ])("HTTP %i → %s (retryable=%s)", async (status, code, retryable) => {
    const err = await make(respond(json({}, status))).reverseGeocode(point).catch((e) => e);
    expect(err).toMatchObject({ provider: "mapir", operation: "reverseGeocode", code, retryable });
  });

  it("timeout → TIMEOUT; network failure → NETWORK", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const err1 = await make(vi.fn().mockRejectedValue(timeout) as unknown as typeof fetch).reverseGeocode(point).catch((e) => e);
    expect(err1).toMatchObject({ code: "TIMEOUT", retryable: true, fallbackEligible: true });

    const err2 = await make(vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch).reverseGeocode(point).catch((e) => e);
    expect(err2).toMatchObject({ code: "NETWORK", retryable: true });
  });

  it("no error ever contains the API key, header name, or base URL", async () => {
    const failures = [
      make(respond(json({}, 401))).reverseGeocode(point),
      make(respond(json({}, 500))).reverseGeocode(point),
      make(vi.fn().mockRejectedValue(new Error(`boom ${KEY}`)) as unknown as typeof fetch).reverseGeocode(point),
    ];
    for (const failure of failures) {
      const err = await failure.catch((e) => e);
      const text = JSON.stringify(err.toSafeJSON()) + err.message;
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("map.ir");
    }
  });
});
