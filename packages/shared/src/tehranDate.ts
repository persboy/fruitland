/**
 * Business-timezone (Asia/Tehran) calendar helpers. Storage stays a real UTC
 * instant (a `Date`); these only translate between an instant and the Tehran
 * wall-clock calendar day. They never read the runtime's local timezone, so the
 * result is identical in the browser, on the server and in tests.
 */

const TEHRAN_TIME_ZONE = "Asia/Tehran";

const wallClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TEHRAN_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function tehranWallClock(utcMs: number): WallClock {
  const parts = wallClockFormatter.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Tehran's UTC offset (minutes, positive = ahead of UTC) at the given instant. */
function tehranOffsetMinutes(utcMs: number): number {
  const w = tehranWallClock(utcMs);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((wallAsUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/**
 * The instant at which the given Tehran calendar day (`YYYY-MM-DD`, already
 * validated by the caller) ends: 23:59:59.999 Tehran time. The offset is looked
 * up from the timezone database at that very moment (so the historical DST
 * period is handled), refined twice because the offset depends on the instant.
 */
export function endOfTehranDay(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`endOfTehranDay expects YYYY-MM-DD, received: ${ymd}`);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  let instant = wall - 210 * 60_000; // +03:30 first guess
  for (let i = 0; i < 2; i += 1) instant = wall - tehranOffsetMinutes(instant) * 60_000;
  return new Date(instant);
}

/** The Tehran calendar day (`YYYY-MM-DD`) that contains the given instant. */
export function toTehranCalendarDate(date: Date): string {
  const w = tehranWallClock(date.getTime());
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}
