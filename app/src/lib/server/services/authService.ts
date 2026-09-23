import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { HydratedDocument } from "mongoose";
import { getEnv } from "../env";
import { AppError } from "../errors/AppError";
import { normalizeIranMobile } from "@fruitland/shared";
import { User, type IUser } from "../models/User";
import { RefreshToken } from "../models/RefreshToken";
import { tryClaimMasterAdmin } from "../models/SystemState";
import { requestOtp, verifyOtp } from "./otpService";
import { comparePassword, hashPassword } from "../auth/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/jwt";

const ADMIN_ROLES_FOR_PASSWORD_LOGIN = ["admin", "master_admin"] as const;

export interface DeviceInfo {
  userAgent?: string;
  ip?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function requirePhone(rawPhone: string): string {
  const phone = normalizeIranMobile(rawPhone);
  if (!phone) throw AppError.badRequest("شماره موبایل معتبر نیست", "INVALID_PHONE_NUMBER");
  return phone;
}

/** Issues a fresh access+refresh token pair and persists the new session (RefreshToken document). */
async function issueTokenPair(user: HydratedDocument<IUser>, device: DeviceInfo): Promise<TokenPair> {
  const env = getEnv();
  const jti = crypto.randomUUID();
  const userId = user._id.toString();

  const accessToken = signAccessToken({ sub: userId, role: user.role });
  const refreshToken = signRefreshToken({ sub: userId, jti });

  await RefreshToken.create({
    userId: user._id,
    jti,
    tokenHash: await bcrypt.hash(refreshToken, env.PASSWORD_HASH_ROUNDS),
    userAgent: device.userAgent,
    ip: device.ip,
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000),
  });

  return { accessToken, refreshToken };
}

/** Step 1 of OTP login/registration: send the code. Same flow for a brand-new phone or a returning one. */
export async function requestLoginOtp(rawPhone: string): Promise<{ phone: string; isNewUser: boolean }> {
  const phone = requirePhone(rawPhone);
  await requestOtp(phone, "login");
  const isNewUser = !(await User.exists({ phone }));
  return { phone, isNewUser };
}

/**
 * Step 2: verifies the code and issues tokens, creating the user on first
 * contact if needed. The very first user ever to complete this in the
 * system's history atomically becomes MASTER_ADMIN (MASTER-PROMPT.md §17) —
 * every other new user is a plain "customer". Promoting a user to "admin"
 * is a separate, explicit MASTER_ADMIN action (not implemented by this
 * flow), never something a user can trigger themselves.
 */
export async function verifyLoginOtpAndIssueTokens(
  rawPhone: string,
  code: string,
  device: DeviceInfo,
): Promise<{ user: HydratedDocument<IUser>; tokens: TokenPair; isNewUser: boolean }> {
  const phone = requirePhone(rawPhone);
  await verifyOtp(phone, "login", code);

  let user = await User.findOne({ phone });
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = await User.create({ phone, role: "customer" });
    const wonMasterAdmin = await tryClaimMasterAdmin(user._id);
    if (wonMasterAdmin) {
      user.role = "master_admin";
    }
  }

  if (!user.isActive) {
    throw AppError.forbidden("حساب کاربری شما غیرفعال شده است", "USER_DEACTIVATED");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokenPair(user, device);
  return { user, tokens, isNewUser };
}

/**
 * Admin/master_admin password login. Deliberately returns the same generic
 * error for "no such user", "wrong role" and "wrong password" so a
 * response can never be used to enumerate phone numbers or roles — the one
 * exception is "no password set yet", which is safe to state plainly since
 * this endpoint is only reachable by staff, not the public.
 */
export async function loginAdminWithPassword(
  rawPhone: string,
  password: string,
  device: DeviceInfo,
): Promise<{ user: HydratedDocument<IUser>; tokens: TokenPair }> {
  const env = getEnv();
  const phone = requirePhone(rawPhone);
  const genericError = () => AppError.unauthorized("شماره تلفن یا رمز عبور اشتباه است", "INVALID_CREDENTIALS");

  const user = await User.findOne({ phone }).select(
    "+passwordHash +passwordFailedAttempts +passwordLockedUntil",
  );

  if (!user || !ADMIN_ROLES_FOR_PASSWORD_LOGIN.includes(user.role as "admin" | "master_admin")) {
    throw genericError();
  }
  if (!user.isActive) {
    throw AppError.forbidden("حساب کاربری شما غیرفعال شده است", "USER_DEACTIVATED");
  }
  if (user.passwordLockedUntil && user.passwordLockedUntil > new Date()) {
    throw AppError.forbidden(
      "به‌دلیل تلاش‌های ناموفق مکرر، ورود با رمز عبور موقتاً قفل شده است. بعداً دوباره تلاش کنید یا با کد پیامکی وارد شوید",
      "PASSWORD_LOGIN_LOCKED",
    );
  }
  if (!user.passwordHash) {
    throw AppError.unauthorized("برای این حساب هنوز رمز عبوری تنظیم نشده است", "NO_PASSWORD_SET");
  }

  const matches = await comparePassword(password, user.passwordHash);
  if (!matches) {
    user.passwordFailedAttempts = (user.passwordFailedAttempts ?? 0) + 1;
    if (user.passwordFailedAttempts >= env.PASSWORD_MAX_FAILED_ATTEMPTS) {
      user.passwordLockedUntil = new Date(Date.now() + env.PASSWORD_LOCK_MINUTES * 60_000);
      user.passwordFailedAttempts = 0;
    }
    await user.save();
    throw genericError();
  }

  user.passwordFailedAttempts = 0;
  user.passwordLockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokenPair(user, device);
  return { user, tokens };
}

/**
 * Rotates a refresh token: the presented token is single-use. If a token
 * that was already revoked gets presented again, that's a signal of theft
 * (someone replayed a stolen/old token) — as a precaution every session for
 * that user is revoked, forcing a fresh login everywhere.
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  device: DeviceInfo,
): Promise<{ user: HydratedDocument<IUser>; tokens: TokenPair }> {
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw AppError.unauthorized("Refresh Token نامعتبر یا منقضی است", "INVALID_REFRESH_TOKEN");
  }

  const record = await RefreshToken.findOne({ jti: payload.jti });
  if (!record) {
    throw AppError.unauthorized("Refresh Token نامعتبر است", "INVALID_REFRESH_TOKEN");
  }

  const matches = await bcrypt.compare(rawRefreshToken, record.tokenHash);
  if (!matches) {
    throw AppError.unauthorized("Refresh Token نامعتبر است", "INVALID_REFRESH_TOKEN");
  }

  if (record.revokedAt) {
    await RefreshToken.updateMany(
      { userId: record.userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    throw AppError.unauthorized("نشست شما به‌دلایل امنیتی باطل شد. دوباره وارد شوید", "REFRESH_TOKEN_REUSED");
  }

  if (record.expiresAt < new Date()) {
    throw AppError.unauthorized("Refresh Token منقضی شده است", "REFRESH_TOKEN_EXPIRED");
  }

  const user = await User.findById(record.userId);
  if (!user || !user.isActive) {
    throw AppError.unauthorized("کاربر یافت نشد یا غیرفعال است", "USER_NOT_FOUND");
  }

  const tokens = await issueTokenPair(user, device);
  const newPayload = verifyRefreshToken(tokens.refreshToken);

  record.revokedAt = new Date();
  record.replacedByJti = newPayload.jti;
  await record.save();

  return { user, tokens };
}

/** Logs out of the session identified by this refresh token only — other devices keep working. Idempotent. */
export async function logout(rawRefreshToken: string): Promise<void> {
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    return;
  }
  await RefreshToken.updateOne({ jti: payload.jti, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/**
 * Always resolves without revealing whether `rawPhone` belongs to an
 * admin account — only actually sends a code when it does. See
 * docs/auth.md for why this is safe to build on the OTP infrastructure.
 */
export async function requestPasswordResetOtp(rawPhone: string): Promise<void> {
  const phone = requirePhone(rawPhone);
  const user = await User.findOne({ phone });
  if (!user || !ADMIN_ROLES_FOR_PASSWORD_LOGIN.includes(user.role as "admin" | "master_admin")) {
    return;
  }
  await requestOtp(phone, "password_reset");
}

/**
 * Confirms a password reset. Because requestPasswordResetOtp() only ever
 * sends a "password_reset" code for an eligible admin phone, verifyOtp()
 * failing with OTP_NOT_REQUESTED already covers the "not an admin" case
 * without this function needing its own enumeration-safe branching.
 * Resetting the password revokes every existing session for the account.
 */
export async function resetPasswordWithOtp(
  rawPhone: string,
  code: string,
  newPassword: string,
): Promise<void> {
  const phone = requirePhone(rawPhone);
  await verifyOtp(phone, "password_reset", code);

  const user = await User.findOne({ phone });
  if (!user) {
    throw AppError.badRequest("ابتدا کد را درخواست کنید", "OTP_NOT_REQUESTED");
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordFailedAttempts = 0;
  user.passwordLockedUntil = undefined;
  await user.save();

  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export interface SessionSummary {
  id: string;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

/** Lists this user's active (non-revoked, non-expired) sessions/devices — this collection IS the session list, see RefreshToken.ts. */
export async function listActiveSessions(userId: string, currentJti?: string): Promise<SessionSummary[]> {
  const records = await RefreshToken.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  return records.map((r) => ({
    id: r._id.toString(),
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    isCurrent: r.jti === currentJti,
  }));
}

/** Revokes one session by id — ownership-checked: a user can only revoke their own sessions. */
export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const record = await RefreshToken.findOne({ _id: sessionId, userId });
  if (!record) {
    throw AppError.notFound("نشست یافت نشد", "SESSION_NOT_FOUND");
  }
  if (!record.revokedAt) {
    record.revokedAt = new Date();
    await record.save();
  }
}

/** "Log out everywhere" — revokes every session for the user except (optionally) the one making this request. */
export async function revokeAllSessions(userId: string, exceptJti?: string): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: null, ...(exceptJti ? { jti: { $ne: exceptJti } } : {}) },
    { $set: { revokedAt: new Date() } },
  );
}
