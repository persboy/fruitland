import { Types, startSession } from "mongoose";
import {
  RESERVING_DELIVERY_RUN_STATUS,
  isValidCourierName,
  type CourierDto,
  type CourierListQuery,
  type CourierListResult,
  type CreateCourierRequest,
  type UpdateCourierRequest,
  type VehicleType,
} from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { DeliveryRun } from "../models/DeliveryRun";
import { User } from "../models/User";
import { isTransactionsUnsupportedError } from "./deliveryRunService";

/**
 * Admin Couriers (MASTER-PROMPT §39 Phase 4, page 8). A courier is a `User` with
 * `role: "courier"` + the embedded `courierProfile` — there is no Courier model.
 *
 * Boundaries:
 *  - Couriers are made ONLY by promoting an existing customer (`createCourier`).
 *    There is no downgrade, no hard delete and no account creation. Admin /
 *    master_admin / courier users can never be promoted.
 *  - EVERY read/write of an existing courier carries `role: "courier"` in its
 *    filter; a non-courier id is indistinguishable from a missing one (404).
 *  - Responses are built field-by-field from an explicit projection (never
 *    `toJSON`). Addresses, credentials, codes and `courierProfile.currentLocation`
 *    are neither selected nor serialized. `availabilityStatus`
 *    (`courierProfile.status`) is read-only here and is NEVER synced with `isActive`.
 *  - Promotion / profile update / activation are single-document conditional
 *    writes (AuditLog follows the write, as in the other admin services).
 *    DEACTIVATION is a real transaction (see `setCourierActive`) and therefore
 *    needs a replica set, exactly like `activateRun`.
 *  - Role/`isActive` changes do NOT revoke access tokens: the role claim lives
 *    in the 15-minute access token and is re-read from the database on refresh.
 */

type LeanCourier = {
  _id: Types.ObjectId;
  phone: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  createdAt: Date;
  courierProfile?: { vehicleType?: VehicleType; plateNumber?: string; status?: "offline" | "online" | "busy" };
};

type LeanCandidate = { _id: Types.ObjectId; role: string; isActive: boolean; firstName?: string; lastName?: string };

const NOT_FOUND = () => AppError.notFound("پیک یافت نشد", "COURIER_NOT_FOUND");

/** Explicit projection: courierProfile.currentLocation is deliberately absent. */
const COURIER_PROJECTION = {
  phone: 1,
  firstName: 1,
  lastName: 1,
  isActive: 1,
  createdAt: 1,
  "courierProfile.vehicleType": 1,
  "courierProfile.plateNumber": 1,
  "courierProfile.status": 1,
} as const;

const toCourierDto = (u: LeanCourier): CourierDto => ({
  id: u._id.toString(),
  firstName: u.firstName ? u.firstName : null,
  lastName: u.lastName ? u.lastName : null,
  phone: u.phone,
  isActive: u.isActive,
  vehicleType: u.courierProfile?.vehicleType ?? null,
  plateNumber: u.courierProfile?.plateNumber ? u.courierProfile.plateNumber : null,
  availabilityStatus: u.courierProfile?.status ?? "offline",
  createdAt: u.createdAt.toISOString(),
});

function toObjectId(id: string, onInvalid: () => AppError): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw onInvalid();
  return new Types.ObjectId(id);
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_SEARCH_TOKENS = 3;

/** Same search semantics as Customers: ≤ 3 escaped tokens, each must match phone OR firstName OR lastName. */
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

export async function listCouriers(query: CourierListQuery): Promise<CourierListResult> {
  const filter: Record<string, unknown> = { role: "courier" };
  if (query.status !== "all") filter.isActive = query.status === "active";
  const conditions = searchConditions(query.search);
  if (conditions.length > 0) filter.$and = conditions;

  const [docs, total] = await Promise.all([
    User.find(filter, COURIER_PROJECTION)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<LeanCourier[]>(),
    User.countDocuments(filter),
  ]);
  return { items: docs.map(toCourierDto), pagination: { page: query.page, pageSize: query.limit, total } };
}

export async function getCourier(id: string): Promise<CourierDto> {
  const _id = toObjectId(id, NOT_FOUND);
  const doc = await User.findOne({ _id, role: "courier" }, COURIER_PROJECTION).lean<LeanCourier | null>();
  if (!doc) throw NOT_FOUND();
  return toCourierDto(doc);
}

// ------------------------------------------------------------------ promotion

/** Maps a user's CURRENT state to the specific, safe error explaining why it cannot be promoted (null = eligible). */
function promotionError(u: LeanCandidate | null): AppError | null {
  if (!u) return AppError.notFound("کاربری با این شناسه یافت نشد", "COURIER_CANDIDATE_NOT_FOUND");
  if (u.role === "courier") return AppError.conflict("این کاربر از قبل پیک است", "USER_ALREADY_COURIER");
  if (u.role !== "customer") return AppError.badRequest("فقط مشتری می‌تواند به پیک تبدیل شود", "COURIER_CANDIDATE_NOT_CUSTOMER");
  if (!u.isActive) return AppError.badRequest("حساب این مشتری غیرفعال است؛ ابتدا آن را فعال کنید", "COURIER_CANDIDATE_INACTIVE");
  if (!isValidCourierName(u.firstName) || !isValidCourierName(u.lastName)) {
    return AppError.badRequest("نام و نام‌خانوادگی این مشتری کامل نیست؛ ابتدا پروفایل او را کامل کنید", "COURIER_CANDIDATE_PROFILE_INCOMPLETE");
  }
  return null;
}

/**
 * Promotes an existing, active customer with a valid first/last name. The write
 * is a single conditional `findOneAndUpdate` (role customer + active + non-empty
 * names in the FILTER), so it can never overwrite a concurrent role change and,
 * of two racing promotions of the same user, only one matches — the other is
 * re-classified from the fresh state (normally 409 USER_ALREADY_COURIER).
 * `courierProfile.status` starts "offline"; nothing else on the user is touched.
 * Audit (`courier.created`) is written only for a successful promotion.
 */
export async function createCourier(actorUserId: string, input: CreateCourierRequest): Promise<CourierDto> {
  const _id = toObjectId(input.userId, () => AppError.notFound("کاربری با این شناسه یافت نشد", "COURIER_CANDIDATE_NOT_FOUND"));
  const candidate = await User.findOne({ _id }, { role: 1, isActive: 1, firstName: 1, lastName: 1 }).lean<LeanCandidate | null>();
  const early = promotionError(candidate);
  if (early) throw early;

  const profile = { vehicleType: input.vehicleType, status: "offline" as const, ...(input.plateNumber ? { plateNumber: input.plateNumber } : {}) };
  const before = await User.findOneAndUpdate(
    {
      _id,
      role: "customer",
      isActive: true,
      firstName: { $type: "string", $ne: "" },
      lastName: { $type: "string", $ne: "" },
    },
    { $set: { role: "courier", courierProfile: profile } },
    { new: false, runValidators: true, projection: { role: 1 } },
  ).lean<{ role: string } | null>();

  if (!before) {
    // Lost a race (or the state changed since the read): report the CURRENT reason.
    const fresh = await User.findOne({ _id }, { role: 1, isActive: 1, firstName: 1, lastName: 1 }).lean<LeanCandidate | null>();
    throw promotionError(fresh) ?? AppError.conflict("وضعیت کاربر هم‌زمان تغییر کرد؛ دوباره تلاش کنید", "COURIER_PROMOTION_CONFLICT");
  }

  await AuditLog.create({
    actorUserId,
    action: "courier.created",
    entityType: "User",
    entityId: _id,
    before: { role: before.role },
    after: { role: "courier", vehicleType: input.vehicleType, plateNumber: input.plateNumber ?? null },
  });
  return getCourier(_id.toString());
}

// --------------------------------------------------------------------- update

/** Updates vehicleType / plateNumber (`""` clears the plate). A request that changes nothing writes and audits nothing. */
export async function updateCourier(actorUserId: string, id: string, input: UpdateCourierRequest): Promise<CourierDto> {
  const _id = toObjectId(id, NOT_FOUND);
  const current = await User.findOne({ _id, role: "courier" }, COURIER_PROJECTION).lean<LeanCourier | null>();
  if (!current) throw NOT_FOUND();

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  if (input.vehicleType !== undefined && input.vehicleType !== current.courierProfile?.vehicleType) {
    $set["courierProfile.vehicleType"] = input.vehicleType;
  }
  if (input.plateNumber !== undefined && input.plateNumber !== (current.courierProfile?.plateNumber ?? "")) {
    if (input.plateNumber === "") $unset["courierProfile.plateNumber"] = 1;
    else $set["courierProfile.plateNumber"] = input.plateNumber;
  }
  if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) return toCourierDto(current); // no-op: no write, no audit

  const before = await User.findOneAndUpdate(
    { _id, role: "courier" },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: false, runValidators: true, projection: COURIER_PROJECTION },
  ).lean<LeanCourier | null>();
  if (!before) throw NOT_FOUND();

  await AuditLog.create({
    actorUserId,
    action: "courier.updated",
    entityType: "User",
    entityId: _id,
    before: { vehicleType: before.courierProfile?.vehicleType ?? null, plateNumber: before.courierProfile?.plateNumber ?? null },
    after: {
      vehicleType: input.vehicleType ?? before.courierProfile?.vehicleType ?? null,
      plateNumber: input.plateNumber !== undefined ? input.plateNumber || null : before.courierProfile?.plateNumber ?? null,
    },
  });
  return getCourier(_id.toString());
}

// --------------------------------------------------------------- activate / deactivate

/** Internal control-flow marker thrown INSIDE the deactivation transaction so the write rolls back. */
class CourierHasActiveRunError extends Error {}

const ACTIVE_RUN_CONFLICT = () =>
  AppError.conflict("این پیک یک ماموریت فعال دارد؛ ابتدا آن را تکمیل یا لغو کنید", "COURIER_HAS_ACTIVE_RUN");

/**
 * Explicit set (not a toggle); the state it already has is a successful no-op
 * without write or audit.
 *
 * ACTIVATE: one conditional write (`isActive:false → true`) + audit.
 *
 * DEACTIVATE (Owner decision 4): rejected with 409 COURIER_HAS_ACTIVE_RUN while
 * the courier has a run in the canonical reserving state
 * (`RESERVING_DELIVERY_RUN_STATUS` = "active"; drafts reserve nothing). The check
 * and the write are ONE transaction: (1) conditionally write `isActive:false`,
 * (2) read the courier's active run in the same session, (3) abort (rollback) if
 * one exists, else (4) write the audit in the same session. `activateRun` touches
 * the SAME user document inside its own transaction, so a deactivation racing a
 * run activation produces a write conflict that MongoDB retries against fresh
 * state: either the run is already active (→ 409) or the courier is already
 * inactive (→ `activateRun` rejects with COURIER_NOT_ACTIVE). Requires a replica
 * set / mongos; on a standalone mongod it throws a plain Error (→ logged 500),
 * never falling back to an unsafe non-transactional path.
 */
export async function setCourierActive(actorUserId: string, id: string, isActive: boolean): Promise<CourierDto> {
  const _id = toObjectId(id, NOT_FOUND);
  const current = await User.findOne({ _id, role: "courier" }, { isActive: 1 }).lean<{ isActive: boolean } | null>();
  if (!current) throw NOT_FOUND();
  if (current.isActive === isActive) return getCourier(id);

  if (isActive) {
    // Conditional on the observed state: of two racing opposite requests only one matches.
    const before = await User.findOneAndUpdate({ _id, role: "courier", isActive: false }, { $set: { isActive: true } }, { new: false, projection: { isActive: 1 } }).lean<{ isActive: boolean } | null>();
    if (before) {
      await AuditLog.create({ actorUserId, action: "courier.activated", entityType: "User", entityId: _id, before: { isActive: before.isActive }, after: { isActive: true } });
    }
    return getCourier(id);
  }

  const session = await startSession();
  try {
    await session.withTransaction(async () => {
      const before = await User.findOneAndUpdate(
        { _id, role: "courier", isActive: true },
        { $set: { isActive: false } },
        { new: false, projection: { isActive: 1 }, session },
      ).lean<{ isActive: boolean } | null>();
      if (!before) return; // already inactive (a racing request won): nothing written, nothing audited
      const activeRun = await DeliveryRun.exists({ courierId: _id, status: RESERVING_DELIVERY_RUN_STATUS }).session(session);
      if (activeRun) throw new CourierHasActiveRunError(); // aborts → the isActive write above is rolled back
      await AuditLog.create(
        [{ actorUserId, action: "courier.deactivated", entityType: "User", entityId: _id, before: { isActive: true }, after: { isActive: false } }],
        { session },
      );
    });
  } catch (error) {
    if (error instanceof CourierHasActiveRunError) throw ACTIVE_RUN_CONFLICT();
    if (isTransactionsUnsupportedError(error)) {
      throw new Error(
        "غیرفعال‌سازی پیک به یک تراکنش MongoDB نیاز دارد که این استقرار (mongod مستقل، نه replica set/mongos) از آن پشتیبانی نمی‌کند. " +
          "عمداً بدون تراکنش انجام نشد تا هم‌زمانی با فعال‌سازی ماموریت رعایت شود.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return getCourier(id);
}
