import jwt from "jsonwebtoken";
import type { UserRole } from "@fruitland/shared";
import { getEnv } from "../env";

/**
 * `role` is embedded directly in the access token (short-lived) rather than
 * re-read from the database on every request. If MASTER_ADMIN changes a
 * user's role, that user keeps acting under the old role until their
 * current access token expires/refreshes (at most JWT_ACCESS_EXPIRES_IN) —
 * refresh always re-reads the user from the database, so this is a short
 * propagation delay, not a lasting security hole.
 */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getEnv().JWT_ACCESS_SECRET, {
    expiresIn: getEnv().JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, getEnv().JWT_ACCESS_SECRET) as unknown as AccessTokenPayload;
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, getEnv().JWT_REFRESH_SECRET, {
    expiresIn: `${getEnv().JWT_REFRESH_EXPIRES_IN_DAYS}d`,
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, getEnv().JWT_REFRESH_SECRET) as unknown as RefreshTokenPayload;
}
