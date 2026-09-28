import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Coordinates, RouteResult, VehicleType } from "@fruitland/shared";
import { SequentialRoutePlanner, buildRoutePlanInput } from "./routePlanner";

const origin: Coordinates = { latitude: 36.68, longitude: 48.5 };

function fakeRoute(from: Coordinates, to: Coordinates): RouteResult {
  return {
    distanceMeters: 100,
    durationSeconds: 10,
    origin: from,
    destination: to,
    geometry: null,
    meta: { provider: "neshan" } as RouteResult["meta"],
  };
}

describe("SequentialRoutePlanner", () => {
  it("passes the courier's domain vehicle type straight to MapService.getRoute, for every leg", async () => {
    for (const vehicleType of ["bicycle", "motorcycle", "car"] as VehicleType[]) {
      const getRoute = vi.fn(async (from: Coordinates, to: Coordinates, ...rest: [options?: { vehicleType?: VehicleType }]) => {
        void rest;
        return fakeRoute(from, to);
      });
      const planner = new SequentialRoutePlanner({ getRoute });
      await planner.plan({
        vehicleType,
        origin,
        stops: [
          { stopId: "s1", orderId: "o1", coordinates: { latitude: 1, longitude: 1 } },
          { stopId: "s2", orderId: "o2", coordinates: { latitude: 2, longitude: 2 } },
        ],
      });
      expect(getRoute).toHaveBeenCalledTimes(2);
      for (const call of getRoute.mock.calls) expect(call[2]).toEqual({ vehicleType });
    }
  });

  it("routes origin → stop 1 → stop 2 in exactly the given order and does not reorder or optimise", async () => {
    const getRoute = vi.fn(async (from: Coordinates, to: Coordinates) => fakeRoute(from, to));
    const stops = [
      { stopId: "far", orderId: "o1", coordinates: { latitude: 50, longitude: 50 } },
      { stopId: "near", orderId: "o2", coordinates: { latitude: 36.7, longitude: 48.5 } },
    ];
    const plan = await new SequentialRoutePlanner({ getRoute }).plan({ vehicleType: "car", origin, stops });
    expect(plan.legs.map((l) => [l.fromStopId, l.toStopId])).toEqual([
      [null, "far"],
      ["far", "near"],
    ]);
    expect(getRoute.mock.calls[0]![0]).toEqual(origin);
    expect(getRoute.mock.calls[1]![0]).toEqual(stops[0]!.coordinates);
  });

  it("makes no map calls for a run with no stops", async () => {
    const getRoute = vi.fn();
    const plan = await new SequentialRoutePlanner({ getRoute }).plan({ vehicleType: "car", origin, stops: [] });
    expect(plan.legs).toEqual([]);
    expect(getRoute).not.toHaveBeenCalled();
  });
});

describe("buildRoutePlanInput", () => {
  const stop = (id: string, orderId: string, sequence: number, status = "pending") => ({ id, orderId, sequence, status });

  it("uses only pending stops, in sequence order (not array order), with locations read from the orders", () => {
    const { input, missingLocationOrderIds } = buildRoutePlanInput({
      vehicleType: "motorcycle",
      origin,
      stops: [stop("s3", "o3", 3), stop("s1", "o1", 1, "delivered"), stop("s2", "o2", 2)],
      orderLocations: new Map([
        ["o1", { lat: 1, lng: 1 }],
        ["o2", { lat: 2, lng: 2 }],
        ["o3", { lat: 3, lng: 3 }],
      ]),
    });
    expect(missingLocationOrderIds).toEqual([]);
    expect(input.vehicleType).toBe("motorcycle");
    expect(input.stops.map((s) => s.stopId)).toEqual(["s2", "s3"]);
    expect(input.stops[0]!.coordinates).toEqual({ latitude: 2, longitude: 2 });
  });

  it("keeps two orders at the same address as two separate stops", () => {
    const same = { lat: 36.7, lng: 48.5 };
    const { input } = buildRoutePlanInput({
      vehicleType: "car",
      origin,
      stops: [stop("s1", "oA", 1), stop("s2", "oB", 2)],
      orderLocations: new Map([["oA", same], ["oB", same]]),
    });
    expect(input.stops).toHaveLength(2);
    expect(input.stops.map((s) => s.orderId)).toEqual(["oA", "oB"]);
  });

  it("reports an order without a stored location instead of guessing one", () => {
    const { input, missingLocationOrderIds } = buildRoutePlanInput({
      vehicleType: "car",
      origin,
      stops: [stop("s1", "o1", 1), stop("s2", "o2", 2)],
      orderLocations: new Map([["o1", undefined], ["o2", { lat: 2, lng: 2 }]]),
    });
    expect(missingLocationOrderIds).toEqual(["o1"]);
    expect(input.stops.map((s) => s.stopId)).toEqual(["s2"]);
  });
});

describe("architecture boundaries", () => {
  const serverDir = join(__dirname, "..");
  const read = (path: string) => readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const deliveryFiles = [
    ...readdirSync(__dirname).filter((f) => /\.ts$/.test(f) && !f.includes(".test.")).map((f) => join(__dirname, f)),
    join(serverDir, "services", "deliveryRunService.ts"),
    join(serverDir, "models", "DeliveryRun.ts"),
  ];

  it("no delivery code names a map provider or imports a provider adapter", () => {
    for (const file of deliveryFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/maps\/providers|maps\/registry|neshan|mapir|map\.ir|google/i);
    }
  });

  it("delivery code never maps a vehicle type to provider-specific values", () => {
    for (const file of deliveryFiles) {
      expect(read(file), file).not.toMatch(/\b(driving|foot|bike|cycling|motorcycle)\b\s*[:=]\s*["']/);
    }
  });

  it("the map layer knows nothing about delivery", () => {
    const mapsDir = join(serverDir, "maps");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    for (const file of walk(mapsDir).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
      expect(read(file), file).not.toMatch(/delivery|courier/i);
    }
  });

  it("delivery code uses no client/browser credential or public env", () => {
    for (const file of deliveryFiles) {
      expect(read(file), file).not.toMatch(/NEXT_PUBLIC|process\.env|API_KEY/);
    }
  });

  it("the route planner depends on MapService by type only and never on the run service (no cycle)", () => {
    const source = read(join(__dirname, "routePlanner.ts"));
    expect(source).toMatch(/import type \{ MapService \} from "..\/maps\/service"/);
    expect(source).not.toMatch(/deliveryRunService|models\//);
  });
});
