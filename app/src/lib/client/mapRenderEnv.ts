import { z } from "zod";

/**
 * Validated access to the *browser rendering* environment variables — the
 * client-side counterpart of `lib/server/env.ts`. These are deliberately a
 * separate, small schema:
 *
 * - They must all be `NEXT_PUBLIC_*` (inlined into the browser bundle by
 *   Next.js at build time), so each one is read as a literal
 *   `process.env.NEXT_PUBLIC_X` expression below — Next.js's build-time
 *   replacement only rewrites exact literal accesses, not a spread of the
 *   whole `process.env` object, which is why this file does not simply
 *   `envSchema.parse(process.env)` the way `lib/server/env.ts` does.
 * - They are NEVER the same credential as the matching server variable
 *   (`NESHAN_API_KEY`, `GOOGLE_MAPS_API_KEY`, ...). See the Credential
 *   Matrix in CLAUDE.md (§ Phase 4.5 architecture decision) and the Phase 13
 *   report for why each provider's browser key is a distinct credential
 *   from its server key, and must be restricted (HTTP referrer / domain) in
 *   that provider's own console, since it is necessarily visible in the
 *   browser bundle.
 */
const mapRenderEnvSchema = z.object({
  /** Which MapRendererComponent MapView loads by default. Invalid values fail loudly instead of silently falling back — same philosophy as MAP_PROVIDER in lib/server/env.ts. An empty string (unset in .env.example) is treated as unset, same as undefined. */
  NEXT_PUBLIC_MAP_RENDER_PROVIDER: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["leaflet", "neshan", "google"]).default("leaflet"),
  ),
  /** Neshan "Web Map" key (NOT the server "Web Service" key — see Credential Matrix). Required only when NEXT_PUBLIC_MAP_RENDER_PROVIDER=neshan. */
  NEXT_PUBLIC_NESHAN_MAP_KEY: z.string().min(1).optional(),
  /** Google Maps JavaScript API browser key, restricted by HTTP referrer in Google Cloud Console. Google's own guidance is to use a separate key from the server Geocoding/Places/Routes key even though the credential *type* is the same. Required only when NEXT_PUBLIC_MAP_RENDER_PROVIDER=google. */
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: z.string().min(1).optional(),
  /**
   * Optional Google Maps "Map ID" (created in Cloud Console) for the
   * newer AdvancedMarkerElement. Not required: GoogleMapsRenderer uses the
   * classic `google.maps.Marker` (still supported, only marked
   * "not actively developed" — see official docs) precisely so that a
   * project without a configured Map ID isn't blocked from rendering a
   * marker at all.
   */
  NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: z.string().min(1).optional(),
});

export type MapRenderEnv = z.infer<typeof mapRenderEnvSchema>;

let cached: MapRenderEnv | undefined;

export function getMapRenderEnv(): MapRenderEnv {
  if (cached) return cached;
  const raw = {
    NEXT_PUBLIC_MAP_RENDER_PROVIDER: process.env.NEXT_PUBLIC_MAP_RENDER_PROVIDER,
    NEXT_PUBLIC_NESHAN_MAP_KEY: process.env.NEXT_PUBLIC_NESHAN_MAP_KEY,
    NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY,
    NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
  };
  const parsed = mapRenderEnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid map rendering environment configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: drops the cached, validated env so tests can re-read process.env after vi.stubEnv(...). */
export function resetMapRenderEnvForTests(): void {
  cached = undefined;
}
