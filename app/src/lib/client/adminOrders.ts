import type { OrderDeliveryStatus, OrderDetailDto, OrderListItemDto, OrderSource, OrderStatus } from "@fruitland/shared";
import { apiFetch, apiFetchPage, type PageInfo } from "./apiClient";

export type { OrderDetailDto, OrderListItemDto, PageInfo };

export interface OrderListParams {
  page: number;
  limit?: number;
  search?: string;
  status?: OrderStatus;
  deliveryStatus?: OrderDeliveryStatus;
  source?: OrderSource;
}

const enc = encodeURIComponent;

export function fetchOrders(params: OrderListParams) {
  const qs = new URLSearchParams({ page: String(params.page) });
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.deliveryStatus) qs.set("deliveryStatus", params.deliveryStatus);
  if (params.source) qs.set("source", params.source);
  return apiFetchPage<OrderListItemDto[]>(`/admin/orders?${qs.toString()}`);
}

export const fetchOrder = (id: string) => apiFetch<OrderDetailDto>(`/admin/orders/${enc(id)}`);
export const cancelOrder = (id: string, reason: string) => apiFetch<OrderDetailDto>(`/admin/orders/${enc(id)}/cancel`, { method: "POST", body: { reason } });
