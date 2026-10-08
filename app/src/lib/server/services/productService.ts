import { Types } from "mongoose";
import {
  slugWithSuffix,
  slugifyProductName,
  validateVariantSet,
  type CreateProductInput,
  type ProductCategoryDto,
  type ProductDto,
  type ProductListQuery,
  type ProductListResult,
  type ProductUnit,
  type UpdateProductInput,
} from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { Category } from "../models/Category";
import { Product } from "../models/Product";

/**
 * Admin Products (MASTER-PROMPT §39 Phase 4, page 7).
 *
 * Boundaries (Owner-frozen):
 *  - There is NO hard delete of a product or of a variant. A product leaves use only through
 *    `isActive = false`; a variant only through `isAvailable = false`. The two levels are independent:
 *    deactivating/reactivating a product never touches its variants, and nothing here touches
 *    Orders, Reviews or Categories.
 *  - `slug` is generated from the name HERE (Unicode kebab-case, ASCII numeric suffix on collision) and is
 *    never taken from the client. It stays stable after creation. The unique index is the final authority:
 *    a concurrent insert that wins the same slug triggers a retry with the next free suffix.
 *  - Creating a product, or MOVING it to another category, requires an existing ACTIVE category. A product
 *    that keeps its category is never re-validated against it, and a category that later becomes inactive does
 *    not change its products.
 *  - A variant's `_id` is stable: an update matches submitted entries to existing variants by `id`, carries the
 *    existing `_id` over, and mints an `_id` only for genuinely new entries. The submitted list is the COMPLETE
 *    list — omitting an existing variant is rejected (variants are never deleted; disable via `isAvailable`).
 *    Each unit may appear once and a price is an integer Toman value >= 1, checked on the FINAL merged list.
 *  - Updates use an explicit allowlist and an optimistic-concurrency guard (`updatedAt`): if someone else wrote
 *    between our read and our write, the write misses and the caller gets 409 instead of overwriting.
 *  - No stock, originalPrice, images upload or legacy fields exist; `images` is a plain string[] of URLs.
 *  - Responses are built field-by-field (never `toJSON()`). Single-document atomic writes (no transaction);
 *    the AuditLog entry follows the write, as in the other admin services. A request that changes nothing
 *    writes and audits nothing.
 */

type LeanVariant = { _id: Types.ObjectId; unit: ProductUnit; price: number; isAvailable: boolean };
type LeanProduct = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  categoryId: Types.ObjectId;
  description?: string | null;
  images?: string[] | null;
  isOrganic: boolean;
  isActive: boolean;
  sortOrder: number;
  variants: LeanVariant[];
  createdAt: Date;
  updatedAt: Date;
};
type LeanCategory = { _id: Types.ObjectId; name: string; isActive: boolean };

const NOT_FOUND = () => AppError.notFound("محصول یافت نشد", "PRODUCT_NOT_FOUND");
const CATEGORY_INVALID = () => AppError.badRequest("دسته‌بندی فعال با این شناسه پیدا نشد", "PRODUCT_CATEGORY_INVALID");
const VARIANTS_INVALID = (message: string) => AppError.badRequest(message, "PRODUCT_VARIANTS_INVALID");
const VARIANT_NOT_FOUND = () => AppError.badRequest("یکی از واحدهای فروش ارسال‌شده به این محصول تعلق ندارد", "PRODUCT_VARIANT_NOT_FOUND");
const VARIANT_REMOVAL = () =>
  AppError.badRequest("حذف واحد فروش ممکن نیست؛ برای کنار گذاشتن آن، واحد را «ناموجود» کنید", "PRODUCT_VARIANT_REMOVAL_NOT_ALLOWED");
const CONCURRENT_UPDATE = () =>
  AppError.conflict("این محصول هم‌زمان توسط درخواست دیگری تغییر کرد؛ صفحه را تازه کنید و دوباره تلاش کنید", "PRODUCT_CONCURRENT_UPDATE");
const SLUG_CONFLICT = () => AppError.conflict("ساخت نشانی یکتا برای محصول انجام نشد؛ دوباره تلاش کنید", "PRODUCT_SLUG_CONFLICT");

const isDuplicateKeyError = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

const PRODUCT_PROJECTION = {
  name: 1,
  slug: 1,
  categoryId: 1,
  description: 1,
  images: 1,
  isOrganic: 1,
  isActive: 1,
  sortOrder: 1,
  variants: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;
const CATEGORY_PROJECTION = { name: 1, isActive: 1 } as const;

const MAX_SLUG_ATTEMPTS = 5;

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  return new Types.ObjectId(id);
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toDto(p: LeanProduct, categories: Map<string, LeanCategory>): ProductDto {
  const cat = categories.get(p.categoryId.toString());
  const category: ProductCategoryDto | null = cat ? { id: cat._id.toString(), name: cat.name, isActive: cat.isActive } : null;
  return {
    id: p._id.toString(),
    name: p.name,
    slug: p.slug,
    category,
    description: p.description ? p.description : null,
    images: [...(p.images ?? [])],
    isOrganic: p.isOrganic,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    variants: p.variants.map((v) => ({ id: v._id.toString(), unit: v.unit, price: v.price, isAvailable: v.isAvailable })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function loadCategories(products: LeanProduct[]): Promise<Map<string, LeanCategory>> {
  const ids = [...new Set(products.map((p) => p.categoryId.toString()))];
  if (ids.length === 0) return new Map();
  const cats = await Category.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, CATEGORY_PROJECTION).lean<LeanCategory[]>();
  return new Map(cats.map((c) => [c._id.toString(), c]));
}

/** The fields an admin can edit — recorded by the update audit (no timestamps, no slug, no isActive). */
const editableSnapshot = (p: Pick<LeanProduct, "name" | "categoryId" | "description" | "images" | "isOrganic" | "sortOrder" | "variants">) => ({
  name: p.name,
  categoryId: p.categoryId.toString(),
  description: p.description ? p.description : null,
  images: [...(p.images ?? [])],
  isOrganic: p.isOrganic,
  sortOrder: p.sortOrder,
  variants: p.variants.map((v) => ({ id: v._id.toString(), unit: v.unit, price: v.price, isAvailable: v.isAvailable })),
});

async function requireActiveCategory(categoryId: string): Promise<Types.ObjectId> {
  if (!Types.ObjectId.isValid(categoryId)) throw CATEGORY_INVALID();
  const _id = new Types.ObjectId(categoryId);
  // Existence AND isActive in one filter: a missing and an inactive category are indistinguishable (same 400).
  const found = await Category.findOne({ _id, isActive: true }, { _id: 1 }).lean<{ _id: Types.ObjectId } | null>();
  if (!found) throw CATEGORY_INVALID();
  return _id;
}

/** First free `base`, `base-2`, `base-3`… among the slugs currently stored. */
async function nextFreeSlug(base: string): Promise<string> {
  const taken = await Product.find({ slug: { $regex: new RegExp(`^${escapeRegex(base)}(?:-\\d+)?$`) } }, { slug: 1 }).lean<{ slug: string }[]>();
  const used = new Set(taken.map((t) => t.slug));
  for (let n = 1; ; n += 1) {
    const candidate = slugWithSuffix(base, n);
    if (!used.has(candidate)) return candidate;
  }
}

export async function listProducts(query: ProductListQuery): Promise<ProductListResult> {
  const conditions: Record<string, unknown>[] = [];
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i"); // user input is always escaped
    conditions.push({ $or: [{ name: rx }, { slug: rx }] });
  }
  if (query.categoryId) conditions.push({ categoryId: new Types.ObjectId(query.categoryId) });
  if (query.isActive !== undefined) conditions.push({ isActive: query.isActive });
  if (query.isOrganic !== undefined) conditions.push({ isOrganic: query.isOrganic });
  const filter = conditions.length > 0 ? { $and: conditions } : {};

  const [docs, total] = await Promise.all([
    Product.find(filter, PRODUCT_PROJECTION)
      .sort({ sortOrder: 1, name: 1, _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<LeanProduct[]>(),
    Product.countDocuments(filter),
  ]);
  const categories = await loadCategories(docs);
  return { items: docs.map((d) => toDto(d, categories)), pagination: { page: query.page, pageSize: query.limit, total } };
}

export async function getProduct(id: string): Promise<ProductDto> {
  const _id = toObjectId(id);
  const doc = await Product.findOne({ _id }, PRODUCT_PROJECTION).lean<LeanProduct | null>();
  if (!doc) throw NOT_FOUND();
  return toDto(doc, await loadCategories([doc]));
}

export async function createProduct(actorUserId: string, input: CreateProductInput): Promise<ProductDto> {
  const categoryId = await requireActiveCategory(input.categoryId);
  const variants = input.variants.map((v) => ({ unit: v.unit, price: v.price, isAvailable: v.isAvailable ?? true }));
  const variantError = validateVariantSet(variants);
  if (variantError) throw VARIANTS_INVALID(variantError);
  const base = slugifyProductName(input.name);
  if (!base) throw AppError.badRequest("نام محصول باید حداقل یک حرف یا عدد داشته باشد", "VALIDATION_ERROR");

  let created;
  for (let attempt = 0; ; attempt += 1) {
    if (attempt >= MAX_SLUG_ATTEMPTS) throw SLUG_CONFLICT();
    const slug = await nextFreeSlug(base);
    try {
      created = await Product.create({
        name: input.name,
        slug,
        categoryId,
        ...(input.description ? { description: input.description } : {}),
        images: input.images ?? [],
        isOrganic: input.isOrganic ?? false,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        variants,
      });
      break;
    } catch (err) {
      if (isDuplicateKeyError(err)) continue; // someone else took this slug between our read and our insert
      throw err;
    }
  }

  const record = created.toObject() as unknown as LeanProduct;
  await AuditLog.create({
    actorUserId,
    action: "product.created",
    entityType: "Product",
    entityId: record._id,
    before: null,
    after: { slug: record.slug, isActive: record.isActive, ...editableSnapshot(record) },
  });
  return toDto(record, await loadCategories([record]));
}

type MergedVariant = LeanVariant;

/** Matches submitted entries to the existing variants by id, preserving every existing `_id`; only new entries get a new one. */
function mergeVariants(existing: LeanVariant[], submitted: NonNullable<UpdateProductInput["variants"]>): MergedVariant[] {
  const byId = new Map(existing.map((v) => [v._id.toString(), v]));
  const seen = new Set<string>();
  const merged: MergedVariant[] = [];
  for (const item of submitted) {
    if (item.id) {
      const key = item.id.toLowerCase();
      const current = byId.get(key);
      if (!current) throw VARIANT_NOT_FOUND();
      seen.add(key);
      merged.push({
        _id: current._id,
        unit: item.unit ?? current.unit,
        price: item.price ?? current.price,
        isAvailable: item.isAvailable ?? current.isAvailable,
      });
    } else {
      // The schema guarantees unit and price for entries without an id.
      merged.push({ _id: new Types.ObjectId(), unit: item.unit as ProductUnit, price: item.price as number, isAvailable: item.isAvailable ?? true });
    }
  }
  if (existing.some((v) => !seen.has(v._id.toString()))) throw VARIANT_REMOVAL();
  const error = validateVariantSet(merged);
  if (error) throw VARIANTS_INVALID(error);
  return merged;
}

const sameVariants = (a: LeanVariant[], b: MergedVariant[]) =>
  a.length === b.length && a.every((v, i) => v._id.equals(b[i]!._id) && v.unit === b[i]!.unit && v.price === b[i]!.price && v.isAvailable === b[i]!.isAvailable);

const sameStrings = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export async function updateProduct(actorUserId: string, id: string, input: UpdateProductInput): Promise<ProductDto> {
  const _id = toObjectId(id);
  const current = await Product.findOne({ _id }, PRODUCT_PROJECTION).lean<LeanProduct | null>();
  if (!current) throw NOT_FOUND();

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};

  if (input.name !== undefined && input.name !== current.name) $set.name = input.name;
  if (input.categoryId !== undefined && input.categoryId.toLowerCase() !== current.categoryId.toString()) {
    $set.categoryId = await requireActiveCategory(input.categoryId); // only a CHANGE is validated; an unchanged (possibly inactive) category stays as is
  }
  if (input.description !== undefined) {
    if (input.description === "") {
      if (current.description) $unset.description = 1;
    } else if (input.description !== current.description) {
      $set.description = input.description;
    }
  }
  if (input.images !== undefined && !sameStrings(input.images, current.images ?? [])) $set.images = input.images;
  if (input.isOrganic !== undefined && input.isOrganic !== current.isOrganic) $set.isOrganic = input.isOrganic;
  if (input.sortOrder !== undefined && input.sortOrder !== current.sortOrder) $set.sortOrder = input.sortOrder;
  if (input.variants !== undefined) {
    const merged = mergeVariants(current.variants, input.variants);
    if (!sameVariants(current.variants, merged)) $set.variants = merged.map((v) => ({ _id: v._id, unit: v.unit, price: v.price, isAvailable: v.isAvailable }));
  }

  if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) return getProduct(id); // no-op: no write, no audit

  // `updatedAt` in the filter is an optimistic lock; `new: false` returns the document exactly as this write found it.
  const before = await Product.findOneAndUpdate(
    { _id, updatedAt: current.updatedAt },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: false, runValidators: true, projection: PRODUCT_PROJECTION },
  ).lean<LeanProduct | null>();

  if (!before) {
    const exists = await Product.findOne({ _id }, { _id: 1 }).lean<{ _id: Types.ObjectId } | null>();
    if (!exists) throw NOT_FOUND();
    throw CONCURRENT_UPDATE();
  }

  const after = { ...before, ...$set } as LeanProduct;
  for (const key of Object.keys($unset)) delete (after as Record<string, unknown>)[key];
  await AuditLog.create({
    actorUserId,
    action: "product.updated",
    entityType: "Product",
    entityId: _id,
    before: editableSnapshot(before),
    after: editableSnapshot(after),
  });
  return getProduct(id);
}

/**
 * Explicit activate/deactivate (set, not toggle) — changes `isActive` and nothing else (variants, category, orders and
 * reviews are untouched). The state the product already has is a successful no-op without a write or audit entry; the
 * write is conditional on the state we saw, so of two racing opposite requests only the one that flips it audits.
 */
export async function setProductActive(actorUserId: string, id: string, isActive: boolean): Promise<ProductDto> {
  const _id = toObjectId(id);
  const current = await Product.findOne({ _id }, { isActive: 1 }).lean<Pick<LeanProduct, "_id" | "isActive"> | null>();
  if (!current) throw NOT_FOUND();
  if (current.isActive === isActive) return getProduct(id);

  const before = await Product.findOneAndUpdate({ _id, isActive: !isActive }, { $set: { isActive } }, { new: false, projection: { isActive: 1 } }).lean<
    Pick<LeanProduct, "_id" | "isActive"> | null
  >();
  if (before) {
    await AuditLog.create({
      actorUserId,
      action: isActive ? "product.activated" : "product.deactivated",
      entityType: "Product",
      entityId: _id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
  }
  return getProduct(id);
}
