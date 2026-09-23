import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comparePassword, hashPassword } from "./password";

describe("password hashing", () => {
  beforeEach(() => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("produces a hash that verifies against the original password", async () => {
    vi.stubEnv("PASSWORD_HASH_ROUNDS", "4"); // low rounds — this test only checks correctness, not timing
    const hash = await hashPassword("Sup3rSecret!");
    expect(hash).not.toBe("Sup3rSecret!");
    expect(await comparePassword("Sup3rSecret!", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    vi.stubEnv("PASSWORD_HASH_ROUNDS", "4");
    const hash = await hashPassword("Sup3rSecret!");
    expect(await comparePassword("wrong-password", hash)).toBe(false);
  });
});
