import { Types } from "mongoose";
import type {
  CustomerAddressDto,
  CustomerDetailDto,
  CustomerListItemDto,
  CustomerListQuery,
  CustomerListResult,
  UpdateCustomerProfileInput,
} from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { User, type IAddress } from "../models/User";

/**
 * Admin Customers (MASTER-PROMPT §39 Phase 4, page 5). A customer is a `User`
 * with `role: "customer"` — there is no Customer model.
 *
 * Boundaries:
 *  - EVERY query/write carries `role: "customer"` in its filter, so courier /
 *    admin / master_admin users can never be listed, read or changed here; a
 *    non-customer id is indistinguishable from a missing one (404
 *    CUSTOMER_NOT_FOUND) and nothing about it is revealed.
 *  - Responses are built field-by-field from an explicit projection (never
 *    `toJSON()`); password/OTP/token/courier/referral/customerCode fields are
 *    neither selected nor serialized. Addresses are a read-only subset without
 *    coordinates, provenance or courier notes.
 *  - Only firstName, lastName, birthDate and (via setCustomerActive) isActive can
 *    change. Nothing touches Order, DeliveryRun, Review, addresses, roles or
 *    tokens; no hard delete exists. Deactivation does NOT revoke access tokens.
 *  - Single-document atomic writes (no transaction); the AuditLog entry follows
 *    the write, as in the other admin services. A request that changes nothing
 *    writes nothing and audits nothing.
 */

type LeanAddress = Pick<IAddress, "label" | "recipientName" | "phone" | "province" | "city" | "addressLine" | "postalCode" | "isDefault"> & { _id: Types.ObjectId };
type LeanCustomer = {
  _id: Types.ObjectId;
  phone: string;
  firstName?: string;
  lastName?: string;
  birthDate?: Date;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  addresses?: LeanAddress[];
};

const NOT_FOUND = () => AppError.notFound("مشتری یافت نشد", "CUSTOMER_NOT_FOUND");

const LIST_PROJECTION = { phone: 1, firstName: 1, lastName: 1, isActive: 1, createdAt: 1 } as const;
const DETAIL_PROJECTION = {
  ...LIST_PROJECTION,
  birthDate: 1,
  lastLoginAt: 1,
  updatedAt: 1,
  "addresses._id": 1,
  "addresses.label": 1,
  "addresses.recipientName": 1,
  "addresses.phone": 1,
  "addresses.province": 1,
  "addresses.city": 1,
  "addresses.addressLine": 1,
  "addresses.postalCode": 1,
  "addresses.isDefault": 1,
} as const;
const PROFILE_PROJECTION = { firstName: 1, lastName: 1, birthDate: 1 } as const;

const toListItem = (u: LeanCustomer): CustomerListItemDto => ({
  id: u._id.toString(),
  firstName: u.firstName ? u.firstName : null,
  lastName: u.lastName ? u.lastName : null,
  phone: u.phone,
  isActive: u.isActive,
  createdAt: u.createdAt.toISOString(),
});

const toAddress = (a: LeanAddress): CustomerAddressDto => ({
  id: a._id.toString(),
  label: a.label,
  recipientName: a.recipientName,
  phone: a.phone,
  province: a.province,
  city: a.city,
  addressLine: a.addressLine,
  postalCode: a.postalCode ? a.postalCode : null,
  isDefault: a.isDefault,
});

const dateOnly = (d: Date | undefined | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

const toDetail = (u: LeanCustomer): CustomerDetailDto => ({
  ...toListItem(u),
  birthDate: dateOnly(u.birthDate),
  lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  updatedAt: u.updatedAt.toISOString(),
  addresses: (u.addresses ?? []).map(toAddress),
});

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  return new Types.ObjectId(id);
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MAX_SEARCH_TOKENS = 3;

/**
 * Whitespace-separated tokens (at most 3), each escaped (so user input is always
 * a literal) and each required to match phone OR firstName OR lastName — this
 * lets "علی رضایی" match first+last name. Input length is already capped by the
 * shared schema. The `role` restriction is applied by the caller, outside this.
 */
function searchConditions(search: string | undefined): Record<string, unknown>[] {
  if (!search) return [];
  return search
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS)
    .map((token) => {
      const rx = new RegExp(escapeRegex(token), "i");
      return { $or: [{ phone: rx }, { firstName: rx }, { lastName: rx }] };
    });
}

export async function listCustomers(query: CustomerListQuery): Promise<CustomerListResult> {
  const filter: Record<string, unknown> = { role: "customer" };
  if (query.status !== "all") filter.isActive = query.status === "active";
  const conditions = searchConditions(query.search);
  if (conditions.length > 0) filter.$and = conditions;

  const [docs, total] = await Promise.all([
    User.find(filter, LIST_PROJECTION)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<LeanCustomer[]>(),
    User.countDocuments(filter),
  ]);
  return { items: docs.map(toListItem), pagination: { page: query.page, pageSize: query.limit, total } };
}

export async function getCustomer(id: string): Promise<CustomerDetailDto> {
  const _id = toObjectId(id);
  const doc = await User.findOne({ _id, role: "customer" }, DETAIL_PROJECTION).lean<LeanCustomer | null>();
  if (!doc) throw NOT_FOUND();
  return toDetail(doc);
}

export async function updateCustomerProfile(actorUserId: string, id: string, input: UpdateCustomerProfileInput): Promise<CustomerDetailDto> {
  const _id = toObjectId(id);
  const current = await User.findOne({ _id, role: "customer" }, PROFILE_PROJECTION).lean<LeanCustomer | null>();
  if (!current) throw NOT_FOUND();

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const key of ["firstName", "lastName"] as const) {
    const value = input[key];
    if (value === undefined || value === (current[key] ?? "")) continue;
    if (value === "") $unset[key] = 1;
    else $set[key] = value;
  }
  const newBirth = input.birthDate;
  const birthChanged = newBirth !== undefined && newBirth !== dateOnly(current.birthDate);
  if (birthChanged) $set.birthDate = new Date(`${newBirth}T00:00:00.000Z`);

  if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) return getCustomer(id); // no-op: no write, no audit

  const before = await User.findOneAndUpdate(
    { _id, role: "customer" },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: false, runValidators: true, projection: PROFILE_PROJECTION },
  ).lean<LeanCustomer | null>();
  if (!before) throw NOT_FOUND();

  const nameTouched = "firstName" in $set || "lastName" in $set || "firstName" in $unset || "lastName" in $unset;
  if (nameTouched) {
    const afterFirst = input.firstName !== undefined ? input.firstName : before.firstName ?? "";
    const afterLast = input.lastName !== undefined ? input.lastName : before.lastName ?? "";
    await AuditLog.create({
      actorUserId,
      action: "customer.name_updated",
      entityType: "User",
      entityId: _id,
      before: { firstName: before.firstName ?? "", lastName: before.lastName ?? "" },
      after: { firstName: afterFirst, lastName: afterLast },
    });
  }
  if (birthChanged) {
    await AuditLog.create({
      actorUserId,
      action: "customer.birth_date_updated",
      entityType: "User",
      entityId: _id,
      before: { birthDate: dateOnly(before.birthDate) },
      after: { birthDate: newBirth },
    });
  }
  return getCustomer(id);
}

/** Explicit set (not toggle); the state it already has is a successful no-op without write or audit. */
export async function setCustomerActive(actorUserId: string, id: string, isActive: boolean): Promise<CustomerDetailDto> {
  const _id = toObjectId(id);
  const current = await User.findOne({ _id, role: "customer" }, { isActive: 1 }).lean<LeanCustomer | null>();
  if (!current) throw NOT_FOUND();
  if (current.isActive === isActive) return getCustomer(id);

  // Conditional on the current state: of two racing opposite requests only one matches.
  const before = await User.findOneAndUpdate(
    { _id, role: "customer", isActive: !isActive },
    { $set: { isActive } },
    { new: false, projection: { isActive: 1 } },
  ).lean<LeanCustomer | null>();
  if (before) {
    await AuditLog.create({
      actorUserId,
      action: isActive ? "customer.activated" : "customer.deactivated",
      entityType: "User",
      entityId: _id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
  }
  return getCustomer(id);
}
