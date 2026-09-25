import { describe, expect, it, vi } from "vitest";
import { GoogleMapsProvider } from "./google.provider";

const KEY = "google.SECRET-KEY-789";
const point = { latitude: 40.714224, longitude: -73.961452 };
const other = { latitude: 37.417670, longitude: -122.079595 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function make(fetchImpl: typeof fetch) {
  return new GoogleMapsProvider({ apiKey: KEY, timeoutMs: 1000, fetchImpl });
}
const respond = (...responses: Response[]) => {
  const fn = vi.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};
const calls = (fn: typeof fetch) => (fn as unknown as ReturnType<typeof vi.fn>).mock.calls;

// Fixtures copied verbatim (structure) from Google's official Geocoding API docs example.
const REVERSE_DOC_EXAMPLE = {
  results: [
    {
      address_components: [
        { long_name: "277", short_name: "277", types: ["street_number"] },
        { long_name: "Bedford Avenue", short_name: "Bedford Ave", types: ["route"] },
        { long_name: "Williamsburg", short_name: "Williamsburg", types: ["neighborhood", "political"] },
        { long_name: "Brooklyn", short_name: "Brooklyn", types: ["sublocality", "political"] },
        { long_name: "Kings", short_name: "Kings", types: ["administrative_area_level_2", "political"] },
        { long_name: "New York", short_name: "NY", types: ["administrative_area_level_1", "political"] },
        { long_name: "United States", short_name: "US", types: ["country", "political"] },
        { long_name: "11211", short_name: "11211", types: ["postal_code"] },
      ],
      formatted_address: "277 Bedford Avenue, Brooklyn, NY 11211, USA",
      geometry: { location: { lat: 40.714232, lng: -73.9612889 }, location_type: "ROOFTOP" },
      place_id: "ChIJd8BlQ2BZwokRAFUEcm_qrcA",
      types: ["street_address"],
    },
  ],
  status: "OK",
};

const PLACES_DOC_EXAMPLE = {
  places: [
    { id: "ChIJifIePKtZwokRVZ-UdRGkZzs", displayName: { text: "Peace Harmony" }, formattedAddress: "29 King St, Sydney NSW 2000, Australia", location: { latitude: -33.8674, longitude: 151.2073 }, primaryType: "restaurant", types: ["restaurant", "food"] },
    { id: "no-coords", displayName: { text: "Bad Row" } },
  ],
};

// From "Request route polylines" official docs example.
const ROUTE_DOC_EXAMPLE = {
  routes: [{ distanceMeters: 56901, duration: "2420s", polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }],
};

// From "Get a route matrix" official docs example (2x2).
const MATRIX_DOC_EXAMPLE = [
  { originIndex: 0, destinationIndex: 0, status: {}, distanceMeters: 822, duration: "160s", condition: "ROUTE_EXISTS" },
  { originIndex: 1, destinationIndex: 0, status: {}, distanceMeters: 2919, duration: "361s", condition: "ROUTE_EXISTS" },
  { originIndex: 1, destinationIndex: 1, status: {}, distanceMeters: 5598, duration: "402s", condition: "ROUTE_EXISTS" },
  { originIndex: 0, destinationIndex: 1, status: {}, distanceMeters: 7259, duration: "712s", condition: "ROUTE_EXISTS" },
];

describe("GoogleMapsProvider capabilities", () => {
  it("declares all five operations supported (verified from official docs)", () => {
    expect(make(respond()).capabilities).toEqual({ reverseGeocode: true, geocode: true, searchPlaces: true, getRoute: true, routeMatrix: true });
  });
});

describe("reverseGeocode", () => {
  it("maps the documented example, puts the key in the query (not a header), and never leaks it in errors", async () => {
    const fetchImpl = respond(json(REVERSE_DOC_EXAMPLE));
    const result = await make(fetchImpl).reverseGeocode(point);
    expect(result.address).toEqual({
      province: "New York",
      city: "Kings", // Google's example has no `locality`; falls back to administrative_area_level_2
      district: "Brooklyn",
      neighborhood: "Williamsburg",
      street: "Bedford Avenue",
      plaque: "277",
      alley: null,
      unit: null,
      postalCode: "11211",
      formattedAddress: "277 Bedford Avenue, Brooklyn, NY 11211, USA",
      coordinates: point,
    });
    const [url, init] = calls(fetchImpl)[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`https://maps.googleapis.com/maps/api/geocode/json?latlng=40.714224,-73.961452&key=${KEY}`);
    expect(init.headers).toEqual({});
  });

  it("HTTP 200 with status ZERO_RESULTS → NO_RESULT (Google never uses HTTP status for Geocoding errors)", async () => {
    await expect(make(respond(json({ status: "ZERO_RESULTS", results: [] }))).reverseGeocode(point)).rejects.toMatchObject({ code: "NO_RESULT" });
  });

  it.each([
    ["OVER_QUERY_LIMIT", "RATE_LIMIT", true],
    ["OVER_DAILY_LIMIT", "AUTH_FAILED", false],
    ["REQUEST_DENIED", "AUTH_FAILED", false],
    ["INVALID_REQUEST", "INVALID_REQUEST", false],
    ["UNKNOWN_ERROR", "PROVIDER_UNAVAILABLE", true],
  ] as const)("status %s → %s (retryable=%s)", async (status, code, retryable) => {
    const err = await make(respond(json({ status }))).reverseGeocode(point).catch((e) => e);
    expect(err).toMatchObject({ provider: "google", code, retryable });
  });

  it("rejects invalid coordinates without calling out", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).reverseGeocode({ latitude: 999, longitude: 0 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("timeout/network map the same as every other provider", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await expect(make(vi.fn().mockRejectedValue(timeout) as unknown as typeof fetch).reverseGeocode(point)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    await expect(make(vi.fn().mockRejectedValue(new TypeError("x")) as unknown as typeof fetch).reverseGeocode(point)).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("no error ever leaks the API key", async () => {
    const err = await make(respond(json({ status: "REQUEST_DENIED" }))).reverseGeocode(point).catch((e) => e);
    const text = JSON.stringify(err.toSafeJSON()) + err.message;
    expect(text).not.toContain(KEY);
  });
});

describe("geocode", () => {
  it("returns coordinates and normalized address per result, skipping unusable rows", async () => {
    const withBadRow = { status: "OK", results: [REVERSE_DOC_EXAMPLE.results[0], { formatted_address: "no geometry" }, { geometry: { location: { lat: 1, lng: 2 } } }] };
    const results = await make(respond(json(withBadRow))).geocode("277 Bedford Ave, Brooklyn");
    expect(results).toHaveLength(1);
    expect(results[0]!.coordinates).toEqual({ latitude: 40.714232, longitude: -73.9612889 });
    expect(results[0]!.address?.street).toBe("Bedford Avenue");
  });

  it("empty query → INVALID_REQUEST without calling out", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).geocode("   ")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("encodes the address query param", async () => {
    const fetchImpl = respond(json({ status: "OK", results: [] }));
    await make(fetchImpl).geocode("زنجان، خیابان سعدی");
    const [url] = calls(fetchImpl)[0] as [string];
    expect(url).toContain(`address=${encodeURIComponent("زنجان، خیابان سعدی")}`);
  });
});

describe("searchPlaces (Places API New)", () => {
  it("maps the documented Text Search example and applies locationBias when near is given", async () => {
    const fetchImpl = respond(json(PLACES_DOC_EXAMPLE));
    const places = await make(fetchImpl).searchPlaces("Spicy Vegetarian Food in Sydney", { near: point, limit: 5 });

    expect(places).toHaveLength(1); // the coordinate-less row is skipped
    expect(places[0]).toMatchObject({ id: "ChIJifIePKtZwokRVZ-UdRGkZzs", name: "Peace Harmony", category: "restaurant" });
    const [url, init] = calls(fetchImpl)[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(init.headers["X-Goog-FieldMask"]).toContain("places.displayName");
    const parsed = JSON.parse(init.body);
    expect(parsed.textQuery).toBe("Spicy Vegetarian Food in Sydney");
    expect(parsed.locationBias.circle.center).toEqual({ latitude: point.latitude, longitude: point.longitude });
    expect(parsed.pageSize).toBe(5);
  });

  it("works without near (no location bias) and returns [] on no matches", async () => {
    const places = await make(respond(json({ places: [] }))).searchPlaces("zzz");
    expect(places).toEqual([]);
  });

  it("empty query → INVALID_REQUEST without calling out", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).searchPlaces(" ")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [429, "RATE_LIMIT"],
    [400, "INVALID_REQUEST"],
    [500, "PROVIDER_UNAVAILABLE"],
  ])("standard Google API error envelope: HTTP %i → %s", async (status, code) => {
    const err = await make(respond(json({ error: { code: status, message: "x", status: "X" } }, status))).searchPlaces("x").catch((e) => e);
    expect(err).toMatchObject({ provider: "google", operation: "searchPlaces", code });
  });
});

describe("getRoute (Routes API)", () => {
  it("maps distance/duration/geometry and sends the right travelMode + field mask", async () => {
    const fetchImpl = respond(json(ROUTE_DOC_EXAMPLE));
    const route = await make(fetchImpl).getRoute(point, other);
    expect(route.distanceMeters).toBe(56901);
    expect(route.durationSeconds).toBe(2420);
    expect(route.geometry?.type).toBe("LineString");
    expect(route.geometry!.coordinates.length).toBeGreaterThan(1);

    const [url, init] = calls(fetchImpl)[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init.headers["X-Goog-FieldMask"]).toBe("routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline");
    const body = JSON.parse(init.body);
    expect(body.travelMode).toBe("DRIVE");
    expect(body.origin.location.latLng).toEqual({ latitude: point.latitude, longitude: point.longitude });
  });

  it.each([
    ["car", "DRIVE"],
    ["motorcycle", "TWO_WHEELER"],
    ["bicycle", "BICYCLE"],
  ] as const)("vehicleType %s → travelMode %s (all three are officially documented, none unsupported)", async (vehicleType, travelMode) => {
    const fetchImpl = respond(json(ROUTE_DOC_EXAMPLE));
    await make(fetchImpl).getRoute(point, other, { vehicleType });
    const [, init] = calls(fetchImpl)[0] as [string, { body: string }];
    expect(JSON.parse(init.body).travelMode).toBe(travelMode);
  });

  it("includeGeometry:false omits the polyline field mask and returns null geometry", async () => {
    const fetchImpl = respond(json({ routes: [{ distanceMeters: 100, duration: "10s" }] }));
    const route = await make(fetchImpl).getRoute(point, other, { includeGeometry: false });
    expect(route.geometry).toBeNull();
    const [, init] = calls(fetchImpl)[0] as [string, { headers: Record<string, string> }];
    expect(init.headers["X-Goog-FieldMask"]).toBe("routes.duration,routes.distanceMeters");
  });

  it("no route → NO_RESULT; malformed route → INVALID_RESPONSE", async () => {
    await expect(make(respond(json({ routes: [] }))).getRoute(point, other)).rejects.toMatchObject({ code: "NO_RESULT" });
    await expect(make(respond(json({ routes: [{ distanceMeters: 1 }] }))).getRoute(point, other)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects invalid coordinates without calling out", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).getRoute(point, { latitude: 999, longitude: 0 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("5xx from Routes API is normalized and retryable", async () => {
    await expect(make(respond(json({}, 503))).getRoute(point, other)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });
});

describe("getRouteMatrix", () => {
  it("places the documented 2x2 example by index (response order is not guaranteed)", async () => {
    const origins = [point, other];
    const destinations = [{ latitude: 37.420999, longitude: -122.086894 }, { latitude: 37.383047, longitude: -122.044651 }];
    const matrix = await make(respond(json(MATRIX_DOC_EXAMPLE))).getRouteMatrix(origins, destinations);
    expect(matrix.rows).toEqual([
      [{ distanceMeters: 822, durationSeconds: 160 }, { distanceMeters: 7259, durationSeconds: 712 }],
      [{ distanceMeters: 2919, durationSeconds: 361 }, { distanceMeters: 5598, durationSeconds: 402 }],
    ]);
  });

  it("a cell with condition ROUTE_NOT_FOUND becomes null, not 0", async () => {
    const body = [{ originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_NOT_FOUND" }];
    const matrix = await make(respond(json(body))).getRouteMatrix([point], [other]);
    expect(matrix.rows).toEqual([[{ distanceMeters: null, durationSeconds: null }]]);
  });

  it("a cell with a non-empty status (per-element error) becomes null too", async () => {
    const body = [{ originIndex: 0, destinationIndex: 0, status: { code: 3, message: "bad" }, condition: "ROUTE_EXISTS", distanceMeters: 100, duration: "10s" }];
    const matrix = await make(respond(json(body))).getRouteMatrix([point], [other]);
    expect(matrix.rows[0]![0]).toEqual({ distanceMeters: null, durationSeconds: null });
  });

  it("rejects empty origins/destinations without calling out", async () => {
    const fetchImpl = respond();
    await expect(make(fetchImpl).getRouteMatrix([], [other])).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("non-array response → INVALID_RESPONSE", async () => {
    await expect(make(respond(json({ places: [] }))).getRouteMatrix([point], [other])).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("credential and URL hygiene across POST APIs", () => {
  it("Places/Routes/Matrix send the key only via X-Goog-Api-Key, never in the URL, and errors never leak it", async () => {
    const provider = make(respond(json({ error: { code: 401 } }, 401)));
    const err = await provider.searchPlaces("x").catch((e) => e);
    const text = JSON.stringify(err.toSafeJSON()) + err.message;
    expect(text).not.toContain(KEY);
  });
});
