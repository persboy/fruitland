import { Schema, model, models, Model } from "mongoose";
import { OTP_PURPOSES, type OtpPurpose } from "@fruitland/shared";
import { createdAtOnlySchemaOptions } from "./schemaUtils";

/**
 * Numeric policy (length/expiry/cooldown/rate-limit) lives in env vars with
 * defaults matching the values already proven in the legacy system — see
 * docs/auth.md. The code itself is stored hashed (`codeHash`), never in
 * plaintext, same reasoning as a password.
 */

export interface IOtp {
  phone: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  verifyAttempts: number;
  lockedUntil?: Date;
  consumedAt?: Date;
  requestedAt: Date;
  requestCountInWindow: number;
  windowStartedAt: Date;
}

const otpSchema = new Schema<IOtp>(
  {
    phone: { type: String, required: true, index: true },
    purpose: { type: String, enum: OTP_PURPOSES, required: true, default: "login" },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    verifyAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    consumedAt: { type: Date },
    requestedAt: { type: Date, required: true, default: () => new Date() },
    requestCountInWindow: { type: Number, default: 1 },
    windowStartedAt: { type: Date, required: true, default: () => new Date() },
  },
  createdAtOnlySchemaOptions,
);

// One active record per (phone, purpose) — a new request overwrites the previous one.
otpSchema.index({ phone: 1, purpose: 1 }, { unique: true });
// Auto-cleanup: a record is dropped 1 hour after its code expires.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const Otp = (models.Otp as Model<IOtp> | undefined) || model<IOtp>("Otp", otpSchema);
