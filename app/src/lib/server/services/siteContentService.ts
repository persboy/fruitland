import type { SiteContentPageDto, SiteContentPageSlug, UpdateSiteContentPageInput } from "@fruitland/shared";
import { SITE_CONTENT_PAGE_LABELS, SITE_CONTENT_PAGE_SLUGS } from "@fruitland/shared";
import { Types } from "mongoose";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { SiteContent, type ISiteContent } from "../models/SiteContent";

/**
 * Admin static pages (MASTER-PROMPT §39 Phase 4, page 4).
 *
 * - The set of pages is FIXED (`SITE_CONTENT_PAGE_SLUGS`): an unknown slug is a
 *   404, there is no free page creation. A page document is created lazily by
 *   its first save, which therefore needs both title and body (the model
 *   requires them). Nothing is seeded.
 * - The unique index on `slug` is the integrity authority: creation is a plain
 *   insert (no check-then-insert guard); a duplicate-key error — including from a
 *   concurrent first save — becomes SITE_PAGE_SLUG_TAKEN (409).
 * - Bodies are plain text (validated by the shared schema); no HTML is stored.
 * - Single-document writes, no transaction; the AuditLog entry follows the write
 *   (same pattern as categoryService/settingsService). Authorization is the
 *   route's job (`requireAdmin`).
 */

type PageRecord = ISiteContent & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const NOT_FOUND = () => AppError.notFound("صفحه یافت نشد", "SITE_PAGE_NOT_FOUND");
const SLUG_TAKEN = () => AppError.conflict("این صفحه هم‌زمان توسط درخواست دیگری ساخته شد؛ دوباره تلاش کنید", "SITE_PAGE_SLUG_TAKEN");
const CONTENT_REQUIRED = () =>
  AppError.badRequest("برای اولین ذخیره‌ی این صفحه، عنوان و متن هر دو لازم است", "SITE_PAGE_CONTENT_REQUIRED");

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

const isKnownSlug = (slug: string): slug is SiteContentPageSlug => (SITE_CONTENT_PAGE_SLUGS as readonly string[]).includes(slug);

function toDto(slug: SiteContentPageSlug, doc: PageRecord | null | undefined): SiteContentPageDto {
  return {
    slug,
    label: SITE_CONTENT_PAGE_LABELS[slug],
    title: doc?.title ?? "",
    body: doc?.body ?? "",
    isPublished: doc ? doc.isPublished : false,
    exists: Boolean(doc),
    updatedAt: doc ? doc.updatedAt.toISOString() : null,
  };
}

const snapshot = (p: Pick<ISiteContent, "title" | "body" | "isPublished">) => ({ title: p.title, body: p.body, isPublished: p.isPublished });

/** Always returns every supported page, in the fixed order; a never-saved page is `exists:false`. */
export async function listSiteContentPages(): Promise<SiteContentPageDto[]> {
  const docs = await SiteContent.find({ slug: { $in: [...SITE_CONTENT_PAGE_SLUGS] } }).lean<PageRecord[]>();
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  return SITE_CONTENT_PAGE_SLUGS.map((slug) => toDto(slug, bySlug.get(slug)));
}

export async function updateSiteContentPage(
  actorUserId: string,
  slug: string,
  input: UpdateSiteContentPageInput,
): Promise<SiteContentPageDto> {
  if (!isKnownSlug(slug)) throw NOT_FOUND();

  const current = await SiteContent.findOne({ slug }).lean<PageRecord | null>();

  if (!current) {
    if (input.title === undefined || input.body === undefined) throw CONTENT_REQUIRED();
    let created;
    try {
      created = await SiteContent.create({
        slug,
        title: input.title,
        body: input.body,
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw SLUG_TAKEN();
      throw err;
    }
    await AuditLog.create({
      actorUserId,
      action: "siteContent.page_created",
      entityType: "SiteContent",
      entityId: created._id,
      before: null,
      after: { slug, ...snapshot(created) },
    });
    return toDto(slug, created as unknown as PageRecord);
  }

  const $set: Record<string, unknown> = {};
  if (input.title !== undefined && input.title !== current.title) $set.title = input.title;
  if (input.body !== undefined && input.body !== current.body) $set.body = input.body;
  if (input.isPublished !== undefined && input.isPublished !== current.isPublished) $set.isPublished = input.isPublished;
  if (Object.keys($set).length === 0) return toDto(slug, current); // nothing changed: no write, no audit

  // `new: false` returns the document as it was when THIS update applied (atomic audit "before").
  const before = await SiteContent.findOneAndUpdate({ slug }, { $set }, { new: false, runValidators: true }).lean<PageRecord | null>();
  if (!before) throw NOT_FOUND();

  const after = { ...before, ...$set } as PageRecord;
  const onlyPublication = Object.keys($set).length === 1 && "isPublished" in $set;
  await AuditLog.create({
    actorUserId,
    action: onlyPublication ? (after.isPublished ? "siteContent.page_published" : "siteContent.page_unpublished") : "siteContent.page_updated",
    entityType: "SiteContent",
    entityId: before._id,
    before: snapshot(before),
    after: snapshot(after),
  });
  const fresh = await SiteContent.findOne({ slug }).lean<PageRecord | null>();
  return toDto(slug, fresh ?? after);
}
