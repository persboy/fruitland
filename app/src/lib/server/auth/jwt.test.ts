import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("jwt", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
    vi.stubEnv("JWT_ACCESS_EXPIRES_IN", "15m");
    vi.stubEnv("JWT_REFRESH_EXPIRES_IN_DAYS", "30");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips an access token payload", async () => {
    const { signAccessToken, verifyAccessToken } = await import("./jwt");
    const token = signAccessToken({ sub: "user123", role: "admin" });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("user123");
    expect(payload.role).toBe("admin");
  });

  it("round-trips a refresh token payload", async () => {
    const { signRefreshToken, verifyRefreshToken } = await import("./jwt");
    const token = signRefreshToken({ sub: "user123", jti: "session-abc" });
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe("user123");
    expect(payload.jti).toBe("session-abc");
  });

  it("rejects a token signed with a different secret", async () => {
    const { signAccessToken } = await import("./jwt");
    const token = signAccessToken({ sub: "user123", role: "admin" });

    vi.resetModules();
    vi.stubEnv("JWT_ACCESS_SECRET", "a-completely-different-secret");
    const { verifyAccessToken: verifyWithOtherSecret } = await import("./jwt");
    expect(() => verifyWithOtherSecret(token)).toThrow();
  });
});
