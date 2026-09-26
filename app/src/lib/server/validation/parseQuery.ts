import type { NextRequest } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "../errors/AppError";

/**
 * Validates a GET request's query string against a Zod schema — the query
 * equivalent of parseJsonBody. Every value arrives as a string; schemas
 * needing numbers/booleans must coerce (e.g. z.coerce.number()), and schemas
 * that transform the raw query shape (e.g. lat/lng → {latitude,longitude})
 * are supported — hence the permissive `any` input type parameter.
 */
export function parseQuery<T>(request: NextRequest, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const raw = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("؛ ");
    throw AppError.badRequest(message, "VALIDATION_ERROR");
  }
  return parsed.data;
}
