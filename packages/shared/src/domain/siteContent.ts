import { z } from "zod";

/**
 * Admin Site Content input schemas (MASTER-PROMPT §39 Phase 4, page 4) — the
 * single validation source for the Site Content admin API (server,
 * authoritative) and forms (client, UX only).
 *
 * Deliberate rules (Owner-frozen for this phase):
 *  - Static pages are a FIXED set (`SITE_CONTENT_PAGE_SLUGS`); there is no free
 *    slug creation. Bodies are PLAIN TEXT: strings that look like HTML tags are
 *    rejected so no HTML is ever stored.
 *  - URLs (`imageUrl`, `linkUrl`, social links) must literally start with
 *    `http://` or `https://` and have a host. Anything else (javascript:, data:,
 *    vbscript:, relative paths, scheme-less text) is rejected, never rewritten.
 *  - `sortOrder` is a non-negative integer (same as Categories).
 *  - `isActive` is NOT part of create/update; it changes only through the
 *    explicit status operation. Unknown keys are stripped (z.object convention).
 */

export const SITE_CONTENT_PAGE_SLUGS = ["about", "terms"] as const;
export type SiteContentPageSlug = (typeof SITE_CONTENT_PAGE_SLUGS)[number];

export const SITE_CONTENT_PAGE_LABELS: Record<SiteContentPageSlug, string> = {
  about: "درباره ما",
  terms: "قوانین و مقررات",
};

export const SOCIAL_PLATFORMS = ["instagram", "telegram", "whatsapp"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "اینستاگرام",
  telegram: "تلگرام",
  whatsapp: "واتس‌اپ",
};

/** http(s) scheme, then a non-empty host, then optional path/query/fragment; no whitespace anywhere. */
export const HTTP_URL_PATTERN = /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i;

/** True when the text contains something shaped like an HTML tag (`<b>`, `</div>`, `<script …>`). */
export const looksLikeHtml = (value: string): boolean => /<\/?[a-z][^>]*>/i.test(value) || /<!--/.test(value);

const plainText = (label: string, max: number, opts: { min?: number } = {}) =>
  z
    .string({ required_error: `${label} الزامی است`, invalid_type_error: `${label} نامعتبر است` })
    .trim()
    .min(opts.min ?? 0, `${label} الزامی است`)
    .max(max, `${label} حداکثر ${max} نویسه باشد`)
    .refine((v) => !looksLikeHtml(v), `${label} باید متن ساده باشد و نمی‌تواند شامل HTML باشد`);

const httpUrl = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label} نامعتبر است` })
    .trim()
    .min(1, `${label} الزامی است`)
    .max(max, `${label} حداکثر ${max} نویسه باشد`)
    .regex(HTTP_URL_PATTERN, `${label} باید با http:// یا https:// شروع شود`);

/** A URL that may be empty. Empty string means "no value" (the service clears it). */
const optionalHttpUrl = (label: string, max: number) =>
  z.union([z.literal(""), httpUrl(label, max)], { invalid_type_error: `${label} نامعتبر است` });

const sortOrder = z
  .number({ invalid_type_error: "ترتیب نمایش باید عدد باشد", required_error: "ترتیب نمایش الزامی است" })
  .int("ترتیب نمایش باید عدد صحیح باشد")
  .min(0, "ترتیب نمایش نمی‌تواند منفی باشد")
  .max(Number.MAX_SAFE_INTEGER, "ترتیب نمایش بیش از حد بزرگ است");

const atLeastOne = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);
const AT_LEAST_ONE = { message: "حداقل یک فیلد برای ویرایش لازم است" };

const isActive = z.boolean({ required_error: "وضعیت فعال/غیرفعال الزامی است", invalid_type_error: "وضعیت باید فعال یا غیرفعال باشد" });

/* ───────── Static pages ───────── */

export const siteContentPageSlugSchema = z.enum(SITE_CONTENT_PAGE_SLUGS, {
  errorMap: () => ({ message: "صفحه‌ی نامعتبر است" }),
});

const pageTitle = plainText("عنوان صفحه", 150, { min: 1 });
const pageBody = plainText("متن صفحه", 10000, { min: 1 });

/** The first save of a page needs title + body (the model requires both); later saves may send any subset. */
export const updateSiteContentPageSchema = z
  .object({
    title: pageTitle.optional(),
    body: pageBody.optional(),
    isPublished: z.boolean({ invalid_type_error: "وضعیت انتشار باید درست یا نادرست باشد" }).optional(),
  })
  .refine(atLeastOne, AT_LEAST_ONE);

/* ───────── FAQ ───────── */

const faqQuestion = plainText("سؤال", 300, { min: 1 });
const faqAnswer = plainText("پاسخ", 2000, { min: 1 });

export const createFaqSchema = z.object({ question: faqQuestion, answer: faqAnswer, sortOrder: sortOrder.optional() });
export const updateFaqSchema = z
  .object({ question: faqQuestion.optional(), answer: faqAnswer.optional(), sortOrder: sortOrder.optional() })
  .refine(atLeastOne, AT_LEAST_ONE);
export const faqStatusSchema = z.object({ isActive });

/* ───────── Homepage slides ───────── */

/** Optional text: "" is allowed and means "no title" (the service clears it). */
const slideTitle = plainText("عنوان اسلاید", 150);
const slideImageUrl = httpUrl("آدرس تصویر", 2000);
const slideLinkUrl = optionalHttpUrl("لینک مقصد", 300);

export const createSlideSchema = z.object({
  imageUrl: slideImageUrl,
  title: slideTitle.optional(),
  linkUrl: slideLinkUrl.optional(),
  sortOrder: sortOrder.optional(),
});
export const updateSlideSchema = z
  .object({ imageUrl: slideImageUrl.optional(), title: slideTitle.optional(), linkUrl: slideLinkUrl.optional(), sortOrder: sortOrder.optional() })
  .refine(atLeastOne, AT_LEAST_ONE);
export const slideStatusSchema = z.object({ isActive });

/* ───────── Social links (physically stored on StoreSettings.socialLinks) ───────── */

export const updateSocialLinksSchema = z
  .object({
    instagram: optionalHttpUrl("لینک اینستاگرام", 300).optional(),
    telegram: optionalHttpUrl("لینک تلگرام", 300).optional(),
    whatsapp: optionalHttpUrl("لینک واتس‌اپ", 300).optional(),
  })
  .refine(atLeastOne, AT_LEAST_ONE);

/* ───────── Types / DTOs ───────── */

export type UpdateSiteContentPageInput = z.infer<typeof updateSiteContentPageSchema>;
export type CreateFaqInput = z.infer<typeof createFaqSchema>;
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>;
export type CreateSlideInput = z.infer<typeof createSlideSchema>;
export type UpdateSlideInput = z.infer<typeof updateSlideSchema>;
export type UpdateSocialLinksInput = z.infer<typeof updateSocialLinksSchema>;

/** A fixed page. `exists:false` means it was never saved: empty title/body and not published. */
export interface SiteContentPageDto {
  slug: SiteContentPageSlug;
  label: string;
  title: string;
  body: string;
  isPublished: boolean;
  exists: boolean;
  updatedAt: string | null;
}

export interface FaqDto {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlideDto {
  id: string;
  imageUrl: string;
  title: string | null;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Every platform is always present; "" means not set. */
export type SocialLinksDto = Record<SocialPlatform, string>;
