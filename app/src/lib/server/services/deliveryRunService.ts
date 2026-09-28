import { Types } from "mongoose";
import {
  OPEN_DELIVERY_RUN_STATUSES,
  buildInitialStops,
  canActorTransitionOrderDelivery,
  canTransitionDeliveryRun,
  canTransitionDeliveryStop,
  computeReorderedSequences,
  stopOutcomeToProposedOutcome,
  type DeliveryRunStatus,
  type DeliveryStopStatus,
  type RuleResult,
} from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { requireRole, type AuthContext } from "../auth/guard";
import { DeliveryRun, type IDeliveryRun } from "../models/DeliveryRun";
import { Order } from "../models/Order";
import { User } from "../models/User";

/**
 * DeliveryRun = one courier's batch of orders (Phase 14). This service owns
 * the run and its stops and only ever moves an order along the EXISTING
 * `Order.delivery` lifecycle (assign → picked_up → proposed), never a
 * parallel one:
 *
 *  - It never touches `Order.status` (the documented "shipped only after
 *    assignment" rule is not implemented anywhere yet — reported, not
 *    invented; starting a run does NOT change it).
 *  - A courier can only PROPOSE an outcome; "resolved" is admin-only and is
 *    deliberately not reachable from this file.
 *  - Destinations are never copied: a stop is an orderId; the address is the
 *    order's own `deliveryAddress` snapshot.
 *
 * No multi-document transactions (the project targets a plain MongoDB and
 * these paths are not run against a replica set). Correctness instead comes
 * from single-document atomic updates with the expected state in the filter,
 * the partial unique index on `stops.orderId`, and explicit compensation
 * where two collections are involved. Known gap: cancelRun and
 * confirmPickup can race (see cancelRun).
 */

const ADMIN_ROLES = ["admin", "master_admin"] as const;

export interface DeliveryStopDto {
  id: string;
  orderId: string;
  sequence: number;
  status: DeliveryStopStatus;
  completedAt: string | null;
}

export interface DeliveryRunDto {
  id: string;
  courierId: string;
  status: DeliveryRunStatus;
  /** Always sorted by `sequence` — array order in the database carries no meaning. */
  stops: DeliveryStopDto[];
  activatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

type RunRecord = IDeliveryRun & { _id: Types.ObjectId };

export function toDeliveryRunDto(run: RunRecord): DeliveryRunDto {
  return {
    id: run._id.toString(),
    courierId: run.courierId.toString(),
    status: run.status,
    stops: [...run.stops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        id: s._id.toString(),
        orderId: s.orderId.toString(),
        sequence: s.sequence,
        status: s.status,
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
    activatedAt: run.activatedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    cancelledAt: run.cancelledAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------- helpers

const RUN_NOT_FOUND = () => AppError.notFound("ماموریت یافت نشد", "DELIVERY_RUN_NOT_FOUND");

function unwrap<T>(result: RuleResult<T>): T {
  if (!result.ok) throw AppError.badRequest(result.message, result.code);
  return result.value;
}

function toObjectId(id: string, onInvalid: () => AppError): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw onInvalid();
  return new Types.ObjectId(id);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

function assertOrderTransition(from: "unassigned" | "assigned" | "picked_up" | "proposed", to: "unassigned" | "assigned" | "picked_up" | "proposed", actor: AuthContext): void {
  if (!canActorTransitionOrderDelivery(from, to, actor.role)) {
    throw AppError.forbidden("این عملیات برای نقش شما مجاز نیست", "FORBIDDEN_DELIVERY_TRANSITION");
  }
}

/**
 * Courier-owned load. Ownership is part of the query itself, so a run that
 * belongs to another courier is indistinguishable from a missing one (no
 * confirmation of its existence to a guesser).
 */
async function loadOwnRun(actor: AuthContext, runId: string): Promise<RunRecord> {
  const id = toObjectId(runId, RUN_NOT_FOUND);
  const run = await DeliveryRun.findOne({ _id: id, courierId: toObjectId(actor.userId, RUN_NOT_FOUND) }).lean<RunRecord>();
  if (!run) throw RUN_NOT_FOUND();
  return run;
}

function requireActiveRun(run: RunRecord): void {
  if (run.status !== "active") {
    throw AppError.conflict("این ماموریت فعال نیست", "DELIVERY_RUN_NOT_ACTIVE");
  }
}

/** Returns the released order ids' effect only; safe to call for orders that already moved on (they simply don't match). */
async function releaseOrders(orderIds: Types.ObjectId[], courierId: Types.ObjectId): Promise<void> {
  if (orderIds.length === 0) return;
  await Order.updateMany(
    { _id: { $in: orderIds }, "delivery.status": "assigned", "delivery.courierId": courierId },
    { $set: { "delivery.status": "unassigned" }, $unset: { "delivery.courierId": 1, "delivery.assignedAt": 1 } },
  );
}

async function completeRunIfFinished(runId: Types.ObjectId): Promise<void> {
  if (!canTransitionDeliveryRun("active", "completed")) return;
  await DeliveryRun.updateOne(
    { _id: runId, status: "active", stops: { $not: { $elemMatch: { status: "pending" } } } },
    { $set: { status: "completed", completedAt: new Date() } },
  );
}

async function freshDto(runId: Types.ObjectId): Promise<DeliveryRunDto> {
  const run = await DeliveryRun.findById(runId).lean<RunRecord>();
  if (!run) throw RUN_NOT_FOUND();
  return toDeliveryRunDto(run);
}

// ---------------------------------------------------------------- admin: create / activate / cancel

/**
 * Assigns the given orders to a courier as one draft run (stop sequence =
 * the given order). Each order is claimed atomically from
 * `Order.delivery.status: unassigned` (and `Order.status: preparing`) to
 * `assigned` — the existing lifecycle transition. The partial unique index
 * makes a second open run for the same order impossible even under
 * concurrent requests.
 */
export async function createDraftRun(actor: AuthContext, input: { courierId: string; orderIds: string[] }): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const stops = unwrap(buildInitialStops(input.orderIds));
  const invalid = () => AppError.badRequest("شناسه نامعتبر است", "INVALID_ID");
  const courierId = toObjectId(input.courierId, invalid);
  const orderIds = stops.map((s) => ({ ...s, orderObjectId: toObjectId(s.orderId, invalid) }));

  const courier = await User.findOne({ _id: courierId, role: "courier", isActive: true }, { courierProfile: 1 });
  if (!courier) throw AppError.badRequest("پیک معتبر و فعال یافت نشد", "COURIER_NOT_FOUND");
  if (!courier.courierProfile) {
    throw AppError.conflict("نوع وسیله‌ی نقلیه‌ی پیک ثبت نشده است", "COURIER_PROFILE_MISSING");
  }

  const existing = await Order.countDocuments({ _id: { $in: orderIds.map((o) => o.orderObjectId) } });
  if (existing !== orderIds.length) throw AppError.notFound("سفارش یافت نشد", "ORDER_NOT_FOUND");

  let runId: Types.ObjectId;
  try {
    const run = await DeliveryRun.create({
      courierId,
      status: "draft",
      createdByAdminUserId: toObjectId(actor.userId, invalid),
      stops: orderIds.map((o) => ({ orderId: o.orderObjectId, sequence: o.sequence, status: "pending" })),
    });
    runId = run._id;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict("یکی از سفارش‌ها پیش‌تر در یک ماموریت فعال یا پیش‌نویس است", "ORDER_ALREADY_IN_RUN");
    }
    throw error;
  }

  assertOrderTransition("unassigned", "assigned", actor);
  const claimed: Types.ObjectId[] = [];
  const now = new Date();
  for (const { orderObjectId } of orderIds) {
    const result = await Order.updateOne(
      { _id: orderObjectId, status: "preparing", "delivery.status": "unassigned" },
      { $set: { "delivery.status": "assigned", "delivery.courierId": courierId, "delivery.assignedAt": now } },
    );
    if (result.modifiedCount !== 1) {
      await releaseOrders(claimed, courierId);
      await DeliveryRun.deleteOne({ _id: runId, status: "draft" });
      throw AppError.conflict("یکی از سفارش‌ها قابل تخصیص به پیک نیست", "ORDER_NOT_ASSIGNABLE");
    }
    claimed.push(orderObjectId);
  }
  return freshDto(runId);
}

export async function activateRun(actor: AuthContext, runId: string): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const id = toObjectId(runId, RUN_NOT_FOUND);
  if (!canTransitionDeliveryRun("draft", "active")) throw AppError.conflict("انتقال نامعتبر", "INVALID_RUN_TRANSITION");
  const updated = await DeliveryRun.findOneAndUpdate(
    { _id: id, status: "draft" },
    { $set: { status: "active", activatedAt: new Date() } },
    { new: true },
  ).lean<RunRecord>();
  if (!updated) {
    if (!(await DeliveryRun.exists({ _id: id }))) throw RUN_NOT_FOUND();
    throw AppError.conflict("فقط ماموریت پیش‌نویس قابل فعال‌سازی است", "INVALID_RUN_TRANSITION");
  }
  return toDeliveryRunDto(updated);
}

/**
 * Allowed only while every order is still merely `assigned` (nothing picked
 * up): those assignments are released. A run whose orders were already
 * picked up cannot be cancelled here — what happens to goods already with
 * the courier is an undecided business rule, so it is refused, not guessed.
 * Known gap: a pickup landing between the check below and the status flip
 * can leave that order assigned to a cancelled run.
 */
export async function cancelRun(actor: AuthContext, runId: string): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const id = toObjectId(runId, RUN_NOT_FOUND);
  const run = await DeliveryRun.findById(id).lean<RunRecord>();
  if (!run) throw RUN_NOT_FOUND();
  if (!canTransitionDeliveryRun(run.status, "cancelled")) {
    throw AppError.conflict("این ماموریت قابل لغو نیست", "INVALID_RUN_TRANSITION");
  }
  const orderIds = run.stops.map((s) => s.orderId);
  const beyondAssigned = await Order.countDocuments({ _id: { $in: orderIds }, "delivery.status": { $ne: "assigned" } });
  if (beyondAssigned > 0) {
    throw AppError.conflict("بخشی از سفارش‌ها تحویل پیک شده‌اند؛ لغو ماموریت مجاز نیست", "RUN_HAS_PICKED_UP_ORDERS");
  }
  const result = await DeliveryRun.updateOne(
    { _id: id, status: { $in: [...OPEN_DELIVERY_RUN_STATUSES] } },
    { $set: { status: "cancelled", cancelledAt: new Date(), cancelledByUserId: toObjectId(actor.userId, RUN_NOT_FOUND) } },
  );
  if (result.modifiedCount !== 1) throw AppError.conflict("وضعیت ماموریت تغییر کرد", "DELIVERY_RUN_CHANGED");
  await releaseOrders(orderIds, run.courierId);
  return freshDto(id);
}

// ---------------------------------------------------------------- courier

/** The courier takes the goods for all still-pending stops: existing lifecycle step assigned → picked_up. Idempotent. */
export async function confirmPickup(actor: AuthContext, runId: string): Promise<{ pickedUpCount: number }> {
  requireRole(actor, ["courier"]);
  const run = await loadOwnRun(actor, runId);
  requireActiveRun(run);
  assertOrderTransition("assigned", "picked_up", actor);
  const pendingOrderIds = run.stops.filter((s) => s.status === "pending").map((s) => s.orderId);
  const result = await Order.updateMany(
    { _id: { $in: pendingOrderIds }, "delivery.status": "assigned", "delivery.courierId": run.courierId },
    { $set: { "delivery.status": "picked_up", "delivery.pickedUpAt": new Date() } },
  );
  return { pickedUpCount: result.modifiedCount };
}

/**
 * Reorders the still-pending stops of the courier's OWN ACTIVE run.
 * `orderedPendingStopIds` must list every pending stop exactly once.
 * Locked (delivered/failed/skipped) stops keep their sequence. The update
 * is a single atomic write guarded by "each listed stop is still pending",
 * so it cannot resurrect or move a stop resolved a moment earlier.
 */
export async function reorderStops(actor: AuthContext, runId: string, orderedPendingStopIds: string[]): Promise<DeliveryRunDto> {
  requireRole(actor, ["courier"]);
  const run = await loadOwnRun(actor, runId);
  requireActiveRun(run);

  const stopsLike = run.stops.map((s) => ({ id: s._id.toString(), orderId: s.orderId.toString(), sequence: s.sequence, status: s.status }));
  if (!stopsLike.some((s) => s.status === "pending")) {
    throw AppError.conflict("توقف در انتظاری برای جابه‌جایی وجود ندارد", "NO_PENDING_STOPS");
  }
  const assignments = unwrap(computeReorderedSequences(stopsLike, orderedPendingStopIds));

  const arrayFilters = assignments.map((a, i) => ({ [`s${i}._id`]: new Types.ObjectId(a.stopId) }));
  const $set = Object.fromEntries(assignments.map((a, i) => [`stops.$[s${i}].sequence`, a.sequence]));
  const result = await DeliveryRun.updateOne(
    {
      _id: run._id,
      courierId: run.courierId,
      status: "active",
      $and: assignments.map((a) => ({ stops: { $elemMatch: { _id: new Types.ObjectId(a.stopId), status: "pending" } } })),
    },
    { $set },
    { arrayFilters },
  );
  if (result.matchedCount !== 1) {
    throw AppError.conflict("وضعیت ماموریت تغییر کرد؛ دوباره تلاش کنید", "DELIVERY_RUN_CHANGED");
  }
  return freshDto(run._id);
}

/** Atomically moves one pending stop to a terminal status. Returns false if it was not pending (or the run is not the courier's active run). */
async function claimStop(run: RunRecord, stopId: Types.ObjectId, to: DeliveryStopStatus): Promise<boolean> {
  const result = await DeliveryRun.updateOne(
    { _id: run._id, courierId: run.courierId, status: "active", stops: { $elemMatch: { _id: stopId, status: "pending" } } },
    { $set: { "stops.$.status": to, "stops.$.completedAt": new Date() } },
  );
  return result.modifiedCount === 1;
}

/**
 * The courier reports a stop as delivered or failed. This is a PROPOSAL on
 * the order (`Order.delivery`: picked_up → proposed, with the existing
 * proposed outcomes delivered | returned), never a resolution — only an
 * admin can resolve, and that path is intentionally not in this service.
 * The order must have been picked up by this same courier.
 */
export async function proposeStopOutcome(
  actor: AuthContext,
  runId: string,
  stopId: string,
  outcome: "delivered" | "failed",
): Promise<DeliveryRunDto> {
  requireRole(actor, ["courier"]);
  const run = await loadOwnRun(actor, runId);
  requireActiveRun(run);
  const stop = run.stops.find((s) => s._id.toString() === stopId);
  if (!stop) throw AppError.notFound("توقف یافت نشد", "DELIVERY_STOP_NOT_FOUND");
  if (!canTransitionDeliveryStop(stop.status, outcome)) {
    throw AppError.conflict("وضعیت این توقف قبلاً مشخص شده است", "DELIVERY_STOP_ALREADY_RESOLVED");
  }
  assertOrderTransition("picked_up", "proposed", actor);

  if (!(await claimStop(run, stop._id, outcome))) {
    throw AppError.conflict("وضعیت ماموریت تغییر کرد؛ دوباره تلاش کنید", "DELIVERY_RUN_CHANGED");
  }
  const proposed = await Order.updateOne(
    { _id: stop.orderId, "delivery.status": "picked_up", "delivery.courierId": run.courierId },
    {
      $set: {
        "delivery.status": "proposed",
        "delivery.proposedOutcome": stopOutcomeToProposedOutcome(outcome),
        "delivery.proposedAt": new Date(),
      },
    },
  );
  if (proposed.modifiedCount !== 1) {
    // Compensate: give the stop back so run and order never disagree.
    await DeliveryRun.updateOne(
      { _id: run._id, stops: { $elemMatch: { _id: stop._id, status: outcome } } },
      { $set: { "stops.$.status": "pending" }, $unset: { "stops.$.completedAt": 1 } },
    );
    throw AppError.conflict("سفارش هنوز تحویل پیک نشده است", "ORDER_NOT_PICKED_UP");
  }
  await completeRunIfFinished(run._id);
  return freshDto(run._id);
}

/** The courier postpones/skips a pending stop. The order stays with the courier (still picked_up); no Order.delivery change. */
export async function skipStop(actor: AuthContext, runId: string, stopId: string): Promise<DeliveryRunDto> {
  requireRole(actor, ["courier"]);
  const run = await loadOwnRun(actor, runId);
  requireActiveRun(run);
  const stop = run.stops.find((s) => s._id.toString() === stopId);
  if (!stop) throw AppError.notFound("توقف یافت نشد", "DELIVERY_STOP_NOT_FOUND");
  if (!canTransitionDeliveryStop(stop.status, "skipped")) {
    throw AppError.conflict("وضعیت این توقف قبلاً مشخص شده است", "DELIVERY_STOP_ALREADY_RESOLVED");
  }
  if (!(await claimStop(run, stop._id, "skipped"))) {
    throw AppError.conflict("وضعیت ماموریت تغییر کرد؛ دوباره تلاش کنید", "DELIVERY_RUN_CHANGED");
  }
  await completeRunIfFinished(run._id);
  return freshDto(run._id);
}

// ---------------------------------------------------------------- read

/** Admin: any run. Courier: only their own (same not-found as a missing run). Customers never reach a run. */
export async function getRun(actor: AuthContext, runId: string): Promise<DeliveryRunDto> {
  if (actor.role === "courier") {
    return toDeliveryRunDto(await loadOwnRun(actor, runId));
  }
  requireRole(actor, [...ADMIN_ROLES]);
  const run = await DeliveryRun.findById(toObjectId(runId, RUN_NOT_FOUND)).lean<RunRecord>();
  if (!run) throw RUN_NOT_FOUND();
  return toDeliveryRunDto(run);
}
