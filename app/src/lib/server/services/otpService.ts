import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { OtpPurpose } from "@fruitland/shared";
import { getEnv } from "../env";
import { AppError } from "../errors/AppError";
import { Otp } from "../models/Otp";
import { getSmsProvider } from "./sms";

function generateNumericCode(length: number): string {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, "0");
}

/**
 * Requests a new OTP code for (phone, purpose). Enforces, in order: an
 * active lockout from too many failed verify attempts, a resend cooldown,
 * and an hourly request cap. One record per (phone, purpose) is reused —
 * a new request overwrites the previous code.
 */
export async function requestOtp(phone: string, purpose: OtpPurpose): Promise<void> {
  const env = getEnv();
  const now = new Date();
  const existing = await Otp.findOne({ phone, purpose });

  if (existing?.lockedUntil && existing.lockedUntil > now) {
    const waitMinutes = Math.ceil((existing.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw AppError.tooManyRequests(
      `به‌دلیل تلاش‌های ناموفق متعدد، ${waitMinutes} دقیقه دیگر تلاش کنید`,
      "OTP_LOCKED",
    );
  }

  if (existing) {
    const secondsSinceLastRequest = (now.getTime() - existing.requestedAt.getTime()) / 1000;
    if (secondsSinceLastRequest < env.OTP_RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastRequest);
      throw AppError.tooManyRequests(`لطفاً ${wait} ثانیه دیگر دوباره تلاش کنید`, "OTP_RESEND_COOLDOWN");
    }

    const windowExpired = now.getTime() - existing.windowStartedAt.getTime() > 60 * 60 * 1000;
    if (!windowExpired && existing.requestCountInWindow >= env.OTP_MAX_REQUESTS_PER_HOUR) {
      throw AppError.tooManyRequests(
        "تعداد درخواست کد در این ساعت بیش از حد مجاز است",
        "OTP_HOURLY_LIMIT_EXCEEDED",
      );
    }

    const code = generateNumericCode(env.OTP_LENGTH);
    existing.codeHash = await bcrypt.hash(code, env.PASSWORD_HASH_ROUNDS);
    existing.expiresAt = new Date(now.getTime() + env.OTP_EXPIRES_IN_SECONDS * 1000);
    existing.verifyAttempts = 0;
    existing.lockedUntil = undefined;
    existing.consumedAt = undefined;
    existing.requestedAt = now;
    existing.requestCountInWindow = windowExpired ? 1 : existing.requestCountInWindow + 1;
    existing.windowStartedAt = windowExpired ? now : existing.windowStartedAt;
    await existing.save();
    await getSmsProvider().sendOtp(phone, code);
    return;
  }

  const code = generateNumericCode(env.OTP_LENGTH);
  await Otp.create({
    phone,
    purpose,
    codeHash: await bcrypt.hash(code, env.PASSWORD_HASH_ROUNDS),
    expiresAt: new Date(now.getTime() + env.OTP_EXPIRES_IN_SECONDS * 1000),
    requestedAt: now,
    windowStartedAt: now,
  });
  await getSmsProvider().sendOtp(phone, code);
}

/** Verifies a submitted code for (phone, purpose). Throws on any failure; returns normally on success and marks the code consumed. */
export async function verifyOtp(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
  const env = getEnv();
  const now = new Date();
  const record = await Otp.findOne({ phone, purpose });

  if (!record) {
    throw AppError.badRequest("ابتدا کد را درخواست کنید", "OTP_NOT_REQUESTED");
  }
  if (record.lockedUntil && record.lockedUntil > now) {
    const waitMinutes = Math.ceil((record.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw AppError.tooManyRequests(
      `به‌دلیل تلاش‌های ناموفق متعدد، ${waitMinutes} دقیقه دیگر تلاش کنید`,
      "OTP_LOCKED",
    );
  }
  if (record.consumedAt) {
    throw AppError.badRequest("این کد قبلاً استفاده شده است", "OTP_ALREADY_USED");
  }
  if (record.expiresAt < now) {
    throw AppError.badRequest("کد وارد‌شده منقضی شده است", "OTP_EXPIRED");
  }

  const matches = await bcrypt.compare(code, record.codeHash);
  if (!matches) {
    record.verifyAttempts += 1;
    if (record.verifyAttempts >= env.OTP_MAX_VERIFY_ATTEMPTS) {
      record.lockedUntil = new Date(now.getTime() + env.OTP_LOCK_MINUTES_AFTER_MAX_ATTEMPTS * 60_000);
    }
    await record.save();
    throw AppError.badRequest("کد وارد‌شده نادرست است", "OTP_INVALID");
  }

  record.consumedAt = now;
  await record.save();
}
