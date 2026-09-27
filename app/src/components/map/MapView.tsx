"use client";

import { Suspense, lazy } from "react";
import type { Coordinates } from "@fruitland/shared";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MapErrorBoundary } from "./MapErrorBoundary";
import type { MapRendererComponent } from "./MapRenderer";

const DefaultRenderer = lazy(() => import("./LeafletMapRenderer"));

export interface MapViewProps {
  /** Where the map is centered. */
  center: Coordinates;
  /** The selected point, or null for none. */
  marker?: Coordinates | null;
  /** Fired when the user taps/clicks the map. MapView has no opinion on what happens next (e.g. reverse-geocoding) — that is LocationPicker's job. */
  onMapClick?: (coordinates: Coordinates) => void;
  className?: string;
  /**
   * Overrides the concrete renderer — used by tests, and the seam a future
   * MapRenderingProvider (Neshan/Map.ir/Google branded tiles) plugs into.
   * Defaults to the Leaflet/OpenStreetMap renderer (see LeafletMapRenderer.tsx).
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
