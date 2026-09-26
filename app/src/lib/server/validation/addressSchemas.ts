import { z } from "zod";
import { ADDRESS_LABELS, coordinatesSchema } from "@fruitland/shared";

/**
 * Reuses the shared `coordinatesSchema` and `ADDRESS_LABELS` enum directly —
 * no duplicate range/label validation.
 *
 * Deliberately NOT accepted here: `resolvedBy` (provenance). See
 * docs/domain-model.md §8.2 — accepting provider/resolvedAt from the client
 * would let it be forged (anyone could claim "verified by Google" for a
 * hand-typed address). Until Phase 13 wires a real map-resolution flow that
 * can attach it server-side, every address created through this API has no
 * `resolvedBy` at all, and that is honest.
 */
const optionalText = (max: number, message: string) => z.string().trim().max(max, message).optional();

export const createAddressSchema = z.object({
  label: z.enum(ADDRESS_LABELS).optional(),
  recipientName: z.string().trim().min(1, "نام گیرنده الزامی است").max(100, "نام گیرنده حداکثر ۱۰۰ نویسه باشد"),
  phone: z.string().trim().min(1, "شماره تماس الزامی است").max(20, "شماره تماس حداکثر ۲۰ نویسه باشد"),
  province: z.string().trim().min(1, "استان الزامی است").max(100, "استان حداکثر ۱۰۰ نویسه باشد"),
  city: z.string().trim().min(1, "شهر الزامی است").max(100, "شهر حداکثر ۱۰۰ نویسه باشد"),
  district: optionalText(100, "منطقه حداکثر ۱۰۰ نویسه باشد"),
  neighborhood: optionalText(100, "محله حداکثر ۱۰۰ نویسه باشد"),
  street: optionalText(150, "خیابان حداکثر ۱۵۰ نویسه باشد"),
  alley: optionalText(100, "کوچه حداکثر ۱۰۰ نویسه باشد"),
  plaque: optionalText(20, "پلاک حداکثر ۲۰ نویسه باشد"),
  unit: optionalText(20, "واحد حداکثر ۲۰ نویسه باشد"),
  addressLine: z.string().trim().min(1, "آدرس کامل الزامی است").max(500, "آدرس کامل حداکثر ۵۰۰ نویسه باشد"),
  postalCode: optionalText(20, "کد پستی حداکثر ۲۰ نویسه باشد"),
  location: coordinatesSchema,
  deliveryNotes: optionalText(500, "توضیحات تحویل حداکثر ۵۰۰ نویسه باشد"),
  isDefault: z.boolean().optional(),
});

/** Same fields, all optional — but any field that IS given must still pass its full rule (e.g. a given `location` must be fully valid). */
export const updateAddressSchema = createAddressSchema.partial();

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
