import type { MapProviderName } from "@fruitland/shared";

export type MapOperation = "reverseGeocode" | "geocode" | "searchPlaces" | "getRoute" | "getRouteMatrix";

export const MAP_ERROR_CODES = [
  "INVALID_REQUEST", // bad coordinates / parameters (our side or rejected by provider) — never retried
  "AUTH_FAILED", // missing / invalid / restricted API key — never retried, never falls back
  "RATE_LIMIT", // provider quota or rate limit hit
  "TIMEOUT", // no answer within MAP_REQUEST_TIMEOUT_MS
  "NETWORK", // connection-level failure
  "PROVIDER_UNAVAILABLE", // provider 5xx / temporarily down
  "NO_RESULT", // reverse geocode found nothing at that point
  "INVALID_RESPONSE", // provider answered 2xx but with an unusable body
  "UNSUPPORTED_OPERATION", // provider does not offer this capability (see capabilities)
] as const;
export type MapErrorCode = (typeof MAP_ERROR_CODES)[number];

/** Codes worth retrying against the SAME provider (matches the documented example: RATE_LIMIT is retryable). */
const RETRYABLE: ReadonlySet<MapErrorCode> = new Set(["TIMEOUT", "NETWORK", "PROVIDER_UNAVAILABLE", "RATE_LIMIT"]);

/**
 * Codes for which switching to the fallback provider makes sense: the provider
 * is temporarily unreachable. Deliberately excludes AUTH_FAILED and
 * INVALID_REQUEST (a different provider would not fix them and could hide a
 * misconfiguration) and RATE_LIMIT (not on the approved fallback list).
 */
const FALLBACK_ELIGIBLE: ReadonlySet<MapErrorCode> = new Set(["TIMEOUT", "NETWORK", "PROVIDER_UNAVAILABLE"]);

export interface MapProviderErrorInit {
  provider: MapProviderName;
  operation: MapOperation;
  code: MapErrorCode;
  message: string;
  /** Overrides the default derived from `code`. */
  retryable?: boolean;
}

/**
 * The only error a provider adapter may throw. Provider-specific errors are
 * normalized into this; it carries no raw response, URL, or header, so it is
 * safe to log and to return through the API (API keys can never leak via it).
 */
export class MapProviderError extends Error {
  readonly provider: MapProviderName;
  readonly operation: MapOperation;
  readonly code: MapErrorCode;
  readonly retryable: boolean;

  constructor(init: MapProviderErrorInit) {
    super(init.message);
    this.name = "MapProviderError";
    this.provider = init.provider;
    this.operation = init.operation;
    this.code = init.code;
    this.retryable = init.retryable ?? RETRYABLE.has(init.code);
  }

  get fallbackEligible(): boolean {
    return FALLBACK_ELIGIBLE.has(this.code);
  }

  toSafeJSON() {
    return {
      provider: this.provider,
      operation: this.operation,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

const MESSAGES: Record<MapErrorCode, string> = {
  INVALID_REQUEST: "Provider rejected the request as invalid",
  AUTH_FAILED: "Provider authentication failed (check the API key and its restrictions)",
  RATE_LIMIT: "Provider rate limit reached",
  TIMEOUT: "Provider request timed out",
  NETWORK: "Provider could not be reached",
  PROVIDER_UNAVAILABLE: "Provider is temporarily unavailable",
  NO_RESULT: "Provider found no result",
  INVALID_RESPONSE: "Provider returned an unusable response",
  UNSUPPORTED_OPERATION: "Provider does not support this operation",
};

export function mapError(provider: MapProviderName, operation: MapOperation, code: MapErrorCode, message?: string) {
  return new MapProviderError({ provider, operation, code, message: message ?? MESSAGES[code] });
}

/** HTTP status → normalized error. Used by every adapter so the mapping is identical across providers. */
export function errorFromHttpStatus(provider: MapProviderName, operation: MapOperation, status: number): MapProviderError {
  if (status === 401 || status === 403) return mapError(provider, operation, "AUTH_FAILED");
  if (status === 429) return mapError(provider, operation, "RATE_LIMIT");
  if (status === 404) return mapError(provider, operation, "NO_RESULT");
  if (status >= 500) return mapError(provider, operation, "PROVIDER_UNAVAILABLE");
  if (status >= 400) return mapError(provider, operation, "INVALID_REQUEST");
  return mapError(provider, operation, "INVALID_RESPONSE", `Provider returned unexpected HTTP ${status}`);
}

export const unsupportedOperation = (provider: MapProviderName, operation: MapOperation) =>
  mapError(provider, operation, "UNSUPPORTED_OPERATION");
