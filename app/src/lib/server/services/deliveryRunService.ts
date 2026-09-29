import { Types, startSession } from "mongoose";
import {
  buildInitialStops,
  canActorTransitionOrderDelivery,
  canTransitionDeliveryRun,
  canTransitionDeliveryStop,
  computeReorderedSequences,
  stopOutcomeToProposedOutcome,
  validateStopSet,
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
 *    invented; activation does NOT change it).
 *  - A courier can only PROPOSE an outcome; "resolved" is admin-only and is
 *    deliberately not reachable from this file.
 *  - Destinations are never copied: a stop is an orderId; the address is the
 *    order's own `deliveryAddress` snapshot.
 *
 * Draft vs. active (Phase 14 Decision Review, Decision 1 — approved Option
 * B): a DRAFT is planning only. Building/editing a draft NEVER touches
 * `Order.delivery` — no courierId, no assignedAt, nothing reserved. The same
 * order may sit in several drafts at once. The order is actually assigned,
 * and reserved against every other run, only at `activateRun`, which is the
 * one place `Order.delivery.assignedAt` is set. `activateRun` is the one
 * multi-document operation in this file for which partial success is not
 * an accepted domain state, so it is the one place that uses a MongoDB
 * transaction (`mongoose.startSession()` + `session.withTransaction`) —
 * everywhere else, a single-document conditional update is enough because
 * each of those operations only ever needs one Order (or the run's own
 * document) to change atomically. Transactions need a replica set/mongos;
 * see activateRun's doc comment for what happens when the deployment is a
 * standalone `mongod` (e.g. the project's default local `MONGODB_URI`, and
 * the `MongoMemoryServer` this project's other integration tests use).
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
const invalidId = () => AppError.badRequest("شناسه نامعتبر است", "INVALID_ID");

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

/**
 * Best-effort detection of "this MongoDB deployment does not support
 * transactions" (a standalone `mongod`, not a replica set/mongos). The
 * driver's real error for this is a server error, code 20 ("IllegalOperation"),
 * with a message containing "Transaction numbers are only allowed on a
 * replica set member or mongos" — matched on both since the exact code can
 * vary by driver/server version and this is best-effort, not a documented
 * stable contract.
 */
function isTransactionsUnsupportedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: number; message?: string };
  return e.code === 20 || /transaction numbers are only allowed on a replica set|replica set member or mongos/i.test(e.message ?? "");
}

/** Internal control-flow marker: which order made activation fail, so the catch site can report it — never thrown across an await boundary the caller sees. */
class OrderNotEligibleError extends Error {
  constructor(readonly orderId: string) {
    super(`Order ${orderId} is not eligible for assignment`);
  }
}
/** Internal control-flow marker: the run itself was no longer a draft by the time the transaction tried to flip it. */
class RunChangedDuringActivationError extends Error {}

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

/** Admin-owned load of a DRAFT specifically — every draft-editing operation needs exactly this. */
async function loadDraft(runId: string): Promise<RunRecord> {
  const id = toObjectId(runId, RUN_NOT_FOUND);
  const run = await DeliveryRun.findById(id).lean<RunRecord>();
  if (!run) throw RUN_NOT_FOUND();
  if (run.status !== "draft") {
    throw AppError.conflict("فقط ماموریت پیش‌نویس قابل ویرایش است", "DELIVERY_RUN_NOT_DRAFT");
  }
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

/** Writes a draft's whole stop list back after re-validating it — every draft-editing operation ends this way. Never touches Order.delivery. */
async function writeDraftStops(run: RunRecord, stops: Array<{ orderId: Types.ObjectId; sequence: number; status: "pending" }>): Promise<DeliveryRunDto> {
  unwrap(validateStopSet(stops.map((s) => ({ orderId: s.orderId.toString(), sequence: s.sequence }))));
  const result = await DeliveryRun.updateOne({ _id: run._id, status: "draft" }, { $set: { stops } });
  if (result.matchedCount !== 1) {
    throw AppError.conflict("وضعیت ماموریت تغییر کرد؛ دوباره تلاش کنید", "DELIVERY_RUN_CHANGED");
  }
  return freshDto(run._id);
}

// ---------------------------------------------------------------- admin: draft (planning only — never touches Order.delivery)

/**
 * Creates a PLAN. Reserves nothing: the given orders are not touched at all
 * (no courierId, no assignedAt, `Order.delivery` untouched), and the same
 * order may already be sitting in any number of other drafts — that is
 * allowed. Only existence of the orders and of an active courier profile is
 * checked here; real eligibility (is this order still assignable right
 * now?) is decided at `activateRun`.
 */
export async function createDraftRun(actor: AuthContext, input: { courierId: string; orderIds: string[] }): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const stops = unwrap(buildInitialStops(input.orderIds));
  const courierId = toObjectId(input.courierId, invalidId);
  const orderObjectIds = stops.map((s) => toObjectId(s.orderId, invalidId));

  const courier = await User.findOne({ _id: courierId, role: "courier", isActive: true }, { courierProfile: 1 });
  if (!courier) throw AppError.badRequest("پیک معتبر و فعال یافت نشد", "COURIER_NOT_FOUND");
  if (!courier.courierProfile) {
    throw AppError.conflict("نوع وسیله‌ی نقلیه‌ی پیک ثبت نشده است", "COURIER_PROFILE_MISSING");
  }

  const existing = await Order.countDocuments({ _id: { $in: orderObjectIds } });
  if (existing !== orderObjectIds.length) throw AppError.notFound("سفارش یافت نشد", "ORDER_NOT_FOUND");

  const run = await DeliveryRun.create({
    courierId,
    status: "draft",
    createdByAdminUserId: toObjectId(actor.userId, invalidId),
    stops: stops.map((s, i) => ({ orderId: orderObjectIds[i], sequence: s.sequence, status: "pending" as const })),
  });
  return freshDto(run._id);
}

/**
 * Adds one order to an existing draft as a new last stop. The order may
 * already be in other drafts — that is allowed and not checked here.
 */
export async function addStopToDraft(actor: AuthContext, runId: string, orderId: string): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const run = await loadDraft(runId);
  const orderObjectId = toObjectId(orderId, invalidId);
  if (run.stops.some((s) => s.orderId.equals(orderObjectId))) {
    throw AppError.badRequest("این سفارش پیش‌تر در همین ماموریت اضافه شده است", "DUPLICATE_ORDER");
  }
  if ((await Order.countDocuments({ _id: orderObjectId })) === 0) {
    throw AppError.notFound("سفارش یافت نشد", "ORDER_NOT_FOUND");
  }
  const nextSequence = Math.max(0, ...run.stops.map((s) => s.sequence)) + 1;
  return writeDraftStops(run, [
    ...run.stops.map((s) => ({ orderId: s.orderId, sequence: s.sequence, status: "pending" as const })),
    { orderId: orderObjectId, sequence: nextSequence, status: "pending" as const },
  ]);
}

/** Removes one stop from a draft. Never touches Order.delivery — nothing was reserved. Refuses to leave a draft with zero stops; cancel it instead. */
export async function removeStopFromDraft(actor: AuthContext, runId: string, stopId: string): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const run = await loadDraft(runId);
  const remaining = run.stops.filter((s) => s._id.toString() !== stopId);
  if (remaining.length === run.stops.length) throw AppError.notFound("توقف یافت نشد", "DELIVERY_STOP_NOT_FOUND");
  if (remaining.length === 0) {
    throw AppError.badRequest("ماموریت نمی‌تواند بدون هیچ توقفی باقی بماند؛ به‌جای آن ماموریت را لغو کنید", "DELIVERY_RUN_WOULD_BE_EMPTY");
  }
  // Re-sequenced to stay exactly 1..n — removing stop #2 of 3 must not leave a gap.
  const resequenced = [...remaining]
    .sort((a, b) => a.sequence - b.sequence)
    .map((s, i) => ({ orderId: s.orderId, sequence: i + 1, status: "pending" as const }));
  return writeDraftStops(run, resequenced);
}

/** Reorders a draft's stops. Every stop in the draft is always "pending" (nothing has happened yet), so this is a plain permutation — no locked stops to preserve, unlike the courier's reorderStops on an active run. */
export async function reorderDraftStops(actor: AuthContext, runId: string, orderedStopIds: string[]): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const run = await loadDraft(runId);
  const stopsLike = run.stops.map((s) => ({ id: s._id.toString(), orderId: s.orderId.toString(), sequence: s.sequence, status: s.status }));
  const assignments = unwrap(computeReorderedSequences(stopsLike, orderedStopIds));
  const bySequence = new Map(assignments.map((a) => [a.stopId, a.sequence]));
  const reordered = run.stops.map((s) => ({ orderId: s.orderId, sequence: bySequence.get(s._id.toString())!, status: "pending" as const }));
  return writeDraftStops(run, reordered);
}

// ---------------------------------------------------------------- admin: activate / cancel

/**
 * The ONE place an order is actually assigned. All-or-nothing across every
 * stop in the run (Phase 14 Decision Review, Decision 1 — approved): either
 * every order becomes `Order.delivery = assigned` (with `courierId` and
 * `assignedAt` set to this moment, never the draft's creation time) and the
 * run becomes `active`, or nothing changes at all — a run half-activated
 * with some orders assigned and others not is not an accepted domain state.
 *
 * This needs a real MongoDB transaction: conditional single-document
 * updates cannot express "all N of these succeed or none do" across N+1
 * documents (the orders and the run). `session.withTransaction` retries
 * transient errors and commits/aborts as a unit.
 *
 * ENVIRONMENT REQUIREMENT: transactions require a replica set or mongos —
 * a standalone `mongod` cannot run them at all. The project's default local
 * `MONGODB_URI` (`mongodb://localhost:27017/...`, see app/.env.example) and
 * this project's other integration tests' `MongoMemoryServer` are both
 * standalone. On such a deployment this function throws a plain `Error`
 * (deliberately NOT an AppError — see errors/AppError.ts's own doc comment:
 * an unexpected error is meant to surface as a logged, generic 500, which is
 * the correct classification for "this environment cannot run this
 * operation at all", as opposed to an ordinary expected-failure AppError).
 * It does NOT fall back to non-transactional per-order updates, because
 * that could silently produce exactly the partial activation this function
 * exists to prevent. A production deployment on MongoDB Atlas (always a
 * replica set) is unaffected; local dev/CI needs a replica-set-mode
 * MongoDB (or `MongoMemoryReplSet` for tests) for this one function.
 */
export async function activateRun(actor: AuthContext, runId: string): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const id = toObjectId(runId, RUN_NOT_FOUND);
  if (!canTransitionDeliveryRun("draft", "active")) {
    throw AppError.conflict("انتقال نامعتبر", "INVALID_RUN_TRANSITION");
  }

  // Read outside the transaction purely to give a precise error (missing vs.
  // not-a-draft) and the order id list; the transaction re-checks status.
  const draft = await DeliveryRun.findById(id).lean<RunRecord>();
  if (!draft) throw RUN_NOT_FOUND();
  if (draft.status !== "draft") {
    throw AppError.conflict("فقط ماموریت پیش‌نویس قابل فعال‌سازی است", "INVALID_RUN_TRANSITION");
  }

  const now = new Date();
  const session = await startSession();
  try {
    await session.withTransaction(async () => {
      for (const stop of draft.stops) {
        const result = await Order.updateOne(
          { _id: stop.orderId, status: "preparing", "delivery.status": "unassigned" },
          { $set: { "delivery.status": "assigned", "delivery.courierId": draft.courierId, "delivery.assignedAt": now } },
          { session },
        );
        if (result.modifiedCount !== 1) throw new OrderNotEligibleError(stop.orderId.toString());
      }
      const flip = await DeliveryRun.updateOne(
        { _id: id, status: "draft" },
        { $set: { status: "active", activatedAt: now } },
        { session },
      );
      if (flip.modifiedCount !== 1) throw new RunChangedDuringActivationError();
    });
  } catch (error) {
    if (error instanceof OrderNotEligibleError) {
      throw AppError.conflict(
        `سفارش دیگر قابل تخصیص نیست؛ کل عملیات فعال‌سازی لغو شد (شناسه سفارش: ${error.orderId})`,
        "ORDER_NOT_ASSIGNABLE",
      );
    }
    if (error instanceof RunChangedDuringActivationError) {
      throw AppError.conflict("وضعیت ماموریت تغییر کرد؛ دوباره تلاش کنید", "DELIVERY_RUN_CHANGED");
    }
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict(
        "یکی از سفارش‌ها هم‌اکنون در یک ماموریت فعال دیگر است؛ کل عملیات فعال‌سازی لغو شد",
        "ORDER_ALREADY_IN_ACTIVE_RUN",
      );
    }
    if (isTransactionsUnsupportedError(error)) {
      throw new Error(
        "این عملیات به یک تراکنش چندسندی MongoDB نیاز دارد که این استقرار (mongod مستقل، نه replica set/mongos) از آن پشتیبانی نمی‌کند. " +
          "فعال‌سازی عمداً بدون تراکنش انجام نشد تا از فعال‌سازی جزئی (بخشی از سفارش‌ها تخصیص‌یافته و بخشی نه) جلوگیری شود. " +
          "برای فعال‌سازی ماموریت، MongoDB باید به‌صورت replica set (یا mongos) پیکربندی شود.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return freshDto(id);
}

/**
 * A draft is discarded, not "released" — it never reserved anything, so
 * `Order.delivery` is never touched. An active run's cancellation is
 * separate and still subject to the existing order-state rule below.
 */
export async function cancelRun(actor: AuthContext, runId: string): Promise<DeliveryRunDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const id = toObjectId(runId, RUN_NOT_FOUND);
  const run = await DeliveryRun.findById(id).lean<RunRecord>();
  if (!run) throw RUN_NOT_FOUND();
  if (!canTransitionDeliveryRun(run.status, "cancelled")) {
    throw AppError.conflict("این ماموریت قابل لغو نیست", "INVALID_RUN_TRANSITION");
  }

  if (run.status === "draft") {
    const result = await DeliveryRun.updateOne(
      { _id: id, status: "draft" },
      { $set: { status: "cancelled", cancelledAt: new Date(), cancelledByUserId: toObjectId(actor.userId, RUN_NOT_FOUND) } },
    );
    if (result.modifiedCount !== 1) throw AppError.conflict("وضعیت ماموریت تغییر کرد", "DELIVERY_RUN_CHANGED");
    return freshDto(id);
  }

  // run.status === "active" from here (draft/active are the only transitions canTransitionDeliveryRun allows into "cancelled").
  const orderIds = run.stops.map((s) => s.orderId);
  const beyondAssigned = await Order.countDocuments({ _id: { $in: orderIds }, "delivery.status": { $ne: "assigned" } });
  if (beyondAssigned > 0) {
    throw AppError.conflict("بخشی از سفارش‌ها تحویل پیک شده‌اند؛ لغو ماموریت مجاز نیست", "RUN_HAS_PICKED_UP_ORDERS");
  }
  const result = await DeliveryRun.updateOne(
    { _id: id, status: "active" },
    { $set: { status: "cancelled", cancelledAt: new Date(), cancelledByUserId: toObjectId(actor.userId, RUN_NOT_FOUND) } },
  );
  if (result.modifiedCount !== 1) throw AppError.conflict("وضعیت ماموریت تغییر کرد", "DELIVERY_RUN_CHANGED");
  await releaseOrders(orderIds, run.courierId);
  return freshDto(id);
}

// ---------------------------------------------------------------- courier

/**
 * Physical custody changes hands: the courier confirms they have actually
 * received the goods from the store/warehouse. This is a DIFFERENT moment
 * from "assigned" (Phase 14 Decision Review, Decision 2 — approved):
 *
 *   assigned   = the order was officially handed to this run by admin
 *                activation (Decision 1) — `assignedAt`, set once, never
 *                touched again by this function.
 *   picked_up  = the courier physically has the goods in hand right now —
 *                `pickedUpAt`, the actual confirmation time.
 *
 * Always an explicit courier action — never implied by `proposeStopOutcome`,
 * reordering, route operations, or activation. `proposeStopOutcome`
 * continues to require `picked_up` (not merely `assigned`) before a courier
 * may propose an outcome, because physical custody is the meaningful
 * milestone, not just the paperwork of assignment.
 *
 * Applies to all still-pending stops in one call and is idempotent (a stop
 * already past "pending" is simply not touched again).
 */
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
