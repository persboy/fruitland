/**
 * Every server route replies with the { success, data, message, pagination,
 * error } envelope (see app/src/lib/server/apiResponse.ts) — this client
 * mirrors that shape so callers never touch fetch()/Response directly.
 */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message: string | null;
  pagination: unknown | null;
  error: { code: string; message: string } | null;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

const REFRESH_EXEMPT_PATHS = ["/auth/otp/request", "/auth/otp/verify", "/auth/login/password", "/auth/refresh"];

let refreshInFlight: Promise<boolean> | null = null;

/** De-duplicated: concurrent 401s all await the same single refresh call instead of each triggering their own. */
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function doFetch<T>(path: string, options: ApiFetchOptions): Promise<{ status: number; envelope: ApiEnvelope<T> }> {
  const res = await fetch(`/api/v1${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  const envelope = (await res.json()) as ApiEnvelope<T>;
  return { status: res.status, envelope };
}

/**
 * Returns `data` on success. On a 401 that isn't from one of the login/
 * refresh endpoints themselves, tries exactly one silent refresh-and-retry
 * before surfacing the error — so an expired 15-minute access token doesn't
 * interrupt the user mid-session. Never retries more than once.
 */
async function apiRequest<T>(path: string, options: ApiFetchOptions): Promise<ApiEnvelope<T>> {
  let { status, envelope } = await doFetch<T>(path, options);

  if (!envelope.success && envelope.error) {
    const isAuthEndpoint = REFRESH_EXEMPT_PATHS.some((p) => path.startsWith(p));
    const isAuthError =
      envelope.error.code === "INVALID_ACCESS_TOKEN" || envelope.error.code === "UNAUTHENTICATED";

    if (isAuthError && !isAuthEndpoint) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        ({ status, envelope } = await doFetch<T>(path, options));
      }
    }
  }

  if (!envelope.success || envelope.error) {
    throw new ApiClientError(status, envelope.error?.code ?? "UNKNOWN_ERROR", envelope.error?.message ?? "خطای ناشناخته رخ داد");
  }

  return envelope;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return (await apiRequest<T>(path, options)).data as T;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
}

/** Same as apiFetch (same refresh/error handling) but also returns the envelope's `pagination` for paged lists. */
export async function apiFetchPage<T>(path: string, options: ApiFetchOptions = {}): Promise<{ data: T; pagination: PageInfo }> {
  const envelope = await apiRequest<T>(path, options);
  const p = envelope.pagination as PageInfo | null;
  if (!p) throw new ApiClientError(500, "MISSING_PAGINATION", "پاسخ سرور ناقص است");
  return { data: envelope.data as T, pagination: p };
}
