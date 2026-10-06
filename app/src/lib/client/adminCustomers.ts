import type { CustomerDetailDto, CustomerListItemDto, CustomerStatusFilter, UpdateCustomerProfileInput } from "@fruitland/shared";
import { apiFetch, apiFetchPage, type PageInfo } from "./apiClient";

export type { CustomerDetailDto, CustomerListItemDto, PageInfo };

export interface CustomerListParams {
  page: number;
  limit?: number;
  search?: string;
  status?: CustomerStatusFilter;
}

const enc = encodeURIComponent;

export function fetchCustomers(params: CustomerListParams) {
  const qs = new URLSearchParams({ page: String(params.page) });
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.status && params.status !== "all") qs.set("status", params.status);
  return apiFetchPage<CustomerListItemDto[]>(`/admin/customers?${qs.toString()}`);
}

export const fetchCustomer = (id: string) => apiFetch<CustomerDetailDto>(`/admin/customers/${enc(id)}`);
export const updateCustomerProfile = (id: string, body: UpdateCustomerProfileInput) =>
  apiFetch<CustomerDetailDto>(`/admin/customers/${enc(id)}`, { method: "PATCH", body });
export const setCustomerActive = (id: string, isActive: boolean) =>
  apiFetch<CustomerDetailDto>(`/admin/customers/${enc(id)}/status`, { method: "PATCH", body: { isActive } });
