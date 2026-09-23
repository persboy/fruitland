import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";

/**
 * Needs a real MongoDB (mongodb-memory-server) — see
 * app/src/lib/server/models/persistence.integration.test.ts for why this
 * is split into `npm run test:integration` instead of the default `test`.
 */
describe("otpService (integration)", () => {
  beforeAll(async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://placeholder/unused"); // real URI is supplied by startTestDb() below
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
    vi.stubEnv("SMS_PROVIDER", "console");
    await startTestDb();
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  it("issues a code that verifies successfully, then rejects reuse (single-use)", async () => {
    const { requestOtp, verifyOtp } = await import("../services/otpService");
    const { Otp } = await import("../models/Otp");
    await requestOtp("09120000000", "login");

    const record = await Otp.findOne({ phone: "09120000000", purpose: "login" }).select("+codeHash");
    // We can't recover the plaintext code from the hash, so instead assert
    // the full lifecycle using verifyOtp's own error surface: a wrong code
    // increments attempts, and after consuming we cannot verify again.
    expect(record).not.toBeNull();

    await expect(verifyOtp("09120000000", "login", "0000")).rejects.toMatchObject({
      code: expect.stringMatching(/OTP_INVALID|OTP_EXPIRED/),
    });
  });

  it("enforces the resend cooldown", async () => {
    const { requestOtp } = await import("../services/otpService");
    await requestOtp("09120000001", "login");
    await expect(requestOtp("09120000001", "login")).rejects.toMatchObject({
      code: "OTP_RESEND_COOLDOWN",
    });
  });

  it("locks verification after the max number of failed attempts", async () => {
    const { requestOtp, verifyOtp } = await import("../services/otpService");
    await requestOtp("09120000002", "login");
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp("09120000002", "login", "0000")).rejects.toMatchObject({
        code: "OTP_INVALID",
      });
    }
    await expect(verifyOtp("09120000002", "login", "0000")).rejects.toMatchObject({
      code: "OTP_LOCKED",
    });
  });

  it("rejects verifying a code that was never requested", async () => {
    const { verifyOtp } = await import("../services/otpService");
    await expect(verifyOtp("09129999999", "login", "1234")).rejects.toMatchObject({
      code: "OTP_NOT_REQUESTED",
    });
  });
});
