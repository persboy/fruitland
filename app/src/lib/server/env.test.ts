import { afterEach, describe, expect, it, vi } from "vitest";

describe("getEnv", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("throws a clear error when MONGODB_URI is missing", async () => {
    vi.stubEnv("MONGODB_URI", "");
    const { getEnv } = await import("./env");
    expect(() => getEnv()).toThrow(/MONGODB_URI/);
  });

  it("returns parsed env when valid", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("NODE_ENV", "test");
    const { getEnv } = await import("./env");
    const env = getEnv();
    expect(env.MONGODB_URI).toBe("mongodb://localhost:27017/fruitland_test");
    expect(env.NODE_ENV).toBe("test");
  });
});
