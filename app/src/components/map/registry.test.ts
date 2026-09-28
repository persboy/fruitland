import { describe, expect, it } from "vitest";
import ExpectedLeaflet from "./LeafletMapRenderer";
import ExpectedNeshan from "./NeshanMapRenderer";
import ExpectedGoogle from "./GoogleMapsRenderer";
import { resolveRendererLoader } from "./registry";

describe("map renderer registry", () => {
  it("resolves 'leaflet' to LeafletMapRenderer", async () => {
    const mod = await resolveRendererLoader("leaflet")();
    expect(mod.default).toBe(ExpectedLeaflet);
  });

  it("resolves 'neshan' to NeshanMapRenderer", async () => {
    const mod = await resolveRendererLoader("neshan")();
    expect(mod.default).toBe(ExpectedNeshan);
  });

  it("resolves 'google' to GoogleMapsRenderer", async () => {
    const mod = await resolveRendererLoader("google")();
    expect(mod.default).toBe(ExpectedGoogle);
  });

  it("each provider name resolves to a distinct component", async () => {
    const [leaflet, neshan, google] = await Promise.all([
      resolveRendererLoader("leaflet")(),
      resolveRendererLoader("neshan")(),
      resolveRendererLoader("google")(),
    ]);
    const components = new Set([leaflet.default, neshan.default, google.default]);
    expect(components.size).toBe(3);
  });
});
