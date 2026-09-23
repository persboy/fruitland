import { describe, expect, it } from "vitest";
import {
  ADDRESS_LABELS,
  COURIER_STATUSES,
  DISCOUNT_TYPES,
  NOTIFICATION_TYPES,
  ORDER_DELIVERY_PROPOSED_OUTCOMES,
  ORDER_DELIVERY_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  OTP_PURPOSES,
  PRODUCT_UNITS,
  REVIEW_ATTRIBUTE_TYPES,
  USER_ROLES,
  VEHICLE_TYPES,
} from "./enums";

const allEnums: Record<string, readonly string[]> = {
  USER_ROLES,
  ORDER_STATUSES,
  ORDER_SOURCES,
  ORDER_DELIVERY_STATUSES,
  ORDER_DELIVERY_PROPOSED_OUTCOMES,
  DISCOUNT_TYPES,
  PRODUCT_UNITS,
  ADDRESS_LABELS,
  COURIER_STATUSES,
  VEHICLE_TYPES,
  NOTIFICATION_TYPES,
  REVIEW_ATTRIBUTE_TYPES,
  OTP_PURPOSES,
};

describe("domain enums", () => {
  it.each(Object.entries(allEnums))("%s has no duplicate values", (_name, values) => {
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(Object.entries(allEnums))("%s has at least one value", (_name, values) => {
    expect(values.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(allEnums))("%s contains only lower_snake_case strings", (_name, values) => {
    for (const value of values) {
      expect(value).toMatch(/^[a-z]+(_[a-z0-9]+)*$/);
    }
  });
});
