import { lazy } from "react";
import { getMapRenderEnv } from "@/lib/client/mapRenderEnv";
import type { MapRendererComponent } from "./MapRenderer";

export type MapRenderProviderName = "leaflet" | "neshan" | "google";

/**
 * The single place that knows how to turn a browser rendering provider name
 * into a concrete `MapRendererComponent`. This is the client-side mirror of
 * `lib/server/maps/registry.ts` — same intent (nothing outside this file may
 * `import` a concrete renderer directly; MapView only ever calls
 * `getDefaultMapRenderer()`), same shape (a lookup keyed by a stable name),
 * deliberately NOT the same object: server provider selection reads
 * `MAP_PROVIDER` (a server-only env var, chooses a *service* adapter);
 * this reads `NEXT_PUBLIC_MAP_RENDER_PROVIDER` (inlined into the browser
 * bundle, chooses a *rendering* component). The two are independent, as
 * decided in Phase 4.5 — an app can call Google's geocoding API on the
 * server while rendering Neshan tiles in the browser, or any other
 * combination.
 *
 * Each loader is a dynamic `import()` so an unselected provider's SDK is
 * never bundled into the page that doesn't use it (the same code-splitting
 * MapView already relied on for the single Leaflet renderer).
 */
const rendererLoaders: Record<MapRenderProviderName, () => Promise<{ default: MapRendererComponent }>> = {
  leaflet: () => import("./LeafletMapRenderer"),
  neshan: () => import("./NeshanMapRenderer"),
  google: () => import("./GoogleMapsRenderer"),
};

/** Pure lookup, exported for testing without needing to touch env/lazy(). */
export function resolveRendererLoader(name: MapRenderProviderName): () => Promise<{ default: MapRendererComponent }> {
  return rendererLoaders[name];
}

/** The renderer MapView uses when no `renderer` prop is injected, per NEXT_PUBLIC_MAP_RENDER_PROVIDER. */
export function getDefaultMapRenderer(): MapRendererComponent {
  const name = getMapRenderEnv().NEXT_PUBLIC_MAP_RENDER_PROVIDER;
  return lazy(resolveRendererLoader(name));
}
