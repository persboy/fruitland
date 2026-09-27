import type { Coordinates } from "@fruitland/shared";
import type { ComponentType } from "react";

/**
 * The one thing MapView knows about "how a map is actually drawn". This is
 * the seam the future MapRenderingProvider work (Phase 4.5 architecture
 * decision: rendering is independent from the Neshan/Map.ir/Google *service*
 * providers) plugs into — swapping the tile source later means writing a new
 * component matching this props shape, with zero change to MapView or
 * LocationPicker. It is deliberately NOT the same interface as `MapProvider`
 * (server-side geocode/search/route) — rendering and service are different
 * concerns, as already decided.
 */
export interface MapRendererProps {
  center: Coordinates;
  marker: Coordinates | null;
  onMapClick: (coordinates: Coordinates) => void;
  className?: string;
}

export type MapRendererComponent = ComponentType<MapRendererProps>;
