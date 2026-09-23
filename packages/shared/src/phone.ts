const IRAN_MOBILE_REGEX = /^(?:\+98|0098|98|0)?9\d{9}$/;

/**
 * Normalizes an Iranian mobile number to the canonical storage format
 * (0912xxxxxxx). Accepts 09123456789 / 9123456789 / +989123456789 /
 * 00989123456789. Returns null for anything else — callers decide how to
 * surface the error (a Zod schema, an AppError, etc.) rather than this
 * pure function throwing a framework-specific error.
 */
export function normalizeIranMobile(raw: string): string | null {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/\s|-/g, "");

  if (!IRAN_MOBILE_REGEX.test(trimmed)) return null;

  const digitsOnly = trimmed.replace(/^(\+98|0098|98|0)/, "");
  return `0${digitsOnly}`;
}
