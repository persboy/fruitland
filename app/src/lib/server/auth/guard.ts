import type { NextRequest } from "next/server";
import type { UserRole } from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { verifyAccessToken } from "./jwt";
import { ACCESS_TOKEN_COOKIE } from "./cookies";

export interface AuthContext {
  userId: string;
  role: UserRole;
}

function extractAccessToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

/** Throws AppError.unauthorized if there is no valid access token on the request. */
export function requireAuth(request: NextRequest): AuthContext {
  const token = extractAccessToken(request);
  if (!token) {
    throw AppError.unauthorized("لازم است وارد حساب کاربری خود شوید", "UNAUTHENTICATED");
  }
  try {
    const payload = verifyAccessToken(token);
    return { userId: payload.sub, role: payload.role };
  } catch {
    throw AppError.unauthorized("نشست شما نامعتبر یا منقضی شده است", "INVALID_ACCESS_TOKEN");
  }
}

/** Throws AppError.forbidden if the authenticated user's role is not in `roles`. Call after requireAuth(). */
export function requireRole(context: AuthContext, roles: UserRole[]): void {
  if (!roles.includes(context.role)) {
    throw AppError.forbidden("شما اجازه‌ی دسترسی به این بخش را ندارید", "FORBIDDEN_ROLE");
  }
}

/** Shortcut for every /admin/* route: authenticated AND role admin/master_admin. No granular permissions are approved yet — role alone gates the admin area. */
export function requireAdmin(request: NextRequest): AuthContext {
  const context = requireAuth(request);
  requireRole(context, ["admin", "master_admin"]);
  return context;
}
