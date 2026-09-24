/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → ASCII, so numeric input typed on a Persian keyboard parses. */
export function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Parses a money input into an integer Toman amount. Accepts Persian digits
 * and thousands separators; returns null for empty/invalid input — money is
 * never coerced to 0 silently.
 */
export function parseTomanInput(value: string): number | null {
  const cleaned = toEnglishDigits(value).replace(/[,٬\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

export function formatToman(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

/**
 * Live formatting for money/number inputs (project rule: numbers are always
 * shown with the Persian thousands separator, never as a bare digit run).
 * Keeps digits only — decimals and signs cannot be typed — and returns
 * "۲۵٬۰۰۰"-style text; empty input stays empty. Round-trips through parseTomanInput.
 */
export function formatNumberInput(value: string): string {
  const digits = toEnglishDigits(value).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n.toLocaleString("fa-IR") : "";
}
