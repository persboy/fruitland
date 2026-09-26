import { AppError } from "../errors/AppError";
import { MapProviderError, type MapErrorCode } from "./errors";

/** HTTP status + AppError code for every MapProviderError code (MASTER-PROMPT map spec §8/§26). */
const STATUS_BY_CODE: Record<MapErrorCode, { status: number; code: string }> = {
  INVALID_REQUEST: { status: 400, code: "MAP_INVALID_REQUEST" },
  UNSUPPORTED_OPERATION: { status: 400, code: "MAP_UNSUPPORTED_OPERATION" },
  NO_RESULT: { status: 404, code: "MAP_NO_RESULT" },
  RATE_LIMIT: { status: 429, code: "MAP_PROVIDER_RATE_LIMIT" },
  // These three are upstream/config problems, not the caller's fault — never 401/403 (that would wrongly imply
  // the API's own user needs to log in or lacks permission).
  AUTH_FAILED: { status: 502, code: "MAP_PROVIDER_AUTH_FAILED" },
  NETWORK: { status: 502, code: "MAP_PROVIDER_NETWORK_ERROR" },
  INVALID_RESPONSE: { status: 502, code: "MAP_PROVIDER_INVALID_RESPONSE" },
  PROVIDER_UNAVAILABLE: { status: 502, code: "MAP_PROVIDER_UNAVAILABLE" },
  TIMEOUT: { status: 504, code: "MAP_PROVIDER_TIMEOUT" },
};

const MESSAGES: Record<MapErrorCode, string> = {
  INVALID_REQUEST: "درخواست نامعتبر است",
  UNSUPPORTED_OPERATION: "این عملیات توسط سرویس نقشه پشتیبانی نمی‌شود",
  NO_RESULT: "نتیجه‌ای یافت نشد",
  RATE_LIMIT: "سرویس نقشه موقتاً پرترافیک است. کمی بعد دوباره تلاش کنید",
  AUTH_FAILED: "سرویس نقشه در دسترس نیست",
  NETWORK: "ارتباط با سرویس نقشه برقرار نشد",
  INVALID_RESPONSE: "سرویس نقشه پاسخ نامعتبر داد",
  PROVIDER_UNAVAILABLE: "سرویس نقشه موقتاً در دسترس نیست",
  TIMEOUT: "دریافت پاسخ از سرویس نقشه بیش از حد طول کشید",
};

/**
 * Route handlers call this in their catch block before apiErrorFromException.
 * A MapProviderError becomes the matching AppError (never leaking provider,
 * URL, header or key details — MapProviderError.toSafeJSON() already excludes
 * them, and this only reads `.code`); anything else passes through unchanged
 * so apiErrorFromException's existing AppError/unexpected-error handling applies.
 */
export function translateMapError(err: unknown): unknown {
  if (!(err instanceof MapProviderError)) return err;
  const { status, code } = STATUS_BY_CODE[err.code];
  return new AppError(status, code, MESSAGES[err.code]);
}
