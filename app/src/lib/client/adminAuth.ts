import { ApiClientError, apiFetch } from "./apiClient";

export interface SessionUser {
  name?: string;
  phone: string;
  role: string;
}

export const ADMIN_ROLES = ["admin", "master_admin"] as const;

export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export const ROLE_LABELS: Record<string, string> = {
  master_admin: "مدیر ارشد",
  admin: "مدیر",
};

/** Persian message for any thrown value: API errors carry a server message, anything else is a network failure. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return "ارتباط با سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید";
}

export const fetchCurrentUser = () => apiFetch<SessionUser>("/auth/me");
export const fetchSetupStatus = () => apiFetch<{ setupRequired: boolean }>("/auth/setup-status");
export const loginWithPassword = (phone: string, password: string) =>
  apiFetch<{ user: SessionUser }>("/auth/login/password", { method: "POST", body: { phone, password } });
export const requestPasswordReset = (phone: string) =>
  apiFetch<null>("/auth/password-reset/request", { method: "POST", body: { phone } });
export const confirmPasswordReset = (phone: string, code: string, newPassword: string) =>
  apiFetch<null>("/auth/password-reset/confirm", { method: "POST", body: { phone, code, newPassword } });
export const requestSetupOtp = (phone: string) =>
  apiFetch<{ phone: string }>("/auth/otp/request", { method: "POST", body: { phone } });
export const verifySetupOtp = (phone: string, code: string) =>
  apiFetch<{ user: SessionUser }>("/auth/otp/verify", { method: "POST", body: { phone, code } });
export const setInitialPassword = (newPassword: string) =>
  apiFetch<null>("/auth/password/setup", { method: "POST", body: { newPassword } });
export const logoutCurrentSession = () => apiFetch<null>("/auth/logout", { method: "POST" });
