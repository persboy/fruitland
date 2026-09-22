import jalaali from "jalaali-js";

/**
 * All timestamps are stored in UTC/ISO. These helpers only affect
 * presentation: converting a stored Date to Persian/Jalali for display in
 * Asia/Tehran. Never use these for storage — storage stays Gregorian/UTC.
 */

const TEHRAN_TIME_ZONE = "Asia/Tehran";

function tehranParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TEHRAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function toJalali(date: Date): { jy: number; jm: number; jd: number } {
  const { year, month, day } = tehranParts(date);
  return jalaali.toJalaali(year, month, day);
}

const PERSIAN_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

/** e.g. "۱۵ مهر ۱۴۰۳" */
export function formatJalaliDate(date: Date): string {
  const { jy, jm, jd } = toJalali(date);
  const monthName = PERSIAN_MONTHS[jm - 1] ?? "";
  return `${toPersianDigitsLocal(String(jd))} ${monthName} ${toPersianDigitsLocal(String(jy))}`;
}

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function toPersianDigitsLocal(input: string): string {
  return input.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}
