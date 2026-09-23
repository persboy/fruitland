import { describe, expect, it, vi } from "vitest";
import { apiError, apiErrorFromException, apiSuccess } from "./apiResponse";
import { AppError } from "./errors/AppError";

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

  it("translates a known AppError 1:1", async () => {
    const response = apiErrorFromException(AppError.unauthorized("نامعتبر", "INVALID_CREDENTIALS"));
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(401);
    expect(body.error).toEqual({ code: "INVALID_CREDENTIALS", message: "نامعتبر" });
  });

  it("masks an unexpected error as a generic 500 without leaking internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = apiErrorFromException(new Error("some internal db connection string leak"));
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.message).not.toContain("db connection string");
    spy.mockRestore();
  });
});
