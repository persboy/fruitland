"use client";

import { useEffect, useRef } from "react";
import type { MapRendererProps } from "./MapRenderer";
import { getMapRenderEnv } from "@/lib/client/mapRenderEnv";

let loaderConfigured = false;

/**
 * Concrete `MapRendererComponent` for Google Maps. Uses Google's own
 * `@googlemaps/js-api-loader` v2 functional API (`setOptions` +
 * `importLibrary`, verified from the package's official README/docs —
 * the older `new Loader().load()` class API is deprecated in v2). NOT
 * selected by `MapView`/`LocationPicker` directly — only `registry.ts`
 * imports this, when `NEXT_PUBLIC_MAP_RENDER_PROVIDER=google`.
 *
 * Requires `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`. Google documents the
 * server (Geocoding/Places/Routes) key and the browser (Maps JavaScript API)
 * key as the same *credential type*, but explicitly recommends separate keys
 * with different restrictions (server: IP restriction; browser: HTTP
 * referrer restriction) — see CLAUDE.md's Credential Matrix. Uses the
 * classic `google.maps.Marker` rather than `AdvancedMarkerElement`: the
 * latter is officially documented as the newer replacement but requires a
 * Map ID configured in Cloud Console; `Marker` is deprecated (Feb 2024) but,
 * per Google's own deprecation notice, remains available with no announced
 * removal date, and this keeps rendering working without an extra required
 * credential. `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` may still be set (e.g. for
 * custom map styling) and is passed through if present.
 */
export default function GoogleMapsRenderer({ center, marker, onMapClick, className }: MapRendererProps) {
  const env = getMapRenderEnv();
  const browserKey = env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  if (!browserKey) {
    // Thrown during render (not inside an effect) so the same
    // MapErrorBoundary that catches a failed renderer chunk load also
    // catches this misconfiguration, instead of silently showing a blank map.
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is required when NEXT_PUBLIC_MAP_RENDER_PROVIDER=google");
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  // onMapClick can change identity across renders without re-attaching the click listener.
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    let cancelled = false;
    void import("@googlemaps/js-api-loader").then(({ setOptions, importLibrary }) => {
      if (!loaderConfigured) {
        setOptions({ key: browserKey, v: "weekly" });
        loaderConfigured = true;
      }
      return importLibrary("maps").then(({ Map }) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = new Map(containerRef.current, {
          center: { lat: center.latitude, lng: center.longitude },
          zoom: 15,
          mapId: env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
        });
        clickListenerRef.current = map.addListener("click", (evt: google.maps.MapMouseEvent) => {
          if (!evt.latLng) return;
          onMapClickRef.current({ latitude: evt.latLng.lat(), longitude: evt.latLng.lng() });
        });
        mapRef.current = map;
      });
    });
    return () => {
      cancelled = true;
      clickListenerRef.current?.remove();
      clickListenerRef.current = null;
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
    // Mount once; center is applied imperatively below rather than recreating the map on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserKey]);

  useEffect(() => {
    mapRef.current?.setCenter({ lat: center.latitude, lng: center.longitude });
  }, [center.latitude, center.longitude]);

  useEffect(() => {
    let cancelled = false;
    void import("@googlemaps/js-api-loader").then(({ importLibrary }) =>
      importLibrary("marker").then(({ Marker }) => {
        if (cancelled || !mapRef.current) return;
        if (!marker) {
          markerRef.current?.setMap(null);
          markerRef.current = null;
          return;
        }
        const position = { lat: marker.latitude, lng: marker.longitude };
        if (markerRef.current) {
          markerRef.current.setPosition(position);
        } else {
          markerRef.current = new Marker({ position, map: mapRef.current });
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [marker]);

  return <div ref={containerRef} className={className} role="application" aria-label="نقشه" />;
}
