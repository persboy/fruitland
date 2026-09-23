import type { NextRequest } from "next/server";
import type { ZodSchema } from "zod";
import { AppError } from "../errors/AppError";

export async function parseJsonBody<T>(request: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw AppError.badRequest("بدنه‌ی درخواست JSON معتبر نیست", "INVALID_JSON_BODY");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("؛ ");
    throw AppError.badRequest(message, "VALIDATION_ERROR");
  }
  return parsed.data;
}

/** For routes where a JSON body is optional (e.g. refresh/logout can rely purely on the cookie) — never throws on a missing/empty body. */
export async function parseOptionalJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const raw = await request.json();
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
