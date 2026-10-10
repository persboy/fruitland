import { z } from "zod";
import { VEHICLE_TYPES, type CourierStatus, type VehicleType } from "./enums";
import { normalizeDigits } from "./customer";

/**
 * Admin Couriers input schemas (MASTER-PROMPT §39 Phase 4, page 8). A courier is
 * a `User` with role "courier" + an embedded `courierProfile` — there is no
 * Courier model.
 *
 * Owner-frozen rules for this page:
 *  - A courier is made ONLY by promoting an existing, active customer who has a
 *    first and last name. There is no downgrade and no hard delete.
 *  - `vehicleType` is required on promotion; `plateNumber` is optional and
 *    editable. No plate format exists in the project, so none is invented:
 *    trimmed, ≤ 20 chars, no `<`/`>`; `""` clears it (same convention as the
 *    other optional text fields); Persian digits are normalised to ASCII.
 *  - Request bodies reject unknown / protected keys (role, courierProfile,
 *    status, currentLocation, isActive on create/update, audit fields…) with a
 *    400 instead of silently stripping them.
 *  - The list query is bounded exactly like Customers (limit 1–100, default 20,
 *    search ≤ 50 chars, out-of-range rejected rather than clamped).
 */

export const COURIER_STATUS_FILTERS = ["active", "inactive", "all"] as const;
export type CourierStatusFilter = (typeof COURIER_STATUS_FILTERS)[number];

export const COURIER_LIST_DEFAULT_LIMIT = 20;
export const COURIER_LIST_MAX_LIMIT = 100;
export const COURIER_SEARCH_MAX_LENGTH = 50;
export const COURIER_PLATE_MAX_LENGTH = 20;
/** Same bound the Customers page applies to first/last name; a customer outside it is not promotable. */
export const COURIER_NAME_MAX_LENGTH = 50;

/** A usable name for promotion: non-blank, ≤ 50 chars, no `<` / `>` (same rule as the Customers profile). */
export const isValidCourierName = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && value.trim().length <= COURIER_NAME_MAX_LENGTH && !/[<>]/.test(value);

export const courierListQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: "شماره‌ی صفحه نامعتبر است" })
    .int("شماره‌ی صفحه باید عدد صحیح باشد")
    .min(1, "شماره‌ی صفحه باید حداقل ۱ باشد")
    .max(1_000_000, "شماره‌ی صفحه بیش از حد بزرگ است")
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: "تعداد در صفحه نامعتبر است" })
    .int("تعداد در صفحه باید عدد صحیح باشد")
    .min(1, "تعداد در صفحه باید حداقل ۱ باشد")
    .max(COURIER_LIST_MAX_LIMIT, `تعداد در صفحه حداکثر ${COURIER_LIST_MAX_LIMIT} باشد`)
    .default(COURIER_LIST_DEFAULT_LIMIT),
  search: z
    .string()
    .trim()
    .max(COURIER_SEARCH_MAX_LENGTH, `عبارت جست‌وجو حداکثر ${COURIER_SEARCH_MAX_LENGTH} نویسه باشد`)
    .transform((v) => normalizeDigits(v))
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  status: z.enum(COURIER_STATUS_FILTERS, { errorMap: () => ({ message: "فیلتر وضعیت نامعتبر است" }) }).default("all"),
});

const userIdSchema = z
  .string({ required_error: "شناسه‌ی کاربر الزامی است", invalid_type_error: "شناسه‌ی کاربر نامعتبر است" })
  .trim()
  .regex(/^[a-f0-9]{24}$/i, "شناسه‌ی کاربر نامعتبر است");

const vehicleTypeSchema = z.enum(VEHICLE_TYPES, {
  errorMap: (issue, ctx) => ({
    message: issue.code === "invalid_type" && ctx.data === undefined ? "نوع وسیله‌ی نقلیه الزامی است" : "نوع وسیله‌ی نقلیه نامعتبر است",
  }),
});

/** `""` clears the plate (on update) / means "none" (on create); Persian digits are converted to ASCII. */
const plateNumberSchema = z
  .string({ invalid_type_error: "پلاک نامعتبر است" })
  .trim()
  .max(COURIER_PLATE_MAX_LENGTH, `پلاک حداکثر ${COURIER_PLATE_MAX_LENGTH} نویسه باشد`)
  .refine((v) => !/[<>]/.test(v), "پلاک نمی‌تواند شامل نویسه‌های < یا > باشد")
  .transform((v) => normalizeDigits(v));

const rejectUnknownKeys = (allowed: readonly string[]) => (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `فیلد «${key}» مجاز نیست` });
    }
  }
};

const CREATE_KEYS = ["userId", "vehicleType", "plateNumber"] as const;
const UPDATE_KEYS = ["vehicleType", "plateNumber"] as const;
const STATUS_KEYS = ["isActive"] as const;

/** Promote an existing customer. `plateNumber: ""` is normalised to "absent". */
export const createCourierSchema = z
  .object({ userId: userIdSchema, vehicleType: vehicleTypeSchema, plateNumber: plateNumberSchema.optional() })
  .passthrough()
  .superRefine(rejectUnknownKeys(CREATE_KEYS))
  .transform(({ userId, vehicleType, plateNumber }) => ({
    userId,
    vehicleType,
    ...(plateNumber ? { plateNumber } : {}),
  }));

/** Partial update of the two editable profile fields; at least one is required; `plateNumber: ""` clears the plate. */
export const updateCourierSchema = z
  .object({ vehicleType: vehicleTypeSchema.optional(), plateNumber: plateNumberSchema.optional() })
  .passthrough()
  .superRefine(rejectUnknownKeys(UPDATE_KEYS))
  .refine((v) => v.vehicleType !== undefined || v.plateNumber !== undefined, { message: "حداقل یک فیلد برای ویرایش لازم است" })
  .transform(({ vehicleType, plateNumber }) => ({
    ...(vehicleType !== undefined ? { vehicleType } : {}),
    ...(plateNumber !== undefined ? { plateNumber } : {}),
  }));

/** Explicit set (not a toggle). Availability status and location are never accepted. */
export const courierStatusSchema = z
  .object({
    isActive: z.boolean({ required_error: "وضعیت فعال/غیرفعال الزامی است", invalid_type_error: "وضعیت باید فعال یا غیرفعال باشد" }),
  })
  .passthrough()
  .superRefine(rejectUnknownKeys(STATUS_KEYS))
  .transform(({ isActive }) => ({ isActive }));

export type CourierListQuery = z.infer<typeof courierListQuerySchema>;
export type CreateCourierRequest = z.infer<typeof createCourierSchema>;
export type UpdateCourierRequest = z.infer<typeof updateCourierSchema>;

/**
 * The ONLY shape in which a courier ever leaves the server. `isActive` is the
 * account state (User.isActive); `availabilityStatus` is `courierProfile.status`
 * (read-only here, a separate concept). The courier's location, addresses,
 * codes and credentials are never part of it.
 */
export interface CourierDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  isActive: boolean;
  /** null only for a malformed legacy document with a courier role but no profile. */
  vehicleType: VehicleType | null;
  plateNumber: string | null;
  availabilityStatus: CourierStatus;
  createdAt: string;
}

export interface CourierListResult {
  items: CourierDto[];
  pagination: { page: number; pageSize: number; total: number };
}
