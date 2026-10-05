import { z } from "zod";

/**
 * Admin Category input schemas — the single source of validation for the
 * Categories admin API (server, authoritative) and form (client, UX only).
 *
 * Deliberate rules (no business rule is invented here):
 *  - `slug` is lowercase ASCII kebab-case: it is a URL/identifier token, and the
 *    Category model already lowercases + uniquely indexes it.
 *  - `icon` is a short free-text identifier/emoji (legacy used emoji such as 🍎);
 *    there is no icon catalog and no upload in this phase.
 *  - `sortOrder` is a non-negative integer; negative values have no documented
 *    domain meaning, so they are rejected.
 *  - `isActive` is NOT part of create/update: it only changes through the
 *    explicit status operation, and a new category is always created active
 *    (the model default). Unknown keys are stripped (project-wide z.object
 *    convention), so a client can never smuggle other fields in.
 */

export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const name = z.string({ required_error: "نام دسته‌بندی الزامی است", invalid_type_error: "نام دسته‌بندی نامعتبر است" })
  .trim()
  .min(1, "نام دسته‌بندی الزامی است")
  .max(50, "نام دسته‌بندی حداکثر ۵۰ نویسه باشد");

const slug = z.string({ required_error: "شناسه (slug) الزامی است", invalid_type_error: "شناسه (slug) نامعتبر است" })
  .trim()
  .toLowerCase()
  .min(1, "شناسه (slug) الزامی است")
  .max(60, "شناسه (slug) حداکثر ۶۰ نویسه باشد")
  .regex(CATEGORY_SLUG_PATTERN, "شناسه فقط می‌تواند شامل حروف کوچک انگلیسی، عدد و خط تیره (بین کلمات) باشد");

/** Empty string is allowed and means "no icon" (the service stores/clears it accordingly). */
const icon = z.string({ invalid_type_error: "آیکون نامعتبر است" }).trim().max(16, "آیکون حداکثر ۱۶ نویسه باشد");

const sortOrder = z
  .number({ invalid_type_error: "ترتیب نمایش باید عدد باشد", required_error: "ترتیب نمایش الزامی است" })
  .int("ترتیب نمایش باید عدد صحیح باشد")
  .min(0, "ترتیب نمایش نمی‌تواند منفی باشد")
  .max(Number.MAX_SAFE_INTEGER, "ترتیب نمایش بیش از حد بزرگ است");

export const createCategorySchema = z.object({
  name,
  slug,
  icon: icon.optional(),
  sortOrder: sortOrder.optional(),
});

export const updateCategorySchema = z
  .object({ name: name.optional(), slug: slug.optional(), icon: icon.optional(), sortOrder: sortOrder.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "حداقل یک فیلد برای ویرایش لازم است" });

export const categoryStatusSchema = z.object({
  isActive: z.boolean({ required_error: "وضعیت فعال/غیرفعال الزامی است", invalid_type_error: "وضعیت باید فعال یا غیرفعال باشد" }),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CategoryStatusInput = z.infer<typeof categoryStatusSchema>;

/** The Category shape every admin endpoint returns (a DTO, never the raw Mongoose document). */
export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
