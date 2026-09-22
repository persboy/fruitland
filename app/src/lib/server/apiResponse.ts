import { NextResponse } from "next/server";

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
