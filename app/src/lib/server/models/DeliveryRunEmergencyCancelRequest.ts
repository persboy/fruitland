import { Schema, Model, model, models, Types } from "mongoose";
import { EMERGENCY_CANCEL_REQUEST_STATUSES, type EmergencyCancelRequestStatus } from "@fruitland/shared";
import { baseSchemaOptions } from "./schemaUtils";

/**
 * A courier's request to recover an active `DeliveryRun` after physical
 * pickup (Emergency Cancel, Phase 14). Run-level — there is deliberately no
 * `affectedOrderIds`/`affectedItems` field: the request is about the run,
 * not individual stops (see services/emergencyCancelService.ts for why,
 * and for the "no partial customer delivery" business rule this reflects).
 *
 * Lifecycle: `pending → approved | rejected` (both terminal — see
 * `canTransitionEmergencyCancelRequest` in @fruitland/shared). Approval is
 * the one place `Order.delivery` can reach `"emergency_cancelled"` and the
 * one place Replacement Orders get created — always inside a MongoDB
 * transaction, same pattern as `activateRun`.
 *
 * `physicalReturn` is deliberately embedded here rather than a separate
 * model: it is a small, request-scoped fact ("did the courier's already-
 * picked-up goods make it back to the store"), not an independent entity
 * with its own lifecycle, and it is written at most once per request by an
 * admin, well after approval — never by DeliveryRun code, and never
 * blocking Replacement Order creation/dispatch.
 */
export interface IPhysicalReturn {
  returned: boolean;
  recordedByAdminUserId: Types.ObjectId;
  recordedAt: Date;
}

export interface IDeliveryRunEmergencyCancelRequest {
  deliveryRunId: Types.ObjectId;
  requestedByCourierId: Types.ObjectId;
  reason: string;
  status: EmergencyCancelRequestStatus;
  requestedAt: Date;
  reviewedByAdminUserId?: Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  /** Set during approval — one entry per "picked_up" Order the run had at approval time. */
  replacementOrderIds: Types.ObjectId[];
  physicalReturn?: IPhysicalReturn;
}

const physicalReturnSchema = new Schema<IPhysicalReturn>(
  {
    returned: { type: Boolean, required: true },
    recordedByAdminUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    recordedAt: { type: Date, required: true },
  },
  { _id: false },
);

const deliveryRunEmergencyCancelRequestSchema = new Schema<IDeliveryRunEmergencyCancelRequest>(
  {
    deliveryRunId: { type: Schema.Types.ObjectId, ref: "DeliveryRun", required: true },
    requestedByCourierId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: EMERGENCY_CANCEL_REQUEST_STATUSES, required: true, default: "pending" },
    requestedAt: { type: Date, required: true },
    reviewedByAdminUserId: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    replacementOrderIds: { type: [{ type: Schema.Types.ObjectId, ref: "Order" }], default: [] },
    physicalReturn: { type: physicalReturnSchema },
  },
  baseSchemaOptions,
);

/**
 * THE one-pending-request-per-run invariant, enforced by the database — the
 * authoritative guard against a courier's duplicate concurrent request, not
 * just a service-level pre-check (same philosophy as the partial unique
 * indexes in DeliveryRun.ts for Decisions 1 and 4). A plain equality filter
 * (not `$in`), so it carries no MongoDB >= 6.0 requirement. Also serves as
 * the lookup index for "does this run have a pending request" — no
 * additional plain `{deliveryRunId}` index is added; this phase has no
 * "list every request for a run" query to justify one (YAGNI).
 */
deliveryRunEmergencyCancelRequestSchema.index(
  { deliveryRunId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" }, name: "one_pending_request_per_run" },
);

export const DeliveryRunEmergencyCancelRequest =
  (models.DeliveryRunEmergencyCancelRequest as Model<IDeliveryRunEmergencyCancelRequest> | undefined) ||
  model<IDeliveryRunEmergencyCancelRequest>("DeliveryRunEmergencyCancelRequest", deliveryRunEmergencyCancelRequestSchema);
