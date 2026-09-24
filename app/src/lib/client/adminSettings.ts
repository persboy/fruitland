import { apiFetch } from "./apiClient";
import type { SessionUser } from "./adminAuth";

export interface StoreSettings {
  storeName: string;
  supportPhone: string;
  address: string;
  isConfigured: boolean;
}

export interface ShippingSettings {
  expressDeliveryFee: number | null;
  freeDeliveryThreshold: number | null;
  isConfigured: boolean;
}

export const fetchStoreSettings = () => apiFetch<StoreSettings>("/admin/settings/store");
export const saveStoreSettings = (body: { storeName: string; supportPhone: string; address: string }) =>
  apiFetch<StoreSettings>("/admin/settings/store", { method: "PUT", body });

export const fetchShippingSettings = () => apiFetch<ShippingSettings>("/admin/settings/shipping");
export const saveShippingSettings = (body: { expressDeliveryFee: number; freeDeliveryThreshold: number }) =>
  apiFetch<ShippingSettings>("/admin/settings/shipping", { method: "PUT", body });

export const saveProfileName = (body: { firstName: string; lastName: string }) =>
  apiFetch<SessionUser>("/admin/profile", { method: "PATCH", body });
export const requestPhoneChange = (newPhone: string) =>
  apiFetch<null>("/admin/profile/phone/request", { method: "POST", body: { newPhone } });
export const confirmPhoneChange = (newPhone: string, code: string) =>
  apiFetch<SessionUser>("/admin/profile/phone/confirm", { method: "POST", body: { newPhone, code } });
export const changePassword = (body: { currentPassword?: string; newPassword: string }) =>
  apiFetch<null>("/admin/profile/password", { method: "POST", body });
