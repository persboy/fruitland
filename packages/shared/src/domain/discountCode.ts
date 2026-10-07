import { z } from "zod";
import { DISCOUNT_TYPES, type DiscountType } from "./enums";
import { isValidCalendarDate, normalizeDigits } from "./customer";

/**
 * Admin Discount Codes input schemas (MASTER-PROMPT §39 Phase 4, page 6).
 *
 * Owner-frozen rules for this phase:
 *  - `code` is normalised (Persian digits → ASCII, uppercase) and must match
 *    `A-Z 0-9 _ -`, 3–30 characters. It is immutable after creation, as are `type`
 *    and `ownerUserId`; `usedCount`, `isActive` and the derived `status` are never
 *    editable through the update schema (PATCH rejects them, it does not strip them).
 *  - `percentage` is an integer 1–100; money fields are integer Toman.
 *  - `usageLimit` is optional (missing = unlimited) and ≥ 1; the server additionally
 *    guarantees it never drops below `usedCount`.
 *  - `expiresAt` is entered as a calendar day `YYYY-MM-DD`; the SERVER turns it into
 *    the end of that day in Asia/Tehran (see tehranDate.ts). The DTO carries the
 *    resulting ISO instant.
 *  - `status` is derived (never stored): exhausted > disabled > expired > active.
 *  - The list search covers the code only.
 */

export const DISCOUNT_CODE_MIN_LENGTH = 3;
export const DISCOUNT_CODE_MAX_LENGTH = 30;
export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9_-]+$/;

export const DISCOUNT_CODE_STATUSES = ["active", "disabled", "exhausted", "expired"] as const;
export type DiscountCodeStatus = (typeof DISCOUNT_CODE_STATUSES)[number];

export const DISCOUNT_CODE_STATUS_FILTERS = ["all", ...DISCOUNT_CODE_STATUSES] as const;
export type DiscountCodeStatusFilter = (typeof DISCOUNT_CODE_STATUS_FILTERS)[number];

export const DISCOUNT_CODE_TYPE_FILTERS = ["all", ...DISCOUNT_TYPES] as const;
export type DiscountCodeTypeFilter = (typeof DISCOUNT_CODE_TYPE_FILTERS)[number];

export const DISCOUNT_CODE_LIST_DEFAULT_LIMIT = 20;
export const DISCOUNT_CODE_LIST_MAX_LIMIT = 100;
/** Search only looks at the code, so it can never be longer than a code. */
export const DISCOUNT_CODE_SEARCH_MAX_LENGTH = DISCOUNT_CODE_MAX_LENGTH;

/** Trim → Persian/Arabic digits to ASCII → uppercase. Does not validate. */
export const normalizeDiscountCode = (value: string): string => normalizeDigits(value.trim()).toUpperCase();

export const isValidDiscountCode = (value: string): boolean =>
  value.length >= DISCOUNT_CODE_MIN_LENGTH && value.length <= DISCOUNT_CODE_MAX_LENGTH && DISCOUNT_CODE_PATTERN.test(value);

export const discountCodeSchema = z
  .string({ required_error: "کد تخفیف الزامی است", invalid_type_error: "کد تخفیف نامعتبر است" })
  .transform(normalizeDiscountCode)
  .refine((v) => v.length >= DISCOUNT_CODE_MIN_LENGTH, "کد تخفیف حداقل ۳ نویسه باشد")
  .refine((v) => v.length <= DISCOUNT_CODE_MAX_LENGTH, "کد تخفیف حداکثر ۳۰ نویسه باشد")
  .refine((v) => v.length === 0 || DISCOUNT_CODE_PATTERN.test(v), "کد تخفیف فقط می‌تواند شامل حروف انگلیسی، عدد، _ و - باشد");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const GENERATED_PREFIX = "OFF";
const GENERATED_RANDOM_LENGTH = 8;

/**
 * Builds a valid code (`OFF` + 8 characters from a 32-symbol alphabet ⇒ 11
 * characters, about 10^12 combinations). `randomInt(max)` must return an integer in
 * [0, max) — pass a cryptographic source in production. Uniqueness is NOT
 * guaranteed here: the database unique index remains the final authority.
 */
export function generateDiscountCode(randomInt: (max: number) => number): string {
  let out = GENERATED_PREFIX;
  for (let i = 0; i < GENERATED_RANDOM_LENGTH; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

const ownerUserIdSchema = z
  .string({ invalid_type_error: "شناسه‌ی مشتری نامعتبر است" })
  .trim()
  .regex(/^[a-f0-9]{24}$/i, "شناسه‌ی مشتری نامعتبر است");

const percentageSchema = z
  .number({ required_error: "درصد تخفیف الزامی است", invalid_type_error: "درصد تخفیف باید عدد باشد" })
  .int("درصد تخفیف باید عدد صحیح باشد")
  .min(1, "درصد تخفیف حداقل ۱ باشد")
  .max(100, "درصد تخفیف حداکثر ۱۰۰ باشد");

const MAX_TOMAN = Number.MAX_SAFE_INTEGER;

const maxDiscountAmountSchema = z
  .number({ invalid_type_error: "حداکثر مبلغ تخفیف باید عدد باشد" })
  .int("حداکثر مبلغ تخفیف باید عدد صحیح (تومان) باشد")
  .min(1, "حداکثر مبلغ تخفیف حداقل ۱ تومان باشد")
  .max(MAX_TOMAN, "حداکثر مبلغ تخفیف بیش از حد بزرگ است");

const minOrderAmountSchema = z
  .number({ invalid_type_error: "حداقل مبلغ سفارش باید عدد باشد" })
  .int("حداقل مبلغ سفارش باید عدد صحیح (تومان) باشد")
  .min(0, "حداقل مبلغ سفارش نمی‌تواند منفی باشد")
  .max(MAX_TOMAN, "حداقل مبلغ سفارش بیش از حد بزرگ است");

const usageLimitSchema = z
  .number({ invalid_type_error: "سقف استفاده باید عدد باشد" })
  .int("سقف استفاده باید عدد صحیح باشد")
  .min(1, "سقف استفاده حداقل ۱ باشد")
  .max(MAX_TOMAN, "سقف استفاده بیش از حد بزرگ است");

/** A calendar day `YYYY-MM-DD`; the server converts it to the end of that day in Tehran. */
export const expiryDateSchema = z
  .string({ invalid_type_error: "تاریخ انقضا نامعتبر است" })
  .trim()
  .refine(isValidCalendarDate, "تاریخ انقضا باید یک تاریخ معتبر به‌شکل YYYY-MM-DD باشد");

/** On create an explicit `null` means the same as omitting the optional field. */
const nullishToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => (v === null ? undefined : v)) as z.ZodType<z.output<T> | undefined, z.ZodTypeDef, z.input<T> | null | undefined>;

export const createDiscountCodeSchema = z
  .object({
    code: discountCodeSchema,
    type: z.enum(DISCOUNT_TYPES, { errorMap: () => ({ message: "نوع کد تخفیف نامعتبر است" }) }),
    ownerUserId: nullishToUndefined(ownerUserIdSchema),
    percentage: percentageSchema,
    maxDiscountAmount: nullishToUndefined(maxDiscountAmountSchema),
    minOrderAmount: nullishToUndefined(minOrderAmountSchema),
    usageLimit: nullishToUndefined(usageLimitSchema),
    expiresAt: nullishToUndefined(expiryDateSchema),
  })
  .superRefine((v, ctx) => {
    if (v.type === "personal" && !v.ownerUserId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ownerUserId"], message: "برای کد شخصی باید یک مشتری انتخاب شود" });
    }
    if (v.type === "public" && v.ownerUserId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ownerUserId"], message: "کد عمومی نمی‌تواند مشتری مالک داشته باشد" });
    }
  });

const EDITABLE_KEYS = ["percentage", "maxDiscountAmount", "minOrderAmount", "usageLimit", "expiresAt"] as const;
const IMMUTABLE_KEYS = ["code", "type", "ownerUserId", "usedCount", "isActive", "status"] as const;

/**
 * PATCH body. The optional-capable fields accept `null` to clear them (no cap /
 * unlimited / no expiry); `minOrderAmount` and `percentage` cannot be cleared.
 * Immutable or derived keys are REJECTED (400), unknown keys too — nothing is
 * silently stripped. At least one editable field is required.
 */
export const updateDiscountCodeSchema = z
  .object({
    percentage: percentageSchema.optional(),
    maxDiscountAmount: maxDiscountAmountSchema.nullable().optional(),
    minOrderAmount: minOrderAmountSchema.optional(),
    usageLimit: usageLimitSchema.nullable().optional(),
    expiresAt: expiryDateSchema.nullable().optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    for (const key of Object.keys(v)) {
      if ((EDITABLE_KEYS as readonly string[]).includes(key)) continue;
      const immutable = (IMMUTABLE_KEYS as readonly string[]).includes(key);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: immutable ? `فیلد «${key}» قابل ویرایش نیست` : `فیلد «${key}» نامعتبر است`,
      });
    }
    if (!EDITABLE_KEYS.some((k) => v[k] !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "حداقل یک فیلد برای ویرایش لازم است" });
    }
  })
  .transform((v) => {
    const out: {
      percentage?: number;
      maxDiscountAmount?: number | null;
      minOrderAmount?: number;
      usageLimit?: number | null;
      expiresAt?: string | null;
    } = {};
    for (const key of EDITABLE_KEYS) if (v[key] !== undefined) (out as Record<string, unknown>)[key] = v[key];
    return out;
  });

export const discountCodeStatusSchema = z.object({
  isActive: z.boolean({ required_error: "وضعیت فعال/غیرفعال الزامی است", invalid_type_error: "وضعیت باید فعال یا غیرفعال باشد" }),
});

export const discountCodeListQuerySchema = z.object({
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
    .max(DISCOUNT_CODE_LIST_MAX_LIMIT, `تعداد در صفحه حداکثر ${DISCOUNT_CODE_LIST_MAX_LIMIT} باشد`)
    .default(DISCOUNT_CODE_LIST_DEFAULT_LIMIT),
  search: z
    .string()
    .trim()
    .max(DISCOUNT_CODE_SEARCH_MAX_LENGTH, `عبارت جست‌وجو حداکثر ${DISCOUNT_CODE_SEARCH_MAX_LENGTH} نویسه باشد`)
    .transform(normalizeDiscountCode)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  type: z.enum(DISCOUNT_CODE_TYPE_FILTERS, { errorMap: () => ({ message: "فیلتر نوع نامعتبر است" }) }).default("all"),
  status: z.enum(DISCOUNT_CODE_STATUS_FILTERS, { errorMap: () => ({ message: "فیلتر وضعیت نامعتبر است" }) }).default("all"),
});

export type CreateDiscountCodeInput = z.infer<typeof createDiscountCodeSchema>;
export type UpdateDiscountCodeInput = z.infer<typeof updateDiscountCodeSchema>;
export type DiscountCodeListQuery = z.infer<typeof discountCodeListQuerySchema>;

/** What a client may send (the schema's input side; the server re-validates and normalises). */
export interface CreateDiscountCodeRequest {
  code: string;
  type: DiscountType;
  ownerUserId?: string;
  percentage: number;
  maxDiscountAmount?: number;
  minOrderAmount?: number;
  usageLimit?: number;
  /** `YYYY-MM-DD` — the server turns it into the end of that day in Asia/Tehran. */
  expiresAt?: string;
}

/** `null` clears maxDiscountAmount / usageLimit / expiresAt. Nothing else is accepted. */
export interface UpdateDiscountCodeRequest {
  percentage?: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number;
  usageLimit?: number | null;
  expiresAt?: string | null;
}

/** The only owner data a Discount Code response ever carries. */
export interface DiscountCodeOwnerDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export interface DiscountCodeDto {
  id: string;
  code: string;
  type: DiscountType;
  /** null for public codes. */
  owner: DiscountCodeOwnerDto | null;
  percentage: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  /** null = unlimited. */
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  /** Derived at read time from the fields here — never persisted. */
  status: DiscountCodeStatus;
  /** ISO instant (end of the chosen day in Asia/Tehran) or null. */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountCodeListResult {
  items: DiscountCodeDto[];
  pagination: { page: number; pageSize: number; total: number };
}

/**
 * Status priority is exactly: exhausted > disabled > expired > active.
 *  - exhausted: usageLimit exists and usedCount >= usageLimit
 *  - disabled:  isActive === false
 *  - expired:   active, with an expiresAt that has already passed (strictly before `now`)
 * The service's MongoDB filters mirror this function; integration tests keep them aligned.
 */
export function computeDiscountCodeStatus(
  code: { isActive: boolean; usedCount: number; usageLimit?: number | null; expiresAt?: Date | null },
  now: Date = new Date(),
): DiscountCodeStatus {
  if (typeof code.usageLimit === "number" && code.usedCount >= code.usageLimit) return "exhausted";
  if (!code.isActive) return "disabled";
  if (code.expiresAt && code.expiresAt.getTime() < now.getTime()) return "expired";
  return "active";
}
