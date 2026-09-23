import type { NextResponse } from "next/server";
import { getEnv } from "../env";

export const ACCESS_TOKEN_COOKIE = "fruitland_access_token";
export const REFRESH_TOKEN_COOKIE = "fruitland_refresh_token";

/**
 * Tokens are delivered two ways at once: httpOnly cookies (for admin pages
 * rendered/fetched from the browser) and in the JSON response body (for a
 * separate mobile/app client that manages its own storage) — see
 * docs/auth.md. Neither delivery is authoritative over the other; a client
 * uses whichever fits it.
 */
export function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const isProd = getEnv().NODE_ENV === "production";
  const refreshMaxAgeSeconds = getEnv().JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60;

  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60, // matches the default JWT_ACCESS_EXPIRES_IN (15m); the token itself is still the source of truth for expiry
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: refreshMaxAgeSeconds,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
}
