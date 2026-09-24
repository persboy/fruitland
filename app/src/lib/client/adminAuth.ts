import { ApiClientError, apiFetch } from "./apiClient";

export interface SessionUser {
  displayName?: string;
  phone: string;
  role: string;
}

export const ADMIN_ROLES = ["admin", "master_admin"] as const;

export function isAdminRole(role: string | undefined): boolean {
  return role !== undefined && (ADMIN_ROLES as readonly string[]).includes(role);
}

export const ROLE_LABELS: Record<string, string> = {
  master_admin: "مدیر ارشد",
  admin: "ادمین",
};

/** Persian message for any thrown value: API errors carry a server message, anything else is a network failure. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return "ارتباط با سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید";
}

/** Only same-app /admin paths are honored, so returnTo can never become an open redirect. */
export function safeReturnTo(returnTo: string | null): string {
  return returnTo && returnTo.startsWith("/admin") && !returnTo.startsWith("//") ? returnTo : "/admin";
}

export const fetchCurrentUser = () => apiFetch<SessionUser>("/auth/me");
export const loginWithPassword = (phone: string, password: string) =>
  apiFetch<{ user: SessionUser }>("/auth/login/password", { method: "POST", body: { phone, password } });
export const requestOtp = (phone: string) =>
  apiFetch<{ phone: string }>("/auth/otp/request", { method: "POST", body: { phone } });
export const verifyOtp = (phone: string, code: string) =>
  apiFetch<{ user: SessionUser }>("/auth/otp/verify", { method: "POST", body: { phone, code } });
export const logoutCurrentSession = () => apiFetch<null>("/auth/logout", { method: "POST" });
