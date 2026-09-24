import { describe, expect, it } from "vitest";
import { MAP_PROVIDER_NAMES, coordinatesSchema, isValidCoordinates, routeRequestSchema } from "./types";

describe("coordinatesSchema", () => {
  it("accepts valid points including the boundaries and Zanjan", () => {
    expect(isValidCoordinates({ latitude: 36.6769, longitude: 48.4963 })).toBe(true);
    expect(isValidCoordinates({ latitude: -90, longitude: 180 })).toBe(true);
    expect(isValidCoordinates({ latitude: 0, longitude: 0 })).toBe(true);
  });

  it.each([
    [{ latitude: 91, longitude: 0 }],
    [{ latitude: -91, longitude: 0 }],
    [{ latitude: 0, longitude: 181 }],
    [{ latitude: 0, longitude: -181 }],
    [{ latitude: Number.NaN, longitude: 0 }],
    [{ latitude: Number.POSITIVE_INFINITY, longitude: 0 }],
    [{ latitude: "36.6", longitude: 48 }],
    [{ latitude: 36.6 }],
    [null],
    [undefined],
  ])("rejects %j", (value) => {
    expect(isValidCoordinates(value)).toBe(false);
  });

  it("reports a Persian message", () => {
    const r = coordinatesSchema.safeParse({ latitude: 200, longitude: 0 });
    expect(r.success ? "" : r.error.issues[0]?.message).toBe("عرض جغرافیایی نامعتبر است");
  });
});

describe("routeRequestSchema", () => {
  it("requires both valid endpoints", () => {
    const ok = { origin: { latitude: 36.6, longitude: 48.4 }, destination: { latitude: 36.7, longitude: 48.5 } };
    expect(routeRequestSchema.safeParse(ok).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: ok.origin }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ ...ok, destination: { latitude: 99, longitude: 0 } }).success).toBe(false);
  });
});

describe("MAP_PROVIDER_NAMES", () => {
  it("lists exactly the three approved providers", () => {
    expect([...MAP_PROVIDER_NAMES]).toEqual(["neshan", "mapir", "google"]);
  });
});
