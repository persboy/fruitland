"use client";

import { Suspense } from "react";
import type { Coordinates } from "@fruitland/shared";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MapErrorBoundary } from "./MapErrorBoundary";
import type { MapRendererComponent } from "./MapRenderer";
import { getDefaultMapRenderer } from "./registry";

// Resolved once per module load (NEXT_PUBLIC_MAP_RENDER_PROVIDER is a
// build-time-inlined value, not something that changes at runtime), exactly
// like the single hardcoded `lazy(() => import("./LeafletMapRenderer"))`
// this replaces — see registry.ts for how the provider is chosen and why
// MapView itself never branches on a provider name.
const DefaultRenderer = getDefaultMapRenderer();

export interface MapViewProps {
  /** Where the map is centered. */
  center: Coordinates;
  /** The selected point, or null for none. */
  marker?: Coordinates | null;
  /** Fired when the user taps/clicks the map. MapView has no opinion on what happens next (e.g. reverse-geocoding) — that is LocationPicker's job. */
  onMapClick?: (coordinates: Coordinates) => void;
  className?: string;
  /**
   * Overrides the concrete renderer — used by tests, and available to a
   * caller that needs a specific renderer regardless of the configured
   * default. Normal usage should not need this: the default comes from
   * `registry.ts` / `NEXT_PUBLIC_MAP_RENDER_PROVIDER` (leaflet/neshan/google;
   * Map.ir browser rendering is intentionally not implemented yet — see
   * CLAUDE.md Phase 13).
   */
  renderer?: MapRendererComponent;
}

/**
 * Provider-agnostic map surface. MapView itself contains no address/business
 * logic and no knowledge of which map service (Neshan/Map.ir/Google) is
 * active — that lives entirely behind the `renderer` prop and, separately,
 * behind the internal `/api/v1/maps/*` endpoints that LocationPicker calls
 * for search/reverse-geocode. MapView only renders a surface, a marker, and
 * reports clicks.
 */
export function MapView({ center, marker = null, onMapClick = () => {}, className, renderer }: MapViewProps) {
  const Renderer = renderer ?? DefaultRenderer;
  return (
    <MapErrorBoundary>
      <Suspense fallback={<Skeleton className={cn("h-full w-full", className)} />}>
        <Renderer center={center} marker={marker} onMapClick={onMapClick} className={cn("h-full w-full", className)} />
      </Suspense>
    </MapErrorBoundary>
  );
}
