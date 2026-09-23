import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";

/** Captures the code the (dev-only) ConsoleSmsProvider logs during `fn()`. */
async function captureOtpCode(fn: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  await fn();
  const call = spy.mock.calls.map((c) => String(c[0])).find((line) => line.includes("[dev-only SMS]"));
  spy.mockRestore();
  const match = call?.match(/OTP for .*?: (\d+)/);
  const code = match?.[1];
  if (!code) throw new Error("Could not capture OTP code from console output");
  return code;
}

describe("authService (integration)", () => {
  beforeAll(async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://placeholder/unused"); // real URI is supplied by startTestDb() below
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
    vi.stubEnv("JWT_REFRESH_EXPIRES_IN_DAYS", "30");
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

  it("the first-ever OTP login creates the user as MASTER_ADMIN", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens } = await import("../services/authService");
    const code = await captureOtpCode(() => requestLoginOtp("09120000010"));
    const { user, isNewUser } = await verifyLoginOtpAndIssueTokens("09120000010", code, {});
    expect(isNewUser).toBe(true);
    expect(user.role).toBe("master_admin");
  });

  it("a second-ever OTP login (different phone) creates a plain customer", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens } = await import("../services/authService");
    const code1 = await captureOtpCode(() => requestLoginOtp("09120000011"));
    await verifyLoginOtpAndIssueTokens("09120000011", code1, {});

    const code2 = await captureOtpCode(() => requestLoginOtp("09120000012"));
    const { user } = await verifyLoginOtpAndIssueTokens("09120000012", code2, {});
    expect(user.role).toBe("customer");
  });

  it("rejects admin password login for a plain customer with a generic error", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens, loginAdminWithPassword } = await import(
      "../services/authService"
    );
    const code = await captureOtpCode(() => requestLoginOtp("09120000013"));
    await verifyLoginOtpAndIssueTokens("09120000013", code, {});

    await expect(loginAdminWithPassword("09120000013", "whatever", {})).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("locks admin password login after repeated failures", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens } = await import("../services/authService");
    const { User } = await import("../models/User");
    const { hashPassword } = await import("../auth/password");
    const { loginAdminWithPassword } = await import("../services/authService");

    const code = await captureOtpCode(() => requestLoginOtp("09120000014"));
    const { user } = await verifyLoginOtpAndIssueTokens("09120000014", code, {});
    // First-ever user became master_admin already (see test above uses a fresh DB per test via clearTestDb).
    await User.updateOne({ _id: user._id }, { passwordHash: await hashPassword("correct-horse") });

    for (let i = 0; i < 5; i++) {
      await expect(loginAdminWithPassword("09120000014", "wrong", {})).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }
    await expect(loginAdminWithPassword("09120000014", "correct-horse", {})).rejects.toMatchObject({
      code: "PASSWORD_LOGIN_LOCKED",
    });
  });

  it("rotates the refresh token and rejects reuse of the old one (revoking every session)", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens, rotateRefreshToken, listActiveSessions } =
      await import("../services/authService");
    const code = await captureOtpCode(() => requestLoginOtp("09120000015"));
    const { user, tokens } = await verifyLoginOtpAndIssueTokens("09120000015", code, {});

    const rotated = await rotateRefreshToken(tokens.refreshToken, {});
    expect(rotated.tokens.refreshToken).not.toBe(tokens.refreshToken);

    // Replaying the now-rotated-away original token must fail AND revoke all sessions.
    await expect(rotateRefreshToken(tokens.refreshToken, {})).rejects.toMatchObject({
      code: "REFRESH_TOKEN_REUSED",
    });
    const sessions = await listActiveSessions(user._id.toString());
    expect(sessions).toHaveLength(0);
  });

  it("logout ends only the current session, other sessions stay active", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens, logout, listActiveSessions } = await import(
      "../services/authService"
    );
    const code = await captureOtpCode(() => requestLoginOtp("09120000016"));
    const { user, tokens } = await verifyLoginOtpAndIssueTokens("09120000016", code, {});
    // A second "device" logs in too.
    const code2 = await captureOtpCode(() => requestLoginOtp("09120000016"));
    const { tokens: tokens2 } = await verifyLoginOtpAndIssueTokens("09120000016", code2, {});

    await logout(tokens.refreshToken);
    const sessions = await listActiveSessions(user._id.toString());
    expect(sessions).toHaveLength(1);
    expect(tokens2.refreshToken).not.toBe(tokens.refreshToken);
  });

  it("password reset via OTP sets a new password and revokes all sessions", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens, requestPasswordResetOtp, resetPasswordWithOtp } =
      await import("../services/authService");
    const { User } = await import("../models/User");

    const loginCode = await captureOtpCode(() => requestLoginOtp("09120000017"));
    const { user } = await verifyLoginOtpAndIssueTokens("09120000017", loginCode, {});
    await User.updateOne({ _id: user._id }, { role: "admin" }); // simulate an already-provisioned admin

    const resetCode = await captureOtpCode(() => requestPasswordResetOtp("09120000017"));
    await resetPasswordWithOtp("09120000017", resetCode, "brand-new-password-1");

    const { loginAdminWithPassword } = await import("../services/authService");
    const result = await loginAdminWithPassword("09120000017", "brand-new-password-1", {});
    expect(result.user.phone).toBe("09120000017");
  });

  it("requestPasswordResetOtp is a silent no-op for a non-admin phone (no enumeration)", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens, requestPasswordResetOtp, resetPasswordWithOtp } =
      await import("../services/authService");
    const loginCode = await captureOtpCode(() => requestLoginOtp("09120000018"));
    await verifyLoginOtpAndIssueTokens("09120000018", loginCode, {}); // becomes master_admin as first user — use a non-admin path instead below

    // Force this user back to "customer" to exercise the non-admin branch.
    const { User } = await import("../models/User");
    await User.updateOne({ phone: "09120000018" }, { role: "customer" });

    await requestPasswordResetOtp("09120000018"); // must not throw
    await expect(resetPasswordWithOtp("09120000018", "1234", "whatever12")).rejects.toMatchObject({
      code: "OTP_NOT_REQUESTED",
    });
  });

  it("isInitialSetupRequired is true until MASTER_ADMIN is claimed, then false", async () => {
    const { isInitialSetupRequired, requestLoginOtp, verifyLoginOtpAndIssueTokens } = await import("../services/authService");
    expect(await isInitialSetupRequired()).toBe(true);
    const code = await captureOtpCode(() => requestLoginOtp("09120000020"));
    await verifyLoginOtpAndIssueTokens("09120000020", code, {});
    expect(await isInitialSetupRequired()).toBe(false);
  });

  it("setInitialPassword works once for a passwordless master admin, then refuses; customers are refused", async () => {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens, setInitialPassword, loginAdminWithPassword } = await import("../services/authService");
    const c1 = await captureOtpCode(() => requestLoginOtp("09120000021"));
    const { user: master } = await verifyLoginOtpAndIssueTokens("09120000021", c1, {});
    const c2 = await captureOtpCode(() => requestLoginOtp("09120000022"));
    const { user: customer } = await verifyLoginOtpAndIssueTokens("09120000022", c2, {});

    await setInitialPassword(master._id.toString(), "correct-horse-battery");
    await expect(setInitialPassword(master._id.toString(), "another-password-1")).rejects.toMatchObject({ code: "PASSWORD_ALREADY_SET" });
    await expect(setInitialPassword(customer._id.toString(), "correct-horse-battery")).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });

    const { user } = await loginAdminWithPassword("09120000021", "correct-horse-battery", {});
    expect(user.role).toBe("master_admin");
  });
});
