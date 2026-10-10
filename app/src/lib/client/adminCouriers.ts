import type { CourierDto, CourierStatusFilter, CreateCourierRequest, UpdateCourierRequest } from "@fruitland/shared";
import { apiFetch, apiFetchPage, type PageInfo } from "./apiClient";

export type { CourierDto, PageInfo };

export interface CourierListParams {
  page: number;
  limit?: number;
  search?: string;
  status?: CourierStatusFilter;
}

const enc = encodeURIComponent;

export function fetchCouriers(params: CourierListParams) {
  const qs = new URLSearchParams({ page: String(params.page) });
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.status && params.status !== "all") qs.set("status", params.status);
  return apiFetchPage<CourierDto[]>(`/admin/couriers?${qs.toString()}`);
}

export const createCourier = (body: CreateCourierRequest) => apiFetch<CourierDto>("/admin/couriers", { method: "POST", body });
export const updateCourier = (id: string, body: UpdateCourierRequest) => apiFetch<CourierDto>(`/admin/couriers/${enc(id)}`, { method: "PATCH", body });
export const setCourierActive = (id: string, isActive: boolean) =>
  apiFetch<CourierDto>(`/admin/couriers/${enc(id)}/status`, { method: "PATCH", body: { isActive } });
