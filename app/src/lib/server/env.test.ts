import { afterEach, describe, expect, it, vi } from "vitest";

describe("getEnv", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("throws a clear error when MONGODB_URI is missing", async () => {
    vi.stubEnv("MONGODB_URI", "");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
    const { getEnv } = await import("./env");
    expect(() => getEnv()).toThrow(/MONGODB_URI/);
  });

  it("returns parsed env when valid", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
    const { getEnv } = await import("./env");
    const env = getEnv();
    expect(env.MONGODB_URI).toBe("mongodb://localhost:27017/fruitland_test");
    expect(env.NODE_ENV).toBe("test");
  });

  it("refuses to start with the console SMS provider in production", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
    vi.stubEnv("SMS_PROVIDER", "console");
    const { getEnv } = await import("./env");
    expect(() => getEnv()).toThrow(/SMS_PROVIDER=console/);
  });
});
