import { describe, expect, it } from "vitest";
import { endOfTehranDay, toTehranCalendarDate } from "./tehranDate";

describe("endOfTehranDay", () => {
  it("is 23:59:59.999 Tehran time (UTC+03:30 since the 2022 DST abolition)", () => {
    expect(endOfTehranDay("2026-10-07").toISOString()).toBe("2026-10-07T20:29:59.999Z");
    expect(endOfTehranDay("2026-01-15").toISOString()).toBe("2026-01-15T20:29:59.999Z");
  });

  it("honours the historical DST offset (UTC+04:30) from the timezone database", () => {
    expect(endOfTehranDay("2021-06-01").toISOString()).toBe("2021-06-01T19:29:59.999Z");
  });

  it("round-trips: the instant belongs to the selected Tehran day, and 1 ms later is the next day", () => {
    for (const ymd of ["2026-03-21", "2026-07-15", "2026-12-31", "2024-02-29", "2021-03-21", "2021-09-21"]) {
      const end = endOfTehranDay(ymd);
      expect(toTehranCalendarDate(end)).toBe(ymd);
      expect(toTehranCalendarDate(new Date(end.getTime() + 1))).not.toBe(ymd);
    }
  });

  it("does not depend on the process timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(endOfTehranDay("2026-10-07").toISOString()).toBe("2026-10-07T20:29:59.999Z");
      process.env.TZ = "Pacific/Auckland";
      expect(endOfTehranDay("2026-10-07").toISOString()).toBe("2026-10-07T20:29:59.999Z");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("rejects a malformed value", () => {
    expect(() => endOfTehranDay("1405/07/15")).toThrow();
    expect(() => endOfTehranDay("")).toThrow();
  });
});

describe("toTehranCalendarDate", () => {
  it("uses the Tehran calendar day, not the UTC day", () => {
    expect(toTehranCalendarDate(new Date("2026-10-07T20:29:59.999Z"))).toBe("2026-10-07");
    expect(toTehranCalendarDate(new Date("2026-10-07T20:30:00.000Z"))).toBe("2026-10-08");
    expect(toTehranCalendarDate(new Date("2026-10-07T00:00:00.000Z"))).toBe("2026-10-07");
  });
});
