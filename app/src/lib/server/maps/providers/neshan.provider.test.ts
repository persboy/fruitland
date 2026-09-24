import { describe, expect, it, vi } from "vitest";
import { NeshanProvider } from "./neshan.provider";
import { decodePolylineToGeoJson } from "../polyline";

const KEY = "svc.SECRET-KEY-123";
const point = { latitude: 36.6769, longitude: 48.4963 };
const other = { latitude: 36.68, longitude: 48.5 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function make(fetchImpl: typeof fetch) {
  return new NeshanProvider({ apiKey: KEY, timeoutMs: 1000, fetchImpl });
}
const respond = (...responses: Response[]) => {
  const fn = vi.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};

// Payloads copied from Neshan's official documentation examples.
const REVERSE_DOC_EXAMPLE = {
  status: "OK",
  formatted_address: "تهران، دکتر فاطمی، حجاب، سازمان آب، بین دائمی و عبداله زاده",
  route_name: "سازمان آب",
  route_type: "secondary",
  neighbourhood: "فاطمي",
  city: "تهران",
  state: "استان تهران",
  place: null,
  municipality_zone: "6",
  in_traffic_zone: true,
  in_odd_even_zone: true,
  village: null,
  county: "شهرستان تهران",
  district: "بخش مرکزی شهرستان تهران",
};

const SEARCH_DOC_EXAMPLE = {
  count: 2,
  items: [
    {
      title: "حرم مطهر امام رضا (ع)",
      address: "مشهد، خراسان رضوی",
      neighbourhood: "حرم مطهر",
      region: "مشهد، خراسان رضوی",
      type: "religious",
      category: "place",
      location: { x: 59.6157432, y: 36.2880443 },
    },
    { title: "بدون مختصات", address: "x", category: "place", type: "x" },
  ],
};

const ROUTE_POLYLINE = "kz{xEggtxHn@E|@iAtMcAq@k`Ap@yO_OyA"; // from the docs example
const DIRECTION_DOC_EXAMPLE = {
  routes: [
    {
      overview_polyline: { points: ROUTE_POLYLINE },
      legs: [{ summary: "روانمهر - ولیعصر", distance: { value: 1820.0, text: "۲ کیلومتر" }, duration: { value: 487.0, text: "۸ دقیقه" }, steps: [] }],
    },
  ],
};

describe("NeshanProvider capabilities", () => {
  it("declares exactly what is implemented", () => {
    expect(make(respond()).capabilities).toEqual({
      reverseGeocode: true,
      geocode: false,
      searchPlaces: true,
      getRoute: true,
      routeMatrix: false,
    });
  });

  it("geocode is honestly unsupported (not faked with search)", async () => {
    await expect(make(respond()).geocode("زنجان")).rejects.toMatchObject({ provider: "neshan", code: "UNSUPPORTED_OPERATION", retryable: false });
  });
});

describe("reverseGeocode", () => {
  it("maps the official example into the normalized address, with explicit nulls for what Neshan lacks", async () => {
    const fetchImpl = respond(json(REVERSE_DOC_EXAMPLE));
    const result = await make(fetchImpl).reverseGeocode(point);

    expect(result.address).toEqual({
      province: "تهران", // "استان " prefix removed
      city: "تهران",
      district: "منطقه 6",
      neighborhood: "فاطمي",
      street: "سازمان آب",
      alley: null,
      plaque: null,
      unit: null,
      postalCode: null,
      formattedAddress: REVERSE_DOC_EXAMPLE.formatted_address,
      coordinates: point,
    });
    expect(result.meta.provider).toBe("neshan");
    // request shape: URL + Api-Key header
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.neshan.org/v5/reverse?lat=36.6769&lng=48.4963");
    expect(init.headers["Api-Key"]).toBe(KEY);
    expect(url).not.toContain(KEY); // the key is only ever in the header
  });

  it("never fills street from formattedAddress when route_name is missing", async () => {
    const result = await make(respond(json({ ...REVERSE_DOC_EXAMPLE, route_name: null, neighbourhood: null, municipality_zone: null }))).reverseGeocode(point);
    expect(result.address.street).toBeNull();
    expect(result.address.neighborhood).toBeNull();
    expect(result.address.district).toBeNull();
  });

  it("rejects invalid coordinates without calling Neshan", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).reverseGeocode({ latitude: 200, longitude: 0 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("empty result → NO_RESULT", async () => {
    await expect(make(respond(json({ status: "ZERO_RESULTS" }))).reverseGeocode(point)).rejects.toMatchObject({ code: "NO_RESULT" });
    await expect(make(respond(json({ status: "OK", formatted_address: "" }))).reverseGeocode(point)).rejects.toMatchObject({ code: "NO_RESULT" });
  });

  it("non-JSON / non-object body → INVALID_RESPONSE", async () => {
    await expect(make(respond(new Response("<html>", { status: 200 }))).reverseGeocode(point)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(make(respond(json("nope"))).reverseGeocode(point)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("error normalization (documented Neshan codes + generic HTTP)", () => {
  it.each([
    [470, "INVALID_REQUEST", false],
    [480, "AUTH_FAILED", false],
    [481, "RATE_LIMIT", false], // quota exhausted: not retryable
    [482, "RATE_LIMIT", true], // per-minute rate: retryable
    [483, "AUTH_FAILED", false],
    [400, "INVALID_REQUEST", false],
    [500, "PROVIDER_UNAVAILABLE", true],
    [503, "PROVIDER_UNAVAILABLE", true],
  ])("HTTP %i → %s (retryable=%s)", async (status, code, retryable) => {
    const err = await make(respond(json({ status: "ERROR" }, status))).reverseGeocode(point).catch((e) => e);
    expect(err).toMatchObject({ provider: "neshan", operation: "reverseGeocode", code, retryable });
  });

  it("483 explains the key-type mismatch", async () => {
    const err = await make(respond(json({}, 483))).reverseGeocode(point).catch((e) => e);
    expect(err.message).toMatch(/Web Service key/);
  });

  it("timeout → TIMEOUT (retryable, fallback-eligible)", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const err = await make(vi.fn().mockRejectedValue(timeout) as unknown as typeof fetch).reverseGeocode(point).catch((e) => e);
    expect(err).toMatchObject({ code: "TIMEOUT", retryable: true, fallbackEligible: true });
  });

  it("connection failure → NETWORK", async () => {
    const err = await make(vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch).reverseGeocode(point).catch((e) => e);
    expect(err).toMatchObject({ code: "NETWORK", retryable: true });
  });

  it("no error, message, or serialized form ever contains the API key or URL", async () => {
    const failures = [
      make(respond(json({}, 480))).reverseGeocode(point),
      make(respond(json({}, 500))).reverseGeocode(point),
      make(vi.fn().mockRejectedValue(new Error(`boom ${KEY}`)) as unknown as typeof fetch).reverseGeocode(point),
    ];
    for (const failure of failures) {
      const err = await failure.catch((e) => e);
      const text = JSON.stringify(err.toSafeJSON()) + err.message + String(err.stack ?? "").split("\n")[0];
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("api.neshan.org");
    }
  });
});

describe("searchPlaces", () => {
  it("maps items (x=lng, y=lat), skips rows without coordinates, and encodes the term", async () => {
    const fetchImpl = respond(json(SEARCH_DOC_EXAMPLE));
    const places = await make(fetchImpl).searchPlaces("بیمارستان ولیعصر", { near: point });

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      id: null,
      name: "حرم مطهر امام رضا (ع)",
      coordinates: { latitude: 36.2880443, longitude: 59.6157432 },
      address: "مشهد، خراسان رضوی",
      category: "religious",
    });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`https://api.neshan.org/v1/search?term=${encodeURIComponent("بیمارستان ولیعصر")}&lat=36.6769&lng=48.4963`);
  });

  it("returns several results and honors limit", async () => {
    const items = [1, 2, 3].map((n) => ({ title: `p${n}`, location: { x: 48 + n / 100, y: 36 + n / 100 } }));
    const places = await make(respond(json({ count: 3, items }))).searchPlaces("p", { near: point, limit: 2 });
    expect(places.map((p) => p.name)).toEqual(["p1", "p2"]);
  });

  it("empty result → []", async () => {
    expect(await make(respond(json({ count: 0, items: [] }))).searchPlaces("zzz", { near: point })).toEqual([]);
  });

  it("requires a non-empty query and a reference point (Neshan requires lat/lng) without calling out", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).searchPlaces("  ", { near: point })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(make(fetchImpl).searchPlaces("x")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("body without items → INVALID_RESPONSE", async () => {
    await expect(make(respond(json({ count: 1 }))).searchPlaces("x", { near: point })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("getRoute", () => {
  it("maps distance, duration and a GeoJSON LineString geometry", async () => {
    const fetchImpl = respond(json(DIRECTION_DOC_EXAMPLE));
    const route = await make(fetchImpl).getRoute(point, other);

    expect(route.distanceMeters).toBe(1820);
    expect(route.durationSeconds).toBe(487);
    expect(route.origin).toEqual(point);
    expect(route.destination).toEqual(other);
    expect(route.geometry?.type).toBe("LineString");
    expect(route.geometry!.coordinates.length).toBeGreaterThanOrEqual(2);
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("https://api.neshan.org/v4/direction?type=car&origin=36.6769,48.4963&destination=36.68,48.5");
  });

  it("includeGeometry:false drops the geometry", async () => {
    const route = await make(respond(json(DIRECTION_DOC_EXAMPLE))).getRoute(point, other, { includeGeometry: false });
    expect(route.geometry).toBeNull();
  });

  it("sums legs when a route has several", async () => {
    const body = { routes: [{ legs: [{ distance: { value: 100 }, duration: { value: 10 } }, { distance: { value: 250.4 }, duration: { value: 30 } }] }] };
    const route = await make(respond(json(body))).getRoute(point, other);
    expect([route.distanceMeters, route.durationSeconds, route.geometry]).toEqual([350, 40, null]);
  });

  it("no routes → NO_RESULT; malformed legs → INVALID_RESPONSE", async () => {
    await expect(make(respond(json({ routes: [] }))).getRoute(point, other)).rejects.toMatchObject({ code: "NO_RESULT" });
    await expect(make(respond(json({ routes: [{ legs: [{ distance: {} }] }] }))).getRoute(point, other)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("route failure (HTTP 500) is normalized and retryable", async () => {
    await expect(make(respond(json({}, 500))).getRoute(point, other)).rejects.toMatchObject({ operation: "getRoute", code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("rejects invalid endpoints without calling out", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).getRoute(point, { latitude: 0, longitude: 999 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("decodePolylineToGeoJson", () => {
  it("decodes Neshan's documented sample to GeoJSON [lng, lat] points inside Tehran", () => {
    const line = decodePolylineToGeoJson(ROUTE_POLYLINE);
    expect(line.length).toBeGreaterThan(3);
    for (const [lng, lat] of line) {
      expect(lat).toBeGreaterThan(35.5);
      expect(lat).toBeLessThan(35.9);
      expect(lng).toBeGreaterThan(51.2);
      expect(lng).toBeLessThan(51.6);
    }
    // the first step of the documented example starts at [51.390755, 35.701021]
    expect(line[0]![0]).toBeCloseTo(51.39, 1);
    expect(line[0]![1]).toBeCloseTo(35.70, 1);
  });

  it("decodes the canonical Google example and tolerates truncated input", () => {
    expect(decodePolylineToGeoJson("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
    expect(decodePolylineToGeoJson("_p~iF")).toEqual([]); // half a pair is dropped, not invented
    expect(decodePolylineToGeoJson("")).toEqual([]);
  });
});
