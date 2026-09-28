import { Schema, Model, model, models, Types } from "mongoose";
import {
  DELIVERY_RUN_STATUSES,
  DELIVERY_STOP_STATUSES,
  OPEN_DELIVERY_RUN_STATUSES,
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
 * THE one-order-one-open-run invariant, enforced by the database: an order
 * may appear in at most one draft/active run. Completed/cancelled runs are
 * outside the partial filter, so history keeps its order references, and
 * this same index serves order → run lookup. (`$in` inside a partial filter
 * requires MongoDB >= 6.0.) A unique multikey index does not stop the same
 * order appearing twice inside ONE run — validateStopSet covers that.
 */
deliveryRunSchema.index(
  { "stops.orderId": 1 },
  { unique: true, partialFilterExpression: { status: { $in: [...OPEN_DELIVERY_RUN_STATUSES] } } },
);

export const DeliveryRun =
  (models.DeliveryRun as Model<IDeliveryRun> | undefined) || model<IDeliveryRun>("DeliveryRun", deliveryRunSchema);
