import { SINGLETON_KEY } from "../models/schemaUtils";
import { AuditLog } from "../models/AuditLog";
import { ShippingSettings } from "../models/ShippingSettings";
import { StoreSettings } from "../models/StoreSettings";

/**
 * Both settings are singleton documents that do NOT exist until an admin
 * saves them for the first time. Nothing is seeded on purpose: there are no
 * approved default values (e.g. a delivery fee), and inventing one would be
 * inventing a business rule. Until configured, GET reports `isConfigured: false`.
 */

export interface StoreSettingsDto {
  storeName: string;
  supportPhone: string;
  address: string;
  isConfigured: boolean;
}

export interface ShippingSettingsDto {
  expressDeliveryFee: number | null;
  freeDeliveryThreshold: number | null;
  isConfigured: boolean;
}

export async function getStoreSettings(): Promise<StoreSettingsDto> {
  const doc = await StoreSettings.findOne({ key: SINGLETON_KEY });
  return {
    storeName: doc?.storeName ?? "",
    supportPhone: doc?.supportPhone ?? "",
    address: doc?.address ?? "",
    isConfigured: Boolean(doc),
  };
}

export async function updateStoreSettings(
  actorUserId: string,
  input: { storeName: string; supportPhone: string; address: string },
): Promise<StoreSettingsDto> {
  const before = await StoreSettings.findOne({ key: SINGLETON_KEY });
  const after = await StoreSettings.findOneAndUpdate(
    { key: SINGLETON_KEY },
    { $set: input, $setOnInsert: { key: SINGLETON_KEY } },
    { upsert: true, new: true, runValidators: true },
  );
  await AuditLog.create({
    actorUserId,
    action: "settings.store_updated",
    entityType: "StoreSettings",
    entityId: after._id,
    before: before ? { storeName: before.storeName, supportPhone: before.supportPhone, address: before.address ?? "" } : null,
    after: input,
  });
  return { ...input, isConfigured: true };
}

export async function getShippingSettings(): Promise<ShippingSettingsDto> {
  const doc = await ShippingSettings.findOne({ key: SINGLETON_KEY });
  return {
    expressDeliveryFee: doc?.expressDeliveryFee ?? null,
    freeDeliveryThreshold: doc?.freeDeliveryThreshold ?? null,
    isConfigured: Boolean(doc),
  };
}

export async function updateShippingSettings(
  actorUserId: string,
  input: { expressDeliveryFee: number; freeDeliveryThreshold: number },
): Promise<ShippingSettingsDto> {
  const before = await ShippingSettings.findOne({ key: SINGLETON_KEY });
  const after = await ShippingSettings.findOneAndUpdate(
    { key: SINGLETON_KEY },
    { $set: input, $setOnInsert: { key: SINGLETON_KEY } },
    { upsert: true, new: true, runValidators: true },
  );
  await AuditLog.create({
    actorUserId,
    action: "settings.shipping_updated",
    entityType: "ShippingSettings",
    entityId: after._id,
    before: before
      ? { expressDeliveryFee: before.expressDeliveryFee, freeDeliveryThreshold: before.freeDeliveryThreshold }
      : null,
    after: input,
  });
  return { ...input, isConfigured: true };
}
