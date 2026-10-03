import { Types, startSession } from "mongoose";
import { canTransitionEmergencyCancelRequest, type EmergencyCancelRequestStatus } from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { requireRole, type AuthContext } from "../auth/guard";
import { AuditLog } from "../models/AuditLog";
import { DeliveryRun } from "../models/DeliveryRun";
import { DeliveryRunEmergencyCancelRequest, type IDeliveryRunEmergencyCancelRequest } from "../models/DeliveryRunEmergencyCancelRequest";
import { Order, type IOrder } from "../models/Order";
import { getNextOrderNumber } from "../models/OrderCounter";
import { isDuplicateKeyError, isTransactionsUnsupportedError } from "./deliveryRunService";

/**
 * Emergency Cancel: the explicit recovery mechanism for an active
 * `DeliveryRun` that already has at least one "picked_up" order — exactly
 * the situation the ordinary `cancelRun` (deliveryRunService.ts)
 * deliberately refuses (`RUN_HAS_PICKED_UP_ORDERS`). The two operations are
 * intentionally separate and neither weakens the other:
 *
 *   cancelRun        — ordinary admin cancellation; refuses once anything
 *                       is picked up.
 *   Emergency Cancel  — courier REQUESTS it, admin REVIEWS it; only
 *                       approval actually changes anything.
 *
 * Run-level by design: there is no per-order/per-item request, because this
 * is a fruit store and a customer's order is prepared and delivered as one
 * complete unit — there is no partial-delivery concept to request against.
 *
 * On approval (the one multi-document, must-be-atomic operation here, same
 * transaction pattern as `activateRun` in deliveryRunService.ts):
 *  - the request is claimed (pending → approved) — this and ONLY this
 *    conditional write is what lets exactly one concurrent reviewer win;
 *  - the run is cancelled (active → cancelled — the existing transition,
 *    no new run status);
 *  - EVERY order in the run is reclassified by its CURRENT delivery status
 *    at write time, never by a stale read taken before the transaction:
 *      picked_up → emergency_cancelled, plus a full Replacement Order;
 *      assigned  → unassigned (released, free to be assigned again);
 *      anything else (proposed/resolved/emergency_cancelled already, i.e.
 *        the courier/admin moved it forward through a legitimate path that
 *        raced in) → left untouched — Emergency Cancel does not override a
 *        more-advanced legitimate outcome that happened concurrently.
 *  - stop statuses (pending/delivered/failed/skipped) are NEVER written by
 *    this file — Decision 1's stop-status model is untouched, and a
 *    historical delivered/failed/skipped stop is never rewritten.
 *
 * `Order.status` is never read or written here (Decision 3). `Replacement`
 * orders enter the existing lifecycle at its normal default ("preparing"),
 * exactly like any other order — this file does not invent a transition
 * for it. `courierProfile.status` is never read or written here (Decision 5).
 */

const ADMIN_ROLES = ["admin", "master_admin"] as const;

export interface EmergencyCancelRequestDto {
  id: string;
  deliveryRunId: string;
  requestedByCourierId: string;
  reason: string;
  status: EmergencyCancelRequestStatus;
  requestedAt: string;
  reviewedByAdminUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  replacementOrderIds: string[];
  physicalReturn: { returned: boolean; recordedByAdminUserId: string; recordedAt: string } | null;
}

type RequestRecord = IDeliveryRunEmergencyCancelRequest & { _id: Types.ObjectId };

export function toEmergencyCancelRequestDto(doc: RequestRecord): EmergencyCancelRequestDto {
  return {
    id: doc._id.toString(),
    deliveryRunId: doc.deliveryRunId.toString(),
    requestedByCourierId: doc.requestedByCourierId.toString(),
    reason: doc.reason,
    status: doc.status,
    requestedAt: doc.requestedAt.toISOString(),
    reviewedByAdminUserId: doc.reviewedByAdminUserId?.toString() ?? null,
    reviewedAt: doc.reviewedAt?.toISOString() ?? null,
    rejectionReason: doc.rejectionReason ?? null,
    replacementOrderIds: doc.replacementOrderIds.map((id) => id.toString()),
    physicalReturn: doc.physicalReturn
      ? {
          returned: doc.physicalReturn.returned,
          recordedByAdminUserId: doc.physicalReturn.recordedByAdminUserId.toString(),
          recordedAt: doc.physicalReturn.recordedAt.toISOString(),
        }
      : null,
  };
}

// ---------------------------------------------------------------- helpers

const REQUEST_NOT_FOUND = () => AppError.notFound("درخواست یافت نشد", "EMERGENCY_CANCEL_REQUEST_NOT_FOUND");
const RUN_NOT_FOUND = () => AppError.notFound("ماموریت یافت نشد", "DELIVERY_RUN_NOT_FOUND");
const invalidId = () => AppError.badRequest("شناسه نامعتبر است", "INVALID_ID");

function toObjectId(id: string, onInvalid: () => AppError): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw onInvalid();
  return new Types.ObjectId(id);
}

async function freshRequestDto(id: Types.ObjectId): Promise<EmergencyCancelRequestDto> {
  const doc = await DeliveryRunEmergencyCancelRequest.findById(id).lean<RequestRecord>();
  if (!doc) throw REQUEST_NOT_FOUND();
  return toEmergencyCancelRequestDto(doc);
}

/** Internal control-flow marker: another reviewer's write won the race to claim this pending request. */
class RequestAlreadyClaimedError extends Error {}
/** Internal control-flow marker: the run stopped being active between the pre-check and the transaction. */
class RunNoLongerActiveError extends Error {}
/** Internal control-flow marker: the run's own cancellation write did not match — status changed concurrently. */
class RunChangedDuringApprovalError extends Error {}

// ---------------------------------------------------------------- courier: request

/**
 * The courier's request. Does NOT touch the run or any order — only
 * records the request itself (pending). Requires at least one order in the
 * run to currently be "picked_up"; otherwise there is nothing for Emergency
 * Cancel to recover (an all-pending run can simply use ordinary `cancelRun`).
 */
export async function requestEmergencyCancel(actor: AuthContext, runId: string, reason: string): Promise<EmergencyCancelRequestDto> {
  requireRole(actor, ["courier"]);
  if (!reason?.trim()) throw AppError.badRequest("دلیل درخواست الزامی است", "EMERGENCY_CANCEL_REASON_REQUIRED");

  const id = toObjectId(runId, RUN_NOT_FOUND);
  const courierId = toObjectId(actor.userId, RUN_NOT_FOUND);
  const run = await DeliveryRun.findOne({ _id: id, courierId }).lean<{ status: string; stops: Array<{ orderId: Types.ObjectId }> }>();
  if (!run) throw RUN_NOT_FOUND();
  if (run.status !== "active") {
    throw AppError.conflict("این ماموریت فعال نیست", "DELIVERY_RUN_NOT_ACTIVE");
  }
  const pickedUpCount = await Order.countDocuments({
    _id: { $in: run.stops.map((s) => s.orderId) },
    "delivery.status": "picked_up",
  });
  if (pickedUpCount === 0) {
    throw AppError.conflict(
      "هیچ سفارشی در این ماموریت هنوز تحویل پیک نشده است؛ برای لغو از عملیات عادی استفاده کنید",
      "EMERGENCY_CANCEL_NO_PICKED_UP_ORDERS",
    );
  }

  try {
    const created = await DeliveryRunEmergencyCancelRequest.create({
      deliveryRunId: id,
      requestedByCourierId: courierId,
      reason: reason.trim(),
      status: "pending",
      requestedAt: new Date(),
      replacementOrderIds: [],
    });
    await AuditLog.create({
      actorUserId: courierId,
      action: "deliveryRun.emergency_cancel_requested",
      entityType: "DeliveryRunEmergencyCancelRequest",
      entityId: created._id,
      after: { deliveryRunId: id, reason: created.reason },
    });
    return freshRequestDto(created._id);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict("این ماموریت از قبل یک درخواست لغو اضطراری در انتظار بررسی دارد", "EMERGENCY_CANCEL_REQUEST_ALREADY_PENDING");
    }
    throw error;
  }
}

// ---------------------------------------------------------------- admin: review

/** Builds the fields copied onto a Replacement Order from the original — everything except identity/number/delivery state, which are always fresh. */
function buildReplacementInput(original: IOrder & { _id: Types.ObjectId }) {
  return {
    userId: original.userId,
    source: original.source,
    items: original.items,
    deliveryAddress: original.deliveryAddress,
    subtotalAmount: original.subtotalAmount,
    discountCode: original.discountCode,
    discountAmount: original.discountAmount,
    deliveryFeeAmount: original.deliveryFeeAmount,
    totalAmount: original.totalAmount,
    paymentMethod: original.paymentMethod,
    // Deliberately NOT copied: isPaid/paidAt. Under the project's current
    // COD-only model (Project Instructions §8), payment is collected in
    // cash at physical hand-off, which never happened for the original —
    // so "isPaid" stays at its normal default (false) exactly like any new
    // order, and the courier collects cash once, on the replacement. This
    // is not a new payment/refund subsystem; it is simply never marking an
    // order paid when no cash was ever collected for it.
    replacesOrderId: original._id,
  };
}

/**
 * Approves or rejects a pending request. Rejection is a single conditional
 * write (nothing else changes — Section A below). Approval is the one
 * multi-document transactional operation in this file (Section B).
 *
 * Idempotent by design: reviewing an already-approved request with
 * "approve" (or an already-rejected one with "reject") returns the existing
 * state with no new side effects — never a second Replacement Order, a
 * second AuditLog entry, or a second run cancellation. Reviewing a request
 * with the OPPOSITE decision from its actual terminal state is a real
 * conflict (`EMERGENCY_CANCEL_ALREADY_REVIEWED`), not silently accepted.
 */
export async function reviewEmergencyCancelRequest(
  actor: AuthContext,
  requestId: string,
  decision: "approve" | "reject",
  rejectionReason?: string,
): Promise<EmergencyCancelRequestDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const id = toObjectId(requestId, REQUEST_NOT_FOUND);
  const adminId = toObjectId(actor.userId, invalidId);
  const now = new Date();

  const current = await DeliveryRunEmergencyCancelRequest.findById(id).lean<RequestRecord>();
  if (!current) throw REQUEST_NOT_FOUND();

  const matchingTerminalStatus: EmergencyCancelRequestStatus = decision === "approve" ? "approved" : "rejected";
  if (current.status !== "pending") {
    if (current.status === matchingTerminalStatus) return toEmergencyCancelRequestDto(current); // idempotent no-op
    throw AppError.conflict("این درخواست قبلاً بررسی شده است", "EMERGENCY_CANCEL_ALREADY_REVIEWED");
  }
  if (!canTransitionEmergencyCancelRequest(current.status, matchingTerminalStatus)) {
    throw AppError.conflict("این تغییر وضعیت مجاز نیست", "EMERGENCY_CANCEL_INVALID_TRANSITION");
  }

  // ---------------- A. Reject: a single conditional write, nothing else changes.
  if (decision === "reject") {
    if (!rejectionReason?.trim()) throw AppError.badRequest("دلیل رد الزامی است", "EMERGENCY_CANCEL_REJECTION_REASON_REQUIRED");
    const result = await DeliveryRunEmergencyCancelRequest.updateOne(
      { _id: id, status: "pending" },
      { $set: { status: "rejected", reviewedByAdminUserId: adminId, reviewedAt: now, rejectionReason: rejectionReason.trim() } },
    );
    if (result.modifiedCount !== 1) {
      const fresh = await DeliveryRunEmergencyCancelRequest.findById(id).lean<RequestRecord>();
      if (fresh?.status === "rejected") return toEmergencyCancelRequestDto(fresh); // another reviewer rejected it first — idempotent
      throw AppError.conflict("این درخواست قبلاً بررسی شده است", "EMERGENCY_CANCEL_ALREADY_REVIEWED");
    }
    await AuditLog.create({
      actorUserId: adminId,
      action: "deliveryRun.emergency_cancel_rejected",
      entityType: "DeliveryRunEmergencyCancelRequest",
      entityId: id,
      after: { rejectionReason: rejectionReason.trim() },
    });
    return freshRequestDto(id);
  }

  // ---------------- B. Approve: transactional, all-or-nothing (same pattern as activateRun).
  const session = await startSession();
  const replacementOrderIds: Types.ObjectId[] = [];
  try {
    await session.withTransaction(async () => {
      const claim = await DeliveryRunEmergencyCancelRequest.updateOne(
        { _id: id, status: "pending" },
        { $set: { status: "approved", reviewedByAdminUserId: adminId, reviewedAt: now } },
        { session },
      );
      if (claim.modifiedCount !== 1) throw new RequestAlreadyClaimedError();

      const run = await DeliveryRun.findOne({ _id: current.deliveryRunId, status: "active" }).session(session).lean<{
        _id: Types.ObjectId;
        courierId: Types.ObjectId;
        stops: Array<{ orderId: Types.ObjectId }>;
      }>();
      if (!run) throw new RunNoLongerActiveError();

      const flip = await DeliveryRun.updateOne(
        { _id: run._id, status: "active" },
        { $set: { status: "cancelled", cancelledAt: now, cancelledByUserId: adminId } },
        { session },
      );
      if (flip.modifiedCount !== 1) throw new RunChangedDuringApprovalError();

      for (const stop of run.stops) {
        // Current state at write time, never a stale pre-transaction read (Section 8 of the approved design):
        // try the more-specific "picked_up" claim first, then "assigned"; anything else (proposed/resolved/
        // already emergency_cancelled — a legitimate path that raced in) is left completely untouched.
        const pickedUp = await Order.findOneAndUpdate(
          { _id: stop.orderId, "delivery.status": "picked_up", "delivery.courierId": run.courierId },
          { $set: { "delivery.status": "emergency_cancelled", "delivery.emergencyCancelledAt": now } },
          { session, new: true },
        );
        if (pickedUp) {
          const orderNumber = await getNextOrderNumber(session);
          const [replacement] = await Order.create([{ orderNumber, ...buildReplacementInput(pickedUp) }], { session });
          replacementOrderIds.push(replacement!._id);
          await AuditLog.create(
            [
              {
                actorUserId: adminId,
                action: "order.created_as_replacement",
                entityType: "Order",
                entityId: replacement!._id,
                after: { replacesOrderId: pickedUp._id, orderNumber },
              },
            ],
            { session },
          );
          continue;
        }
        await Order.updateOne(
          { _id: stop.orderId, "delivery.status": "assigned", "delivery.courierId": run.courierId },
          { $set: { "delivery.status": "unassigned" }, $unset: { "delivery.courierId": 1, "delivery.assignedAt": 1 } },
          { session },
        );
      }

      if (replacementOrderIds.length > 0) {
        await DeliveryRunEmergencyCancelRequest.updateOne({ _id: id }, { $set: { replacementOrderIds } }, { session });
      }
      await AuditLog.create(
        [
          {
            actorUserId: adminId,
            action: "deliveryRun.emergency_cancel_approved",
            entityType: "DeliveryRunEmergencyCancelRequest",
            entityId: id,
            after: { cancelledRunId: run._id, replacementOrderIds },
          },
        ],
        { session },
      );
    });
  } catch (error) {
    if (error instanceof RequestAlreadyClaimedError) {
      const fresh = await DeliveryRunEmergencyCancelRequest.findById(id).lean<RequestRecord>();
      if (fresh?.status === "approved") return toEmergencyCancelRequestDto(fresh); // another admin's approval already won — idempotent
      throw AppError.conflict("این درخواست قبلاً بررسی شده است", "EMERGENCY_CANCEL_ALREADY_REVIEWED");
    }
    if (error instanceof RunNoLongerActiveError) {
      throw AppError.conflict("این ماموریت دیگر فعال نیست", "DELIVERY_RUN_NOT_ACTIVE");
    }
    if (error instanceof RunChangedDuringApprovalError) {
      throw AppError.conflict("وضعیت ماموریت تغییر کرد؛ دوباره تلاش کنید", "DELIVERY_RUN_CHANGED");
    }
    if (isTransactionsUnsupportedError(error)) {
      throw new Error(
        "این عملیات به یک تراکنش چندسندی MongoDB نیاز دارد که این استقرار (mongod مستقل، نه replica set/mongos) از آن پشتیبانی نمی‌کند. " +
          "تأیید لغو اضطراری عمداً بدون تراکنش انجام نشد تا از انجام جزئی آن (لغو ماموریت بدون ساخت سفارش جایگزین، یا برعکس) جلوگیری شود. " +
          "برای این عملیات، MongoDB باید به‌صورت replica set (یا mongos) پیکربندی شود.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return freshRequestDto(id);
}

// ---------------------------------------------------------------- admin: physical return

/**
 * Records, after the fact, whether the originally picked-up goods made it
 * back to the store. Purely informational in this phase (Phase 14): never
 * blocks or reopens anything, never affects the Replacement Order (already
 * created at approval time), and never touches `Order.status`. Can only be
 * recorded once a decision exists, and only on an approved request — an
 * admin recording a physical return implies goods existed to return, which
 * is only true once Emergency Cancel actually happened.
 */
export async function recordPhysicalReturn(actor: AuthContext, requestId: string, returned: boolean): Promise<EmergencyCancelRequestDto> {
  requireRole(actor, [...ADMIN_ROLES]);
  const id = toObjectId(requestId, REQUEST_NOT_FOUND);
  const adminId = toObjectId(actor.userId, invalidId);
  const current = await DeliveryRunEmergencyCancelRequest.findById(id).lean<RequestRecord>();
  if (!current) throw REQUEST_NOT_FOUND();
  if (current.status !== "approved") {
    throw AppError.conflict("ثبت بازگشت فیزیکی فقط برای درخواست تأییدشده ممکن است", "EMERGENCY_CANCEL_NOT_APPROVED");
  }
  const now = new Date();
  await DeliveryRunEmergencyCancelRequest.updateOne(
    { _id: id },
    { $set: { physicalReturn: { returned, recordedByAdminUserId: adminId, recordedAt: now } } },
  );
  await AuditLog.create({
    actorUserId: adminId,
    action: "deliveryRun.emergency_cancel_physical_return_recorded",
    entityType: "DeliveryRunEmergencyCancelRequest",
    entityId: id,
    after: { returned },
  });
  return freshRequestDto(id);
}

// ---------------------------------------------------------------- read

/** Admin: any request. Courier: only their own (same not-found as a missing request). */
export async function getEmergencyCancelRequest(actor: AuthContext, requestId: string): Promise<EmergencyCancelRequestDto> {
  const id = toObjectId(requestId, REQUEST_NOT_FOUND);
  if (actor.role === "courier") {
    const courierId = toObjectId(actor.userId, REQUEST_NOT_FOUND);
    const doc = await DeliveryRunEmergencyCancelRequest.findOne({ _id: id, requestedByCourierId: courierId }).lean<RequestRecord>();
    if (!doc) throw REQUEST_NOT_FOUND();
    return toEmergencyCancelRequestDto(doc);
  }
  requireRole(actor, [...ADMIN_ROLES]);
  return freshRequestDto(id);
}
