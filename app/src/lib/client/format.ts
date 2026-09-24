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
