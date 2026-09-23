import { NextResponse } from "next/server";
import { AppError } from "./errors/AppError";

/**
 * Every API route must respond with this envelope shape. Never invent a
 * different response structure for a new module.
 */
export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  message: string | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  } | null;
  error: {
    code: string;
    message: string;
  } | null;
};

export function apiSuccess<T>(
  data: T,
  options?: { message?: string; pagination?: ApiEnvelope<T>["pagination"]; status?: number },
): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      message: options?.message ?? null,
      pagination: options?.pagination ?? null,
      error: null,
    },
    { status: options?.status ?? 200 },
  );
}

export function apiError(
  code: string,
  message: string,
  status: number,
): NextResponse<ApiEnvelope<null>> {
  return NextResponse.json(
    {
      success: false,
      data: null,
      message: null,
      pagination: null,
      error: { code, message },
    },
    { status },
  );
}

/**
 * Every route handler's catch block should call this. A known AppError is
 * translated 1:1; anything else is unexpected and must not leak internals
 * to the client (MASTER-PROMPT.md §32) — it is logged server-side and
 * returned as a generic 500.
 */
export function apiErrorFromException(err: unknown): NextResponse<ApiEnvelope<null>> {
  if (err instanceof AppError) {
    return apiError(err.code, err.message, err.status);
  }
  console.error("Unexpected error in API route:", err);
  return apiError("INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد", 500);
}
