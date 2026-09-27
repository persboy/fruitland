import type { AddressDto } from "@/lib/server/services/addressService";
import type { CreateAddressInput, UpdateAddressInput } from "@/lib/server/validation/addressSchemas";
import { apiFetch } from "./apiClient";

/**
 * Thin wrapper over the existing `/api/v1/addresses` routes (Phase 11).
 * Types are imported `type`-only from the server (erased at build time, zero
 * bundle cost) so the DTO/input shapes are defined exactly once, not
 * duplicated client-side. Ownership (`userId`) is never a parameter here —
 * the server derives it from the session; nothing forges it from this side.
 */
export type { AddressDto, CreateAddressInput, UpdateAddressInput };

export const listAddresses = () => apiFetch<AddressDto[]>("/addresses");
export const getAddress = (id: string) => apiFetch<AddressDto>(`/addresses/${id}`);
export const createAddress = (input: CreateAddressInput) => apiFetch<AddressDto>("/addresses", { method: "POST", body: input });
export const updateAddress = (id: string, input: UpdateAddressInput) => apiFetch<AddressDto>(`/addresses/${id}`, { method: "PATCH", body: input });
export const deleteAddress = (id: string) => apiFetch<null>(`/addresses/${id}`, { method: "DELETE" });
export const setDefaultAddress = (id: string) => apiFetch<AddressDto>(`/addresses/${id}/default`, { method: "POST" });
