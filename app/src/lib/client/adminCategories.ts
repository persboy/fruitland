import type { CategoryDto, CreateCategoryInput, UpdateCategoryInput } from "@fruitland/shared";
import { apiFetch } from "./apiClient";

export type { CategoryDto };

export const fetchCategories = () => apiFetch<CategoryDto[]>("/admin/categories");
export const createCategory = (body: CreateCategoryInput) => apiFetch<CategoryDto>("/admin/categories", { method: "POST", body });
export const updateCategory = (id: string, body: UpdateCategoryInput) =>
  apiFetch<CategoryDto>(`/admin/categories/${encodeURIComponent(id)}`, { method: "PATCH", body });
export const setCategoryActive = (id: string, isActive: boolean) =>
  apiFetch<CategoryDto>(`/admin/categories/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { isActive } });
