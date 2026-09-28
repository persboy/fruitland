"use client";

import { useEffect, useRef } from "react";
import type OlMap from "@neshan-maps-platform/ol/Map";
import type OlOverlay from "@neshan-maps-platform/ol/Overlay";
import type { MapRendererProps } from "./MapRenderer";
import { getMapRenderEnv } from "@/lib/client/mapRenderEnv";

/**
 * Concrete `MapRendererComponent` for Neshan branded tiles. Uses Neshan's
 * own official OpenLayers package (`@neshan-maps-platform/ol`, verified from
 * https://www.npmjs.com/package/@neshan-maps-platform/ol — `mapType`, `key`,
 * `poi`, `traffic`, `view: new View({center, zoom})` are exactly its
 * documented `MapOptions`; `fromLonLat`/`toLonLat` and `Overlay` are
 * standard OpenLayers APIs the package re-exports). NOT selected by
 * `MapView`/`LocationPicker` directly — only `registry.ts` imports this,
 * when `NEXT_PUBLIC_MAP_RENDER_PROVIDER=neshan`.
 *
 * Requires `NEXT_PUBLIC_NESHAN_MAP_KEY` — Neshan's "Web Map" key type, a
 * DIFFERENT credential from the server's `NESHAN_API_KEY` ("Web Service"
 * key). See the Credential Matrix in CLAUDE.md (Phase 4.5) and
 * lib/client/mapRenderEnv.ts.
 */
export default function NeshanMapRenderer({ center, marker, onMapClick, className }: MapRendererProps) {
  const mapKey = getMapRenderEnv().NEXT_PUBLIC_NESHAN_MAP_KEY;
  if (!mapKey) {
    // Thrown during render (not inside an effect) so the same
    // MapErrorBoundary that catches a failed renderer chunk load also
    // catches this misconfiguration, instead of silently showing a blank map.
    throw new Error("NEXT_PUBLIC_NESHAN_MAP_KEY is required when NEXT_PUBLIC_MAP_RENDER_PROVIDER=neshan");
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const markerOverlayRef = useRef<OlOverlay | null>(null);
  // onMapClick can change identity across renders without re-attaching the OL click listener.
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      import("@neshan-maps-platform/ol/Map"),
      import("@neshan-maps-platform/ol/View"),
      import("@neshan-maps-platform/ol/proj"),
      // Side-effect only import — registers the package's required base CSS.
      import("@neshan-maps-platform/ol/ol.css"),
    ]).then(([{ default: OlMapCtor }, { default: View }, { fromLonLat, toLonLat }]) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new OlMapCtor({
        target: containerRef.current,
        mapType: "neshan",
        key: mapKey,
        poi: true,
        traffic: true,
        view: new View({ center: fromLonLat([center.longitude, center.latitude]), zoom: 15 }),
      });
      map.on("click", (evt) => {
        const [lng, lat] = toLonLat(evt.coordinate) as [number, number];
        onMapClickRef.current({ latitude: lat, longitude: lng });
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      // OpenLayers has no `.remove()`; detaching the target is the documented disposal path.
      mapRef.current?.setTarget(undefined);
      mapRef.current = null;
    };
    // Mount once; center is applied imperatively below rather than recreating the map on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey]);

  useEffect(() => {
    void import("@neshan-maps-platform/ol/proj").then(({ fromLonLat }) => {
      mapRef.current?.getView().setCenter(fromLonLat([center.longitude, center.latitude]));
    });
  }, [center.latitude, center.longitude]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([import("@neshan-maps-platform/ol/Overlay"), import("@neshan-maps-platform/ol/proj")]).then(
      ([{ default: Overlay }, { fromLonLat }]) => {
        if (cancelled || !mapRef.current) return;
        if (!marker) {
          if (markerOverlayRef.current) {
            mapRef.current.removeOverlay(markerOverlayRef.current);
            markerOverlayRef.current = null;
          }
          return;
        }
        const position = fromLonLat([marker.longitude, marker.latitude]);
        if (markerOverlayRef.current) {
          markerOverlayRef.current.setPosition(position);
          return;
        }
        const element = document.createElement("div");
        element.className = "h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-600 shadow";
        const overlay = new Overlay({ element, position, positioning: "center-center" });
        mapRef.current.addOverlay(overlay);
        markerOverlayRef.current = overlay;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [marker]);

  return <div ref={containerRef} className={className} role="application" aria-label="نقشه" />;
}
