import { Types } from "mongoose";
import type { CategoryDto, CreateCategoryInput, UpdateCategoryInput } from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { Category, type ICategory } from "../models/Category";

/**
 * Admin Categories (MASTER-PROMPT §39 Phase 4, page 3).
 *
 * - No hard delete exists (Owner decision): a category leaves active use only
 *   through `isActive = false`; products may keep referencing an inactive one.
 * - `slug` uniqueness is enforced by the MongoDB unique index, which is the
 *   authority — there is deliberately NO check-then-insert. A duplicate-key
 *   error (including one from a concurrent request) becomes CATEGORY_SLUG_TAKEN.
 * - No transaction: every mutation is a single-document write; the AuditLog
 *   entry follows it (same pattern as settingsService).
 * - Authorization is the route's job (`requireAdmin`); the service never
 *   trusts a client-supplied actor, role, id of the audit entity, or isActive
 *   outside the explicit status operation.
 */

type CategoryRecord = ICategory & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const NOT_FOUND = () => AppError.notFound("دسته‌بندی یافت نشد", "CATEGORY_NOT_FOUND");
const SLUG_TAKEN = () => AppError.conflict("این شناسه (slug) قبلاً برای دسته‌بندی دیگری استفاده شده است", "CATEGORY_SLUG_TAKEN");

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

function toDto(c: CategoryRecord): CategoryDto {
  return {
    id: c._id.toString(),
    name: c.name,
    slug: c.slug,
    icon: c.icon ? c.icon : null,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** The audit snapshot of the fields this module administers (no timestamps/internals). */
const snapshot = (c: Pick<ICategory, "name" | "slug" | "icon" | "sortOrder" | "isActive">) => ({
  name: c.name,
  slug: c.slug,
  icon: c.icon ? c.icon : null,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
});

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  return new Types.ObjectId(id);
}

/** Deterministic order: sortOrder ascending, then name, then _id (never MongoDB's natural order). */
export async function listCategories(): Promise<CategoryDto[]> {
  const docs = await Category.find({}).sort({ sortOrder: 1, name: 1, _id: 1 }).lean<CategoryRecord[]>();
  return docs.map(toDto);
}

export async function createCategory(actorUserId: string, input: CreateCategoryInput): Promise<CategoryDto> {
  let created;
  try {
    created = await Category.create({
      name: input.name,
      slug: input.slug,
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      // isActive is never taken from the client: a new category uses the model default (active).
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw SLUG_TAKEN();
    throw err;
  }
  await AuditLog.create({
    actorUserId,
    action: "category.created",
    entityType: "Category",
    entityId: created._id,
    before: null,
    after: snapshot(created),
  });
  return toDto(created as unknown as CategoryRecord);
}

export async function updateCategory(actorUserId: string, id: string, input: UpdateCategoryInput): Promise<CategoryDto> {
  const _id = toObjectId(id);

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  if (input.name !== undefined) $set.name = input.name;
  if (input.slug !== undefined) $set.slug = input.slug;
  if (input.sortOrder !== undefined) $set.sortOrder = input.sortOrder;
  if (input.icon !== undefined) {
    if (input.icon === "") $unset.icon = 1;
    else $set.icon = input.icon;
  }

  let before: CategoryRecord | null;
  try {
    // `new: false` returns the document exactly as it was when THIS update was applied
    // (atomic), so the audit "before" can never be a stale separate read.
    before = await Category.findOneAndUpdate(
      { _id },
      { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
      { new: false, runValidators: true },
    ).lean<CategoryRecord | null>();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw SLUG_TAKEN();
    throw err;
  }
  if (!before) throw NOT_FOUND();

  const after = {
    ...before,
    ...$set,
    ...(input.icon === "" ? { icon: undefined } : {}),
  } as CategoryRecord;
  await AuditLog.create({
    actorUserId,
    action: "category.updated",
    entityType: "Category",
    entityId: _id,
    before: snapshot(before),
    after: snapshot(after),
  });
  // updatedAt is stamped by Mongoose on the write; re-read for an accurate DTO.
  const fresh = await Category.findById(_id).lean<CategoryRecord | null>();
  return toDto(fresh ?? after);
}

/**
 * Explicit activate/deactivate. It sets (not toggles) the requested state, so a
 * retried request is harmless: asking for the state the category already has
 * succeeds without a write and without an audit entry (nothing changed).
 */
export async function setCategoryActive(actorUserId: string, id: string, isActive: boolean): Promise<CategoryDto> {
  const _id = toObjectId(id);
  const current = await Category.findById(_id).lean<CategoryRecord | null>();
  if (!current) throw NOT_FOUND();
  if (current.isActive === isActive) return toDto(current);

  // Conditional on the state we saw: only the request that actually flips it writes + audits.
  const before = await Category.findOneAndUpdate({ _id, isActive: !isActive }, { $set: { isActive } }, { new: false }).lean<CategoryRecord | null>();
  if (!before) {
    const latest = await Category.findById(_id).lean<CategoryRecord | null>();
    if (!latest) throw NOT_FOUND();
    return toDto(latest); // a concurrent request already set this state
  }
  await AuditLog.create({
    actorUserId,
    action: isActive ? "category.activated" : "category.deactivated",
    entityType: "Category",
    entityId: _id,
    before: { isActive: before.isActive },
    after: { isActive },
  });
  const fresh = await Category.findById(_id).lean<CategoryRecord | null>();
  return toDto(fresh ?? { ...before, isActive });
}
