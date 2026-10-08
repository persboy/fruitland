import type { CreateProductRequest, ProductDto, UpdateProductRequest } from "@fruitland/shared";
import { apiFetch, apiFetchPage, type PageInfo } from "./apiClient";

export type { ProductDto, PageInfo };

export interface ProductListParams {
  page: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  isOrganic?: boolean;
}

const enc = encodeURIComponent;

export function fetchProducts(params: ProductListParams) {
  const qs = new URLSearchParams({ page: String(params.page) });
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.categoryId) qs.set("categoryId", params.categoryId);
  if (params.isActive !== undefined) qs.set("isActive", String(params.isActive));
  if (params.isOrganic !== undefined) qs.set("isOrganic", String(params.isOrganic));
  return apiFetchPage<ProductDto[]>(`/admin/products?${qs.toString()}`);
}

export const createProduct = (body: CreateProductRequest) => apiFetch<ProductDto>("/admin/products", { method: "POST", body });
export const updateProduct = (id: string, body: UpdateProductRequest) => apiFetch<ProductDto>(`/admin/products/${enc(id)}`, { method: "PATCH", body });
export const setProductActive = (id: string, isActive: boolean) =>
  apiFetch<ProductDto>(`/admin/products/${enc(id)}/status`, { method: "PATCH", body: { isActive } });
