import type { MapProviderName } from "@fruitland/shared";
import { MapProviderError, errorFromHttpStatus, mapError, type MapOperation } from "./errors";

export interface RequestJsonOptions {
  provider: MapProviderName;
  operation: MapOperation;
  url: string;
  headers: Record<string, string>;
  /** Every provider call has a hard timeout (MAP_REQUEST_TIMEOUT_MS) — there is no call without one. */
  timeoutMs: number;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Provider-specific HTTP status → error (e.g. Neshan's 480–483). Return null to use the generic mapping. */
  mapHttpError?: (status: number) => MapProviderError | null;
}

/**
 * GET + JSON with timeout and normalized errors. Errors carry only
 * provider/operation/code — never the URL, headers or body — so an API key
 * (header or query) cannot leak through an error, a log line or an API response.
 */
export async function requestJson(options: RequestJsonOptions): Promise<unknown> {
  const { provider, operation } = options;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(options.url, {
      method: "GET",
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw mapError(provider, operation, "TIMEOUT");
    throw mapError(provider, operation, "NETWORK");
  }

  if (!response.ok) {
    throw options.mapHttpError?.(response.status) ?? errorFromHttpStatus(provider, operation, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw mapError(provider, operation, "INVALID_RESPONSE");
  }
}
