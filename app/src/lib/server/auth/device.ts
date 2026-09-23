import type { NextRequest } from "next/server";
import type { DeviceInfo } from "../services/authService";

export function deviceFromRequest(request: NextRequest): DeviceInfo {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return {
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: forwardedFor?.split(",")[0]?.trim() ?? undefined,
  };
}
