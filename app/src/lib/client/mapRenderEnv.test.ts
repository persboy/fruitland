import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMapRenderEnv, resetMapRenderEnvForTests } from "./mapRenderEnv";

describe("mapRenderEnv", () => {
  beforeEach(() => {
    resetMapRenderEnvForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetMapRenderEnvForTests();
  });

  it("defaults NEXT_PUBLIC_MAP_RENDER_PROVIDER to leaflet when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_RENDER_PROVIDER", "");
    expect(getMapRenderEnv().NEXT_PUBLIC_MAP_RENDER_PROVIDER).toBe("leaflet");
  });

  it("accepts neshan with its browser key", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_RENDER_PROVIDER", "neshan");
    vi.stubEnv("NEXT_PUBLIC_NESHAN_MAP_KEY", "web-map-key");
    const env = getMapRenderEnv();
    expect(env.NEXT_PUBLIC_MAP_RENDER_PROVIDER).toBe("neshan");
    expect(env.NEXT_PUBLIC_NESHAN_MAP_KEY).toBe("web-map-key");
  });

  it("rejects an unknown provider name instead of silently falling back", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_RENDER_PROVIDER", "mapir");
    expect(() => getMapRenderEnv()).toThrow(/NEXT_PUBLIC_MAP_RENDER_PROVIDER/);
  });

  it("caches the parsed result across calls until reset", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_RENDER_PROVIDER", "google");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY", "browser-key");
    const first = getMapRenderEnv();
    vi.stubEnv("NEXT_PUBLIC_MAP_RENDER_PROVIDER", "leaflet");
    const second = getMapRenderEnv();
    expect(second).toBe(first);
    expect(second.NEXT_PUBLIC_MAP_RENDER_PROVIDER).toBe("google");
  });
});
