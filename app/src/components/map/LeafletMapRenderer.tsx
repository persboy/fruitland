"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import type { MapRendererProps } from "./MapRenderer";

/**
 * Leaflet + OpenStreetMap raster tiles — keyless and always available. As of
 * Phase 13, this is the project's explicit fallback/development renderer
 * (selected via `NEXT_PUBLIC_MAP_RENDER_PROVIDER=leaflet`, the default), NOT
 * a stand-in that branded rendering (`NeshanMapRenderer`/`GoogleMapsRenderer`,
 * see registry.ts) is meant to replace outright — a deployment without a
 * configured browser map key still gets a real, working map. The map
 * *services* used elsewhere in this component tree (search, reverse-geocode)
 * already go through the real internal API backed by real providers —
 * independent of which tile renderer is active (see CLAUDE.md Phase 4.5).
 *
 * Imported only via React.lazy (MapView's Suspense boundary) — Leaflet
 * touches `window` at module scope and must never load during SSR.
 */
export default function LeafletMapRenderer({ center, marker, onMapClick, className }: MapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  // onMapClick can change identity across renders without needing to re-attach the Leaflet click listener.
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([center.latitude, center.longitude], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      map.on("click", (e) => onMapClickRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Intentionally mount once; center is applied imperatively below rather than re-creating the map on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setView([center.latitude, center.longitude]);
  }, [center.latitude, center.longitude]);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !mapRef.current) return;
      if (!marker) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      if (markerRef.current) {
        markerRef.current.setLatLng([marker.latitude, marker.longitude]);
      } else {
        markerRef.current = L.marker([marker.latitude, marker.longitude]).addTo(mapRef.current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [marker]);

  return <div ref={containerRef} className={className} role="application" aria-label="نقشه" />;
}
