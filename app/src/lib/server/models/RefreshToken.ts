import { Schema, model, models, Types, Model } from "mongoose";
import { createdAtOnlySchemaOptions } from "./schemaUtils";

/**
 * One document per issued refresh token = one "session"/device. This is
 * what makes both reuse-detection (theft protection, see docs/auth.md) and
 * the "active devices" list/revoke feature possible without extra
 * modeling — the collection already IS the session list.
 */

export interface IRefreshToken {
  userId: Types.ObjectId;
  /** JWT id claim — how we look up the record from a presented token without scanning by hash. */
  jti: string;
  /** bcrypt hash of the raw refresh token string, never the raw token itself. */
  tokenHash: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date;
  /** Set when rotation replaces this token — lets reuse-detection distinguish "expected old token" from "stolen token replayed". */
  replacedByJti?: string;
  /** Mongoose-managed (createdAtOnlySchemaOptions) — not one of the fields below, but real on every document. */
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jti: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedByJti: { type: String },
  },
  createdAtOnlySchemaOptions,
);

// TTL index: the document is dropped automatically once expiresAt passes.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });

export const RefreshToken =
  (models.RefreshToken as Model<IRefreshToken> | undefined) ||
  model<IRefreshToken>("RefreshToken", refreshTokenSchema);
