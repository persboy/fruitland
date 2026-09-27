import type { Coordinates, GeocodeResult, PlaceResult, ReverseGeocodeResult } from "@fruitland/shared";
import { apiFetch } from "./apiClient";

/**
 * Thin wrapper over the existing `/api/v1/maps/*` routes (Phase 9), reusing
 * `apiFetch` — no second HTTP client. Returns the exact normalized shared
 * types the backend already returns; nothing provider-specific ever appears
 * here or downstream in components.
 */

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function reverseGeocode(coordinates: Coordinates, signal?: AbortSignal): Promise<ReverseGeocodeResult> {
  return apiFetch<ReverseGeocodeResult>(`/maps/reverse-geocode${toQuery({ lat: coordinates.latitude, lng: coordinates.longitude })}`, { signal });
}

export function searchPlaces(query: string, options?: { near?: Coordinates; limit?: number; signal?: AbortSignal }): Promise<PlaceResult[]> {
  return apiFetch<PlaceResult[]>(
    `/maps/search${toQuery({ query, lat: options?.near?.latitude, lng: options?.near?.longitude, limit: options?.limit })}`,
    { signal: options?.signal },
  );
}

export function geocode(address: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  return apiFetch<GeocodeResult[]>(`/maps/geocode${toQuery({ address })}`, { signal });
}
