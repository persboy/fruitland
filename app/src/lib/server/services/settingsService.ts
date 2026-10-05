import { SOCIAL_PLATFORMS, type SocialLinksDto, type UpdateSocialLinksInput } from "@fruitland/shared";
import type { Types } from "mongoose";
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

/**
 * The store counts as configured only once Settings has saved its required
 * fields. The document alone is not proof: Site Content can create a
 * StoreSettings document that holds only `socialLinks` (see updateSocialLinks),
 * and that must never read as "configured". `updateStoreSettings` validates
 * both fields as non-empty, so every document it writes is configured — the
 * meaning of `isConfigured` for real Settings saves is unchanged.
 */
const isStoreConfigured = (doc: { storeName?: string; supportPhone?: string } | null | undefined): boolean =>
  Boolean(doc?.storeName && doc?.supportPhone);

export async function getStoreSettings(): Promise<StoreSettingsDto> {
  const doc = await StoreSettings.findOne({ key: SINGLETON_KEY });
  return {
    storeName: doc?.storeName ?? "",
    supportPhone: doc?.supportPhone ?? "",
    address: doc?.address ?? "",
    isConfigured: isStoreConfigured(doc),
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
    before: isStoreConfigured(before)
      ? { storeName: before!.storeName, supportPhone: before!.supportPhone, address: before!.address ?? "" }
      : null,
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

/* ───────── Social links (managed from the Site Content admin page) ─────────
 *
 * Physically stored on StoreSettings.socialLinks (Owner decision), but owned by
 * the Site Content UI. Safe partial update rules:
 *  - Each platform is written with its own dotted path (`socialLinks.instagram`),
 *    so concurrent edits of different platforms never overwrite each other and
 *    no other StoreSettings field (name, phone, address) is ever touched.
 *  - An empty string clears that platform ($unset).
 *  - A StoreSettings document is created (upsert) only when there is something
 *    to SET; clearing links never creates one. A document created this way holds
 *    only `socialLinks`, and `isStoreConfigured` keeps reporting it as not
 *    configured until Settings saves the real fields.
 *  - An update that changes nothing performs no write and no audit.
 */

const EMPTY_LINKS = (): SocialLinksDto => ({ instagram: "", telegram: "", whatsapp: "" });

type SocialLinksSource = { socialLinks?: Partial<Record<(typeof SOCIAL_PLATFORMS)[number], string | null>> | null } | null | undefined;

function toSocialLinksDto(doc: SocialLinksSource): SocialLinksDto {
  const links = EMPTY_LINKS();
  for (const p of SOCIAL_PLATFORMS) links[p] = doc?.socialLinks?.[p] ?? "";
  return links;
}

export async function getSocialLinks(): Promise<SocialLinksDto> {
  const doc = await StoreSettings.findOne({ key: SINGLETON_KEY }).lean<SocialLinksSource>();
  return toSocialLinksDto(doc);
}

export async function updateSocialLinks(actorUserId: string, input: UpdateSocialLinksInput): Promise<SocialLinksDto> {
  const current = toSocialLinksDto(await StoreSettings.findOne({ key: SINGLETON_KEY }).lean<SocialLinksSource>());

  const $set: Record<string, string> = {};
  const $unset: Record<string, 1> = {};
  for (const p of SOCIAL_PLATFORMS) {
    const value = input[p];
    if (value === undefined || value === current[p]) continue;
    if (value === "") $unset[`socialLinks.${p}`] = 1;
    else $set[`socialLinks.${p}`] = value;
  }
  if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) return current;

  const update = {
    ...(Object.keys($set).length ? { $set } : {}),
    ...(Object.keys($unset).length ? { $unset } : {}),
    // Only meaningful when the upsert inserts; it never touches an existing document's fields.
    $setOnInsert: { key: SINGLETON_KEY },
  };
  const before = await StoreSettings.findOneAndUpdate({ key: SINGLETON_KEY }, update, {
    new: false,
    // Create the document only when there is a link to store; clearing never creates one.
    upsert: Object.keys($set).length > 0,
    runValidators: true,
  }).lean<(SocialLinksSource & { _id: Types.ObjectId }) | null>();

  const beforeLinks = toSocialLinksDto(before);
  const after = { ...beforeLinks };
  for (const p of SOCIAL_PLATFORMS) {
    const value = input[p];
    if (value !== undefined) after[p] = value;
  }

  // `before` is null when this call inserted the document: fetch its id for the audit entry.
  const entityId = before?._id ?? (await StoreSettings.findOne({ key: SINGLETON_KEY }).lean<{ _id: Types.ObjectId } | null>())?._id;
  if (entityId) {
    await AuditLog.create({
      actorUserId,
      action: "siteContent.social_links_updated",
      entityType: "StoreSettings",
      entityId,
      before: beforeLinks,
      after,
    });
  }
  return after;
}
