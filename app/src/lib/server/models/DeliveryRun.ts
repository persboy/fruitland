import { Schema, Model, model, models, Types } from "mongoose";
import {
  DELIVERY_RUN_STATUSES,
  DELIVERY_STOP_STATUSES,
  RESERVING_DELIVERY_RUN_STATUS,
  validateStopSet,
  type DeliveryRunStatus,
  type DeliveryStopStatus,
} from "@fruitland/shared";
import { baseSchemaOptions } from "./schemaUtils";

/**
 * One courier's batch of orders (Phase 14). Deliberately NOT a second
 * per-order delivery lifecycle: each order's own lifecycle stays in
 * `Order.delivery`. A stop only references its Order — the destination is
 * always read from `Order.deliveryAddress` (the snapshot), never copied here.
 * Two orders for the same address are two stops.
 *
 * `sequence` is the authoritative order (1..n, unique per run); the array
 * order carries no meaning. There is no persisted "current/next stop" — it
 * is derived (see getCurrentStop in @fruitland/shared).
 */
export interface IDeliveryStop {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  sequence: number;
  status: DeliveryStopStatus;
  /** Set when the stop leaves "pending". */
  completedAt?: Date;
}

const deliveryStopSchema = new Schema<IDeliveryStop>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    sequence: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: "{PATH} must be an integer" } },
    status: { type: String, enum: DELIVERY_STOP_STATUSES, required: true, default: "pending" },
    completedAt: { type: Date },
  },
  { _id: true },
);

export interface IDeliveryRun {
  courierId: Types.ObjectId;
  status: DeliveryRunStatus;
  stops: IDeliveryStop[];
  createdByAdminUserId: Types.ObjectId;
  activatedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancelledByUserId?: Types.ObjectId;
}

const deliveryRunSchema = new Schema<IDeliveryRun>(
  {
    courierId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: DELIVERY_RUN_STATUSES, required: true, default: "draft" },
    stops: {
      type: [deliveryStopSchema],
      validate: {
        validator: (stops: IDeliveryStop[]) =>
          stops.length > 0 &&
          validateStopSet(stops.map((s) => ({ orderId: s.orderId.toString(), sequence: s.sequence }))).ok,
        message: "Run must have at least one stop, one stop per order, with sequences exactly 1..n",
      },
    },
    createdByAdminUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    activatedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  baseSchemaOptions,
);

/** A courier's runs (list / active run lookup). */
deliveryRunSchema.index({ courierId: 1, status: 1 });

/**
 * THE order-reservation invariant, enforced by the database — but ONLY for
 * "active" runs (Phase 14 Decision Review, Decision 1 = Option B, approved):
 * a DRAFT reserves nothing, so the same order may appear in several drafts
 * at once. Only once a run is activated (`activateRun`, inside a MongoDB
 * transaction — see services/deliveryRunService.ts) does an order become
 * unavailable to any other run. This is a plain equality filter (not
 * `$in`), so — unlike the draft-or-active version this replaced — it
 * carries no MongoDB >= 6.0 requirement; partial indexes with a simple
 * equality predicate have worked since partial indexes were introduced.
 * A unique multikey index does not stop the same order appearing twice
 * inside ONE run — validateStopSet covers that.
 */
deliveryRunSchema.index(
  { "stops.orderId": 1 },
  { unique: true, partialFilterExpression: { status: RESERVING_DELIVERY_RUN_STATUS } },
);

/**
 * THE one-active-run-per-courier invariant (Phase 14 Decision Review,
 * Decision 4 — approved): a courier may have any number of "draft" runs
 * (Decision 1 — drafts reserve nothing) and any number of "completed"/
 * "cancelled" runs (history), but at most one "active" run at a time.
 * Same shape as the order-reservation index above — a plain equality
 * partial filter on exactly `RESERVING_DELIVERY_RUN_STATUS` ("active"),
 * so it carries the same no-MongoDB-6.0-requirement property. This index,
 * not the service-level pre-check in `activateRun`, is the authoritative
 * concurrency guard: two concurrent `activateRun` calls for the same
 * courier's two different drafts can both pass a pre-check read, but only
 * one of their two transactions can win the final index-guarded write —
 * the loser's whole transaction (including any Order writes it made)
 * aborts. This does NOT touch `courierProfile.status`/availability
 * (Decision 5, separate and not yet decided).
 */
deliveryRunSchema.index(
  { courierId: 1 },
  { unique: true, partialFilterExpression: { status: RESERVING_DELIVERY_RUN_STATUS } },
);

export const DeliveryRun =
  (models.DeliveryRun as Model<IDeliveryRun> | undefined) || model<IDeliveryRun>("DeliveryRun", deliveryRunSchema);
