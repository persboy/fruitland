import type {
  CreateDiscountCodeRequest,
  DiscountCodeDto,
  DiscountCodeStatusFilter,
  DiscountCodeTypeFilter,
  UpdateDiscountCodeRequest,
} from "@fruitland/shared";
import { apiFetch, apiFetchPage, type PageInfo } from "./apiClient";

export type { DiscountCodeDto, PageInfo };

export interface DiscountCodeListParams {
  page: number;
  limit?: number;
  search?: string;
  type?: DiscountCodeTypeFilter;
  status?: DiscountCodeStatusFilter;
}

const enc = encodeURIComponent;

export function fetchDiscountCodes(params: DiscountCodeListParams) {
  const qs = new URLSearchParams({ page: String(params.page) });
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.type && params.type !== "all") qs.set("type", params.type);
  if (params.status && params.status !== "all") qs.set("status", params.status);
  return apiFetchPage<DiscountCodeDto[]>(`/admin/discount-codes?${qs.toString()}`);
}

export const createDiscountCode = (body: CreateDiscountCodeRequest) =>
  apiFetch<DiscountCodeDto>("/admin/discount-codes", { method: "POST", body });
export const updateDiscountCode = (id: string, body: UpdateDiscountCodeRequest) =>
  apiFetch<DiscountCodeDto>(`/admin/discount-codes/${enc(id)}`, { method: "PATCH", body });
export const setDiscountCodeActive = (id: string, isActive: boolean) =>
  apiFetch<DiscountCodeDto>(`/admin/discount-codes/${enc(id)}/status`, { method: "PATCH", body: { isActive } });
