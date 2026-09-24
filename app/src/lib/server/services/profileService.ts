import type { HydratedDocument } from "mongoose";
import { normalizeIranMobile } from "@fruitland/shared";
import { getEnv } from "../env";
import { AppError } from "../errors/AppError";
import { comparePassword, hashPassword } from "../auth/password";
import { AuditLog } from "../models/AuditLog";
import { User, type IUser } from "../models/User";
import { requestOtp, verifyOtp } from "./otpService";

async function loadAdmin(userId: string, select = ""): Promise<HydratedDocument<IUser>> {
  const user = await User.findById(userId).select(select);
  if (!user) throw AppError.notFound("کاربر یافت نشد", "USER_NOT_FOUND");
  if (user.role !== "admin" && user.role !== "master_admin") {
    throw AppError.forbidden("شما اجازه‌ی دسترسی به این بخش را ندارید", "FORBIDDEN_ROLE");
  }
  return user;
}

function requireNewPhone(rawPhone: string): string {
  const phone = normalizeIranMobile(rawPhone);
  if (!phone) throw AppError.badRequest("شماره موبایل معتبر نیست", "INVALID_PHONE_NUMBER");
  return phone;
}

export async function updateOwnName(userId: string, input: { firstName: string; lastName: string }) {
  const user = await loadAdmin(userId);
  user.firstName = input.firstName || undefined;
  user.lastName = input.lastName || undefined;
  await user.save();
  return user;
}

/**
 * Step 1 of changing the admin's own phone (= their login identifier): sends
 * an OTP to the NEW number, so the new number is proven to be theirs before it
 * can replace the old one (approved decision — unlike the legacy project).
 */
export async function requestOwnPhoneChange(userId: string, rawNewPhone: string): Promise<void> {
  const user = await loadAdmin(userId);
  const newPhone = requireNewPhone(rawNewPhone);
  if (newPhone === user.phone) {
    throw AppError.badRequest("این شماره همان شماره‌ی فعلی شماست", "PHONE_UNCHANGED");
  }
  if (await User.exists({ phone: newPhone })) {
    throw AppError.conflict("این شماره قبلاً در سیستم ثبت شده است", "PHONE_ALREADY_REGISTERED");
  }
  await requestOtp(newPhone, "phone_change");
}

/** Step 2: verifies the OTP sent to the new number, then swaps the phone (audited). */
export async function confirmOwnPhoneChange(userId: string, rawNewPhone: string, code: string) {
  const user = await loadAdmin(userId);
  const newPhone = requireNewPhone(rawNewPhone);
  if (newPhone === user.phone) {
    throw AppError.badRequest("این شماره همان شماره‌ی فعلی شماست", "PHONE_UNCHANGED");
  }

  await verifyOtp(newPhone, "phone_change", code);

  const oldPhone = user.phone;
  user.phone = newPhone;
  try {
    await user.save();
  } catch (err) {
    // The unique index is the real guard against a race with another registration.
    if ((err as { code?: number }).code === 11000) {
      throw AppError.conflict("این شماره قبلاً در سیستم ثبت شده است", "PHONE_ALREADY_REGISTERED");
    }
    throw err;
  }

  await AuditLog.create({
    actorUserId: user._id,
    action: "admin.profile.phone_changed",
    entityType: "User",
    entityId: user._id,
    before: { phone: oldPhone },
    after: { phone: newPhone },
  });
  return user;
}

/**
 * Sets the admin's password. When one already exists, the current password is
 * required and wrong guesses feed the same lockout counter as login (a stolen
 * session must not be able to brute-force it). An account with no password yet
 * (e.g. the first MASTER_ADMIN, who signed in by SMS code) sets it directly.
 */
export async function changeOwnPassword(
  userId: string,
  input: { currentPassword?: string; newPassword: string },
): Promise<void> {
  const env = getEnv();
  const user = await loadAdmin(userId, "+passwordHash +passwordFailedAttempts +passwordLockedUntil");

  if (user.passwordHash) {
    if (user.passwordLockedUntil && user.passwordLockedUntil > new Date()) {
      throw AppError.forbidden(
        "به‌دلیل تلاش‌های ناموفق مکرر، تغییر رمز عبور موقتاً قفل شده است. بعداً دوباره تلاش کنید",
        "PASSWORD_LOCKED",
      );
    }
    if (!input.currentPassword) {
      throw AppError.badRequest("رمز عبور فعلی را وارد کنید", "CURRENT_PASSWORD_REQUIRED");
    }
    if (!(await comparePassword(input.currentPassword, user.passwordHash))) {
      user.passwordFailedAttempts = (user.passwordFailedAttempts ?? 0) + 1;
      if (user.passwordFailedAttempts >= env.PASSWORD_MAX_FAILED_ATTEMPTS) {
        user.passwordLockedUntil = new Date(Date.now() + env.PASSWORD_LOCK_MINUTES * 60_000);
        user.passwordFailedAttempts = 0;
      }
      await user.save();
      throw AppError.forbidden("رمز عبور فعلی نادرست است", "CURRENT_PASSWORD_INVALID");
    }
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.passwordFailedAttempts = 0;
  user.passwordLockedUntil = undefined;
  await user.save();

  await AuditLog.create({
    actorUserId: user._id,
    action: "admin.profile.password_changed",
    entityType: "User",
    entityId: user._id,
  });
}
