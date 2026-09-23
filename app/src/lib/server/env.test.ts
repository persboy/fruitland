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

  const baseEnv = () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
  };

  it("accepts sms.ir spelled 'sms.ir' and requires its API key and template id", async () => {
    baseEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMS_PROVIDER", "sms.ir");
    vi.stubEnv("SMS_IR_API_KEY", "key");
    vi.stubEnv("SMS_IR_TEMPLATE_ID", "123456");
    const { getEnv } = await import("./env");
    const env = getEnv();
    expect(env.SMS_PROVIDER).toBe("smsir");
    expect(env.SMS_IR_TEMPLATE_ID).toBe(123456);
  });

  it("rejects SMS_PROVIDER=smsir without an API key / template id", async () => {
    baseEnv();
    vi.stubEnv("SMS_PROVIDER", "smsir");
    const { getEnv } = await import("./env");
    expect(() => getEnv()).toThrow(/SMS_IR_API_KEY/);
  });
});
