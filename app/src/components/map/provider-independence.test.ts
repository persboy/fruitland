import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * MASTER-PROMPT (map spec) §43/§47 + Phase 12 explicit requirement: the UI
 * layer must consume only the normalized shared types (Coordinates,
 * NormalizedAddress, PlaceResult, ReverseGeocodeResult, AddressDto) and must
 * never know a concrete provider's name or response shape. This is a static
 * source check, not just a runtime assertion — it fails the moment someone
 * pastes `if (provider === "neshan")`-style logic into a UI component.
 */
const UI_FILES = [
  "MapView.tsx",
  "LocationPicker.tsx",
  "LeafletMapRenderer.tsx",
  join("..", "address", "AddressForm.tsx"),
];

const FORBIDDEN_PATTERNS = [/\bneshan\b/i, /\bmapir\b/i, /\bmap\.ir\b/i, /\bgoogle\b/i, /googleapis\.com/i, /\bbalad\b/i];

/** Strips comments so the check targets real code, not architectural prose (which legitimately names providers when explaining the split with MapRenderingProvider). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("UI provider-independence (static check)", () => {
  it.each(UI_FILES)("%s never mentions a concrete map provider by name in actual code", (relativePath) => {
    const code = stripComments(readFileSync(join(__dirname, relativePath), "utf-8"));
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(code).not.toMatch(pattern);
    }
  });

  it("no UI component under components/map or components/address imports a concrete provider adapter", () => {
    const dirs = [__dirname, join(__dirname, "..", "address")];
    for (const dir of dirs) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
        const source = readFileSync(join(dir, file), "utf-8");
        expect(source).not.toMatch(/lib\/server\/maps\/providers/);
      }
    }
  });
});
