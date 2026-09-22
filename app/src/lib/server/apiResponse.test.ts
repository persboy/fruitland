import { describe, expect, it } from "vitest";
import { apiError, apiSuccess } from "./apiResponse";

describe("apiResponse envelope", () => {
  it("wraps success data in the standard envelope", async () => {
    const response = apiSuccess({ foo: "bar" }, { message: "ok" });
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      data: { foo: "bar" },
      message: "ok",
      pagination: null,
      error: null,
    });
    expect(response.status).toBe(200);
  });

  it("wraps errors in the standard envelope with the given status", async () => {
    const response = apiError("NOT_FOUND", "پیدا نشد", 404);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      data: null,
      message: null,
      pagination: null,
      error: { code: "NOT_FOUND", message: "پیدا نشد" },
    });
    expect(response.status).toBe(404);
  });
});
