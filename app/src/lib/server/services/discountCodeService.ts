import { Types } from "mongoose";
import {
  computeDiscountCodeStatus,
  endOfTehranDay,
  type CreateDiscountCodeInput,
  type DiscountCodeDto,
  type DiscountCodeListQuery,
  type DiscountCodeListResult,
  type DiscountCodeOwnerDto,
  type DiscountCodeStatusFilter,
  type DiscountType,
  type UpdateDiscountCodeInput,
} from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { DiscountCode } from "../models/DiscountCode";
import { User } from "../models/User";

/**
 * Admin Discount Codes (MASTER-PROMPT §39 Phase 4, page 6).
 *
 * Boundaries (Owner-frozen):
 *  - There is NO hard delete. A code leaves use only through `isActive = false`
 *    (its own operation). `code`, `type` and `ownerUserId` never change after
 *    creation; `usedCount` is never written here (no redemption/release/reset —
 *    that belongs to Checkout/Orders). `Order.discountCode`/`discountAmount` are untouched.
 *  - `status` is derived at read time (shared `computeDiscountCodeStatus`) and never
 *    persisted. The list's status filter is a MongoDB filter that mirrors that function.
 *  - `code` uniqueness is decided by the unique index only (no check-then-insert); a
 *    duplicate-key error — including one from a concurrent request — becomes 409.
 *  - A personal code's owner must be an ACTIVE CUSTOMER at creation time. Later changes to
 *    the customer's status do not touch the code.
 *  - `expiresAt` arrives as a calendar day and is converted HERE to the end of that day in
 *    Asia/Tehran (the browser's timezone is never used).
 *  - `usageLimit` may be raised, lowered or cleared (= unlimited), but never below
 *    `usedCount`: the guard `usedCount <= newLimit` is part of the SAME conditional update,
 *    so a concurrent usage increase cannot slip between a read and the write.
 *  - Responses are built field-by-field from explicit projections (never `toJSON()`); the
 *    owner is limited to id/firstName/lastName/phone.
 *  - Single-document atomic writes (no transaction); the AuditLog entry follows the write,
 *    as in the other admin services. A request that changes nothing writes/audits nothing.
 */

type LeanCode = {
  _id: Types.ObjectId;
  code: string;
  type: DiscountType;
  ownerUserId?: Types.ObjectId | null;
  percentage: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number | null;
  usageLimit?: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
type LeanOwner = { _id: Types.ObjectId; firstName?: string; lastName?: string; phone?: string };

const NOT_FOUND = () => AppError.notFound("کد تخفیف یافت نشد", "DISCOUNT_CODE_NOT_FOUND");
const DUPLICATE = () => AppError.conflict("این کد تخفیف قبلاً ثبت شده است", "DISCOUNT_CODE_DUPLICATE");
const OWNER_INVALID = () => AppError.badRequest("مشتری فعال با این شناسه پیدا نشد", "DISCOUNT_CODE_OWNER_INVALID");
const LIMIT_BELOW_USED = () =>
  AppError.conflict("سقف استفاده نمی‌تواند کمتر از تعداد دفعات استفاده‌شده‌ی این کد باشد", "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED");

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

const CODE_PROJECTION = {
  code: 1,
  type: 1,
  ownerUserId: 1,
  percentage: 1,
  maxDiscountAmount: 1,
  minOrderAmount: 1,
  usageLimit: 1,
  usedCount: 1,
  isActive: 1,
  expiresAt: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;
/** The ONLY user fields ever read for a code's owner. */
const OWNER_PROJECTION = { firstName: 1, lastName: 1, phone: 1 } as const;

const toOwnerDto = (u: LeanOwner): DiscountCodeOwnerDto => ({
  id: u._id.toString(),
  firstName: u.firstName ? u.firstName : null,
  lastName: u.lastName ? u.lastName : null,
  phone: u.phone ?? null,
});

function toDto(c: LeanCode, owners: Map<string, LeanOwner>, now: Date): DiscountCodeDto {
  let owner: DiscountCodeOwnerDto | null = null;
  if (c.type === "personal" && c.ownerUserId) {
    const key = c.ownerUserId.toString();
    const found = owners.get(key);
    owner = found ? toOwnerDto(found) : { id: key, firstName: null, lastName: null, phone: null };
  }
  const usageLimit = typeof c.usageLimit === "number" ? c.usageLimit : null;
  return {
    id: c._id.toString(),
    code: c.code,
    type: c.type,
    owner,
    percentage: c.percentage,
    maxDiscountAmount: typeof c.maxDiscountAmount === "number" ? c.maxDiscountAmount : null,
    minOrderAmount: c.minOrderAmount ?? 0,
    usageLimit,
    usedCount: c.usedCount,
    isActive: c.isActive,
    status: computeDiscountCodeStatus({ isActive: c.isActive, usedCount: c.usedCount, usageLimit, expiresAt: c.expiresAt ?? null }, now),
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

async function loadOwners(codes: LeanCode[]): Promise<Map<string, LeanOwner>> {
  const ids = [...new Set(codes.filter((c) => c.type === "personal" && c.ownerUserId).map((c) => c.ownerUserId!.toString()))];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, OWNER_PROJECTION).lean<LeanOwner[]>();
  return new Map(users.map((u) => [u._id.toString(), u]));
}

/** The fields an admin can edit — the audit trail for an update records exactly these (no owner/customer data). */
const editableSnapshot = (c: Pick<LeanCode, "percentage" | "maxDiscountAmount" | "minOrderAmount" | "usageLimit" | "expiresAt">) => ({
  percentage: c.percentage,
  maxDiscountAmount: typeof c.maxDiscountAmount === "number" ? c.maxDiscountAmount : null,
  minOrderAmount: c.minOrderAmount ?? 0,
  usageLimit: typeof c.usageLimit === "number" ? c.usageLimit : null,
  expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
});

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  return new Types.ObjectId(id);
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A code that has no limit, or has uses left. Missing and null `usageLimit` both match `{ usageLimit: null }`. */
const hasUsesLeft = () => ({ $or: [{ usageLimit: null }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }] });

/**
 * MongoDB conditions equivalent to `computeDiscountCodeStatus` (priority exhausted >
 * disabled > expired > active). `$type: "number"` guards the `$expr` comparison, because a
 * missing field would otherwise compare below every number.
 */
export function statusConditions(status: DiscountCodeStatusFilter, now: Date): Record<string, unknown>[] {
  switch (status) {
    case "all":
      return [];
    case "exhausted":
      return [{ usageLimit: { $type: "number" }, $expr: { $gte: ["$usedCount", "$usageLimit"] } }];
    case "disabled":
      return [hasUsesLeft(), { isActive: false }];
    case "expired":
      return [hasUsesLeft(), { isActive: true }, { expiresAt: { $lt: now } }];
    case "active":
      return [hasUsesLeft(), { isActive: true }, { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] }];
  }
}

export async function listDiscountCodes(query: DiscountCodeListQuery): Promise<DiscountCodeListResult> {
  const now = new Date();
  const conditions: Record<string, unknown>[] = [];
  if (query.type !== "all") conditions.push({ type: query.type });
  if (query.search) conditions.push({ code: new RegExp(escapeRegex(query.search)) }); // the code only — never owner/customer data
  conditions.push(...statusConditions(query.status, now));
  const filter = conditions.length > 0 ? { $and: conditions } : {};

  const [docs, total] = await Promise.all([
    DiscountCode.find(filter, CODE_PROJECTION)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<LeanCode[]>(),
    DiscountCode.countDocuments(filter),
  ]);
  const owners = await loadOwners(docs);
  return { items: docs.map((d) => toDto(d, owners, now)), pagination: { page: query.page, pageSize: query.limit, total } };
}

export async function getDiscountCode(id: string): Promise<DiscountCodeDto> {
  const _id = toObjectId(id);
  const doc = await DiscountCode.findOne({ _id }, CODE_PROJECTION).lean<LeanCode | null>();
  if (!doc) throw NOT_FOUND();
  return toDto(doc, await loadOwners([doc]), new Date());
}

export async function createDiscountCode(actorUserId: string, input: CreateDiscountCodeInput): Promise<DiscountCodeDto> {
  let ownerUserId: Types.ObjectId | undefined;
  if (input.type === "personal") {
    if (!input.ownerUserId || !Types.ObjectId.isValid(input.ownerUserId)) throw OWNER_INVALID();
    const _id = new Types.ObjectId(input.ownerUserId);
    // role + isActive in the filter: a courier/admin id, an inactive customer and a missing id look the same.
    const owner = await User.findOne({ _id, role: "customer", isActive: true }, { _id: 1 }).lean<{ _id: Types.ObjectId } | null>();
    if (!owner) throw OWNER_INVALID();
    ownerUserId = _id;
  }

  let created;
  try {
    created = await DiscountCode.create({
      code: input.code,
      type: input.type,
      ...(ownerUserId ? { ownerUserId } : {}),
      percentage: input.percentage,
      ...(input.maxDiscountAmount !== undefined ? { maxDiscountAmount: input.maxDiscountAmount } : {}),
      ...(input.minOrderAmount !== undefined ? { minOrderAmount: input.minOrderAmount } : {}),
      ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: endOfTehranDay(input.expiresAt) } : {}),
      // usedCount and isActive are never taken from the client: the model defaults apply (0, active).
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw DUPLICATE();
    throw err;
  }
  const record = created.toObject() as unknown as LeanCode;
  await AuditLog.create({
    actorUserId,
    action: "discount_code.created",
    entityType: "DiscountCode",
    entityId: record._id,
    before: null,
    after: {
      code: record.code,
      type: record.type,
      ownerUserId: record.ownerUserId ? record.ownerUserId.toString() : null,
      isActive: record.isActive,
      ...editableSnapshot(record),
    },
  });
  return toDto(record, await loadOwners([record]), new Date());
}

export async function updateDiscountCode(actorUserId: string, id: string, input: UpdateDiscountCodeInput): Promise<DiscountCodeDto> {
  const _id = toObjectId(id);
  const current = await DiscountCode.findOne({ _id }, CODE_PROJECTION).lean<LeanCode | null>();
  if (!current) throw NOT_FOUND();

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  const filter: Record<string, unknown> = { _id };

  if (input.percentage !== undefined && input.percentage !== current.percentage) $set.percentage = input.percentage;
  if (input.minOrderAmount !== undefined && input.minOrderAmount !== (current.minOrderAmount ?? 0)) $set.minOrderAmount = input.minOrderAmount;

  if (input.maxDiscountAmount === null) {
    if (typeof current.maxDiscountAmount === "number") $unset.maxDiscountAmount = 1;
  } else if (input.maxDiscountAmount !== undefined && input.maxDiscountAmount !== current.maxDiscountAmount) {
    $set.maxDiscountAmount = input.maxDiscountAmount;
  }

  if (input.usageLimit === null) {
    if (typeof current.usageLimit === "number") $unset.usageLimit = 1;
  } else if (input.usageLimit !== undefined && input.usageLimit !== current.usageLimit) {
    if (input.usageLimit < current.usedCount) throw LIMIT_BELOW_USED(); // fast path; the guard below is the authority
    $set.usageLimit = input.usageLimit;
    filter.usedCount = { $lte: input.usageLimit }; // atomic with the write itself
  }

  if (input.expiresAt === null) {
    if (current.expiresAt) $unset.expiresAt = 1;
  } else if (input.expiresAt !== undefined) {
    const next = endOfTehranDay(input.expiresAt);
    if (!current.expiresAt || current.expiresAt.getTime() !== next.getTime()) $set.expiresAt = next;
  }

  if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) return getDiscountCode(id); // no-op: no write, no audit

  // `new: false` returns the document exactly as this update found it, so the audit "before" can never be a stale read.
  const before = await DiscountCode.findOneAndUpdate(
    filter,
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: false, runValidators: true, projection: CODE_PROJECTION },
  ).lean<LeanCode | null>();

  if (!before) {
    // The filter is `_id` plus (only when lowering the limit) `usedCount <= newLimit`.
    const exists = await DiscountCode.findOne({ _id }, { _id: 1 }).lean<{ _id: Types.ObjectId } | null>();
    if (!exists) throw NOT_FOUND();
    throw LIMIT_BELOW_USED();
  }

  const after = { ...before, ...$set } as LeanCode;
  for (const key of Object.keys($unset)) delete (after as Record<string, unknown>)[key];
  await AuditLog.create({
    actorUserId,
    action: "discount_code.updated",
    entityType: "DiscountCode",
    entityId: _id,
    before: editableSnapshot(before),
    after: editableSnapshot(after),
  });
  return getDiscountCode(id);
}

/**
 * Explicit activate/deactivate (set, not toggle). The state the code already has is a successful
 * no-op without a write or audit entry; the write is conditional on the state we saw, so of two
 * racing opposite requests only the one that actually flips it writes and audits.
 */
export async function setDiscountCodeActive(actorUserId: string, id: string, isActive: boolean): Promise<DiscountCodeDto> {
  const _id = toObjectId(id);
  const current = await DiscountCode.findOne({ _id }, { isActive: 1 }).lean<Pick<LeanCode, "_id" | "isActive"> | null>();
  if (!current) throw NOT_FOUND();
  if (current.isActive === isActive) return getDiscountCode(id);

  const before = await DiscountCode.findOneAndUpdate({ _id, isActive: !isActive }, { $set: { isActive } }, { new: false, projection: { isActive: 1 } }).lean<
    Pick<LeanCode, "_id" | "isActive"> | null
  >();
  if (before) {
    await AuditLog.create({
      actorUserId,
      action: isActive ? "discount_code.activated" : "discount_code.deactivated",
      entityType: "DiscountCode",
      entityId: _id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
  }
  return getDiscountCode(id);
}
