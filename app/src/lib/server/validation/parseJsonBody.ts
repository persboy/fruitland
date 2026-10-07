import type { NextRequest } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "../errors/AppError";

/** The schema's INPUT type is deliberately `unknown` (as in parseQuery): schemas whose transforms change the input shape (e.g. `null` → omitted) are supported. */
export async function parseJsonBody<T>(request: NextRequest, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
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
