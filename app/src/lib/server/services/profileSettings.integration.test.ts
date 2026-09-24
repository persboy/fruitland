import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";

async function captureOtpCode(fn: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  await fn();
  const call = spy.mock.calls.map((c) => String(c[0])).find((line) => line.includes("[dev-only SMS]"));
  spy.mockRestore();
  const code = call?.match(/OTP for .*?: (\d+)/)?.[1];
  if (!code) throw new Error("Could not capture OTP code from console output");
  return code;
}

describe("profileService + settingsService (integration)", () => {
  beforeAll(async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://placeholder/unused");
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

  /** First OTP login on an empty DB → MASTER_ADMIN with no password. */
  async function createMasterAdmin(phone = "09120000100") {
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens } = await import("./authService");
    const code = await captureOtpCode(() => requestLoginOtp(phone));
    return (await verifyLoginOtpAndIssueTokens(phone, code, {})).user;
  }

  it("phone change: OTP goes to the new number, phone is swapped and audited", async () => {
    const { requestOwnPhoneChange, confirmOwnPhoneChange } = await import("./profileService");
    const { AuditLog } = await import("../models/AuditLog");
    const admin = await createMasterAdmin();
    const code = await captureOtpCode(() => requestOwnPhoneChange(admin._id.toString(), "09120000101"));
    const updated = await confirmOwnPhoneChange(admin._id.toString(), "09120000101", code);
    expect(updated.phone).toBe("09120000101");
    const log = await AuditLog.findOne({ action: "admin.profile.phone_changed" });
    expect(log?.before).toEqual({ phone: "09120000100" });
    expect(log?.after).toEqual({ phone: "09120000101" });
  });

  it("phone change: refuses the current number, an already-registered number, and a wrong code", async () => {
    const { requestOwnPhoneChange, confirmOwnPhoneChange } = await import("./profileService");
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens } = await import("./authService");
    const admin = await createMasterAdmin();
    const c = await captureOtpCode(() => requestLoginOtp("09120000102"));
    await verifyLoginOtpAndIssueTokens("09120000102", c, {}); // a customer now owns …102

    await expect(requestOwnPhoneChange(admin._id.toString(), "09120000100")).rejects.toMatchObject({ code: "PHONE_UNCHANGED" });
    await expect(requestOwnPhoneChange(admin._id.toString(), "09120000102")).rejects.toMatchObject({ code: "PHONE_ALREADY_REGISTERED" });

    await captureOtpCode(() => requestOwnPhoneChange(admin._id.toString(), "09120000103"));
    await expect(confirmOwnPhoneChange(admin._id.toString(), "09120000103", "0000")).rejects.toMatchObject({ code: "OTP_INVALID" });
  });

  it("customers cannot use the admin profile services", async () => {
    const { updateOwnName } = await import("./profileService");
    const { requestLoginOtp, verifyLoginOtpAndIssueTokens } = await import("./authService");
    await createMasterAdmin();
    const c = await captureOtpCode(() => requestLoginOtp("09120000104"));
    const { user: customer } = await verifyLoginOtpAndIssueTokens("09120000104", c, {});
    await expect(updateOwnName(customer._id.toString(), { firstName: "a", lastName: "b" })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("password: first one is set directly; changing it then needs (and locks on) the current password", async () => {
    const { changeOwnPassword } = await import("./profileService");
    const { loginAdminWithPassword } = await import("./authService");
    const admin = await createMasterAdmin();
    const id = admin._id.toString();

    await changeOwnPassword(id, { newPassword: "first-password-1" });
    await expect(changeOwnPassword(id, { newPassword: "second-password-2" })).rejects.toMatchObject({ code: "CURRENT_PASSWORD_REQUIRED" });
    await expect(changeOwnPassword(id, { currentPassword: "wrong", newPassword: "second-password-2" })).rejects.toMatchObject({
      code: "CURRENT_PASSWORD_INVALID",
    });
    await changeOwnPassword(id, { currentPassword: "first-password-1", newPassword: "second-password-2" });
    const { user } = await loginAdminWithPassword("09120000100", "second-password-2", {});
    expect(user.role).toBe("master_admin");
  });

  it("settings: unconfigured until first save; saves are upserts, audited, and reject non-integer Toman at the DB level", async () => {
    const svc = await import("./settingsService");
    const { AuditLog } = await import("../models/AuditLog");
    const admin = await createMasterAdmin();
    const id = admin._id.toString();

    expect(await svc.getShippingSettings()).toEqual({ expressDeliveryFee: null, freeDeliveryThreshold: null, isConfigured: false });
    expect((await svc.getStoreSettings()).isConfigured).toBe(false);

    await svc.updateShippingSettings(id, { expressDeliveryFee: 30000, freeDeliveryThreshold: 500000 });
    await svc.updateShippingSettings(id, { expressDeliveryFee: 35000, freeDeliveryThreshold: 600000 });
    expect(await svc.getShippingSettings()).toEqual({ expressDeliveryFee: 35000, freeDeliveryThreshold: 600000, isConfigured: true });
    const logs = await AuditLog.find({ action: "settings.shipping_updated" }).sort({ createdAt: 1 });
    expect(logs).toHaveLength(2);
    expect(logs[1]?.before).toEqual({ expressDeliveryFee: 30000, freeDeliveryThreshold: 500000 });

    await expect(svc.updateShippingSettings(id, { expressDeliveryFee: 100.5, freeDeliveryThreshold: 1 })).rejects.toThrow();

    await svc.updateStoreSettings(id, { storeName: "پرزبوی", supportPhone: "02412345678", address: "" });
    expect(await svc.getStoreSettings()).toEqual({ storeName: "پرزبوی", supportPhone: "02412345678", address: "", isConfigured: true });
  });
});
