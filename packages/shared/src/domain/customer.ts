import { z } from "zod";

/**
 * Admin Customers input schemas (MASTER-PROMPT §39 Phase 4, page 5). A
 * "customer" is a `User` with role "customer" — there is no Customer model.
 *
 * Deliberate rules (Owner-frozen for this phase):
 *  - The list query is bounded: `limit` 1–100 (default 20), `search` ≤ 50 chars;
 *    out-of-range values are rejected (400), never silently clamped.
 *  - The ONLY editable profile fields are firstName, lastName and birthDate.
 *    Everything else (phone, role, isActive, codes, addresses, auth fields…) is
 *    stripped by z.object and can never reach the service. `isActive` changes
 *    only through the dedicated status operation.
 *  - birthDate is a calendar date `YYYY-MM-DD` (Gregorian, no time/zone), a real
 *    date between 1900-01-01 and today (UTC). Clearing it is not supported.
 */

export const CUSTOMER_STATUS_FILTERS = ["active", "inactive", "all"] as const;
export type CustomerStatusFilter = (typeof CUSTOMER_STATUS_FILTERS)[number];

export const CUSTOMER_LIST_DEFAULT_LIMIT = 20;
export const CUSTOMER_LIST_MAX_LIMIT = 100;
export const CUSTOMER_SEARCH_MAX_LENGTH = 50;

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/** Persian/Arabic-Indic digits → ASCII so a phone typed on a Persian keyboard matches. */
export const normalizeDigits = (value: string): string =>
  value.replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9 ? code - PERSIAN_ZERO : code - ARABIC_ZERO);
  });

export const customerListQuerySchema = z.object({
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
    .max(CUSTOMER_LIST_MAX_LIMIT, `تعداد در صفحه حداکثر ${CUSTOMER_LIST_MAX_LIMIT} باشد`)
    .default(CUSTOMER_LIST_DEFAULT_LIMIT),
  search: z
    .string()
    .trim()
    .max(CUSTOMER_SEARCH_MAX_LENGTH, `عبارت جست‌وجو حداکثر ${CUSTOMER_SEARCH_MAX_LENGTH} نویسه باشد`)
    .transform((v) => normalizeDigits(v))
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  status: z.enum(CUSTOMER_STATUS_FILTERS, { errorMap: () => ({ message: "فیلتر وضعیت نامعتبر است" }) }).default("all"),
});

const namePart = z
  .string({ invalid_type_error: "نام نامعتبر است" })
  .trim()
  .max(50, "نام و نام‌خانوادگی حداکثر ۵۰ نویسه باشد")
  .refine((v) => !/[<>]/.test(v), "نام نمی‌تواند شامل نویسه‌های < یا > باشد");

const MIN_BIRTH_DATE = "1900-01-01";

/** Real calendar date `YYYY-MM-DD` (rejects 2024-02-31, 2024-13-01…). */
export const isValidCalendarDate = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
};

const todayUtc = () => new Date().toISOString().slice(0, 10);

export const birthDateSchema = z
  .string({ invalid_type_error: "تاریخ تولد نامعتبر است" })
  .trim()
  .refine(isValidCalendarDate, "تاریخ تولد باید یک تاریخ معتبر به‌شکل YYYY-MM-DD باشد")
  .refine((v) => v >= MIN_BIRTH_DATE, "تاریخ تولد معتبر نیست")
  .refine((v) => v <= todayUtc(), "تاریخ تولد نمی‌تواند در آینده باشد");

/** Empty first/last name is allowed and clears it (same convention as the admin's own profile). */
export const updateCustomerProfileSchema = z
  .object({ firstName: namePart.optional(), lastName: namePart.optional(), birthDate: birthDateSchema.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "حداقل یک فیلد برای ویرایش لازم است" });

export const customerStatusSchema = z.object({
  isActive: z.boolean({ required_error: "وضعیت فعال/غیرفعال الزامی است", invalid_type_error: "وضعیت باید فعال یا غیرفعال باشد" }),
});

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;

/** List row — nothing else about the user is ever serialized. */
export interface CustomerListItemDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  isActive: boolean;
  createdAt: string;
}

/** Read-only address view: no coordinates, no provider provenance, no courier notes. */
export interface CustomerAddressDto {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  addressLine: string;
  postalCode: string | null;
  isDefault: boolean;
}

export interface CustomerDetailDto extends CustomerListItemDto {
  /** `YYYY-MM-DD` or null. */
  birthDate: string | null;
  lastLoginAt: string | null;
  updatedAt: string;
  addresses: CustomerAddressDto[];
}

export interface CustomerListResult {
  items: CustomerListItemDto[];
  pagination: { page: number; pageSize: number; total: number };
}
