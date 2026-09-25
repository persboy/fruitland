import type { MapProviderName } from "@fruitland/shared";
import { getEnv } from "../env";
import type { MapProvider } from "./provider";
import { GoogleMapsProvider } from "./providers/google.provider";
import { MapIrProvider } from "./providers/mapir.provider";
import { NeshanProvider } from "./providers/neshan.provider";

/**
 * The single place that knows how to turn a stable provider identifier
 * ("neshan" | "mapir" | "google") into a concrete MapProvider instance.
 * Nothing outside this file may `new NeshanProvider(...)` etc. — controllers,
 * routes and MapService (Phase 8) only ever call getMapProvider /
 * getDefaultMapProvider, exactly like the existing `services/sms/index.ts`
 * pattern this mirrors.
 *
 * Providers are stateless (no per-request mutable data), so one instance per
 * name is created lazily and reused — not a new object per call, and not
 * global state beyond that simple cache.
 */
const cache = new Map<MapProviderName, MapProvider>();

function buildProvider(name: MapProviderName): MapProvider {
  const env = getEnv();
  const timeoutMs = env.MAP_REQUEST_TIMEOUT_MS;
  switch (name) {
    case "neshan":
      if (!env.NESHAN_API_KEY) throw new Error("Map provider 'neshan' requires NESHAN_API_KEY to be set");
      return new NeshanProvider({ apiKey: env.NESHAN_API_KEY, timeoutMs });
    case "mapir":
      if (!env.MAPIR_API_KEY) throw new Error("Map provider 'mapir' requires MAPIR_API_KEY to be set");
      return new MapIrProvider({ apiKey: env.MAPIR_API_KEY, timeoutMs });
    case "google":
      if (!env.GOOGLE_MAPS_API_KEY) throw new Error("Map provider 'google' requires GOOGLE_MAPS_API_KEY to be set");
      return new GoogleMapsProvider({ apiKey: env.GOOGLE_MAPS_API_KEY, timeoutMs });
    default:
      // Exhaustiveness check: env.ts's MAP_PROVIDER enum is the only source of names, so this is unreachable in practice.
      throw new Error(`Unknown map provider: ${name satisfies never}`);
  }
}

/**
 * Resolves a provider by explicit identifier — used by Comparison Mode
 * (Phase 15), which needs all three regardless of MAP_PROVIDER. Throws a
 * plain Error (a startup/config problem, not a MapProviderError — the
 * request never reached a provider) when that provider's credential is missing.
 */
export function getMapProvider(name: MapProviderName): MapProvider {
  const existing = cache.get(name);
  if (existing) return existing;
  const provider = buildProvider(name);
  cache.set(name, provider);
  return provider;
}

/** The provider MapService uses for ordinary (non-comparison) requests, per MAP_PROVIDER. */
export function getDefaultMapProvider(): MapProvider {
  return getMapProvider(getEnv().MAP_PROVIDER);
}

/** Test-only: drops cached instances so tests can rebuild providers against fresh env/mocks. */
export function resetMapProviderRegistryForTests(): void {
  cache.clear();
}
