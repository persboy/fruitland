import { describe, expect, it } from "vitest";
import { isAdminRole, safeReturnTo } from "./adminAuth";

describe("safeReturnTo", () => {
  it("allows /admin paths only", () => {
    expect(safeReturnTo("/admin/orders")).toBe("/admin/orders");
    expect(safeReturnTo(null)).toBe("/admin");
    expect(safeReturnTo("https://evil.example")).toBe("/admin");
    expect(safeReturnTo("//evil.example")).toBe("/admin");
    expect(safeReturnTo("/account")).toBe("/admin");
  });
});

describe("isAdminRole", () => {
  it("accepts admin and master_admin only", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("master_admin")).toBe(true);
    expect(isAdminRole("customer")).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});
