import { Schema, Model, model, models, Types } from "mongoose";
import {
  ORDER_DELIVERY_PROPOSED_OUTCOMES,
  ORDER_DELIVERY_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PRODUCT_UNITS,
  type OrderDeliveryProposedOutcome,
  type OrderDeliveryStatus,
  type OrderSource,
  type OrderStatus,
  type ProductUnit,
} from "@fruitland/shared";
import { baseSchemaOptions, tomanValidator } from "./schemaUtils";

/**
 * See docs/domain-model.md §5 for the reasoning behind every snapshot field
 * below. In short: an order must remain historically correct even if the
 * product, its price, or the customer's address change later.
 */

export interface IOrderItem {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  /** Snapshot at purchase time — do not re-read from Product for historical display. */
  productName: string;
  unit: ProductUnit;
  unitPrice: number;
  quantity: number;
  discountAmount: number;
  lineTotal: number;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true },
    unit: { type: String, enum: PRODUCT_UNITS, required: true },
    unitPrice: { type: Number, required: true, min: 0, validate: tomanValidator },
    quantity: { type: Number, required: true, min: 1 },
    discountAmount: { type: Number, default: 0, validate: tomanValidator },
    lineTotal: { type: Number, required: true, min: 0, validate: tomanValidator },
  },
  { _id: true },
);

export interface IOrderAddressSnapshot {
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  addressLine: string;
  postalCode?: string;
  location?: { lat: number; lng: number };
}

const orderAddressSnapshotSchema = new Schema<IOrderAddressSnapshot>(
  {
    recipientName: { type: String, required: true },
    phone: { type: String, required: true },
    province: { type: String, required: true },
    city: { type: String, required: true },
    addressLine: { type: String, required: true },
    postalCode: { type: String },
    location: { type: new Schema({ lat: Number, lng: Number }, { _id: false }), required: false },
  },
  { _id: false },
);

/**
 * Independent from `Order.status` — see docs/domain-model.md §4. Only an
 * admin transition can set `status: "resolved"`; a courier can only reach
 * "proposed". Four distinct moments, not to be confused with each other
 * (Phase 14 Decision Review, Decision 2 — approved):
 *
 *   assignedAt  = the order was officially handed to a courier's active
 *                 DeliveryRun by admin activation (services/deliveryRunService.ts
 *                 `activateRun`, Decision 1). This is the "official
 *                 assignment" instant Project Instructions §8 means by
 *                 "delivery performance starts from Admin approval".
 *   pickedUpAt  = the courier physically received the goods and confirmed
 *                 custody (`confirmPickup`) — a real-world event distinct
 *                 from the paperwork of assignment. Recorded, but NOT (in
 *                 this phase) used as a performance-measurement boundary or
 *                 in any reporting/analytics.
 *   proposedAt  = the courier's claimed outcome (delivered/returned),
 *                 pending admin confirmation.
 *   resolvedAt  = the timestamp used for courier performance reporting
 *                 (Project Instructions §8: "... ends at final delivery").
 */
export interface IOrderDelivery {
  status: OrderDeliveryStatus;
  courierId?: Types.ObjectId;
  assignedAt?: Date;
  pickedUpAt?: Date;
  proposedOutcome?: OrderDeliveryProposedOutcome;
  proposedAt?: Date;
  resolvedAt?: Date;
  resolvedByUserId?: Types.ObjectId;
}

const orderDeliverySchema = new Schema<IOrderDelivery>(
  {
    status: { type: String, enum: ORDER_DELIVERY_STATUSES, default: "unassigned" },
    courierId: { type: Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date },
    pickedUpAt: { type: Date },
    proposedOutcome: { type: String, enum: ORDER_DELIVERY_PROPOSED_OUTCOMES },
    proposedAt: { type: Date },
    resolvedAt: { type: Date },
    resolvedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

export interface IOrder {
  orderNumber: string;
  userId: Types.ObjectId;
  source: OrderSource;
  /** Set only when source === "phone": the operator who created it on the customer's behalf. */
  createdByAdminUserId?: Types.ObjectId;
  status: OrderStatus;
  items: IOrderItem[];
  deliveryAddress: IOrderAddressSnapshot;
  subtotalAmount: number;
  discountCode?: string;
  discountAmount: number;
  deliveryFeeAmount: number;
  totalAmount: number;
  /**
   * Deliberately just two fields today because only cash-on-delivery is
   * approved (Project Instructions §8). When online payment is approved,
   * this is expected to grow into an embedded `payment` sub-document
   * without needing to touch these two fields — see docs/domain-model.md §5.5.
   */
  paymentMethod: "cod";
  isPaid: boolean;
  paidAt?: Date;
  delivery: IOrderDelivery;
  cancelReason?: string;
  canceledAt?: Date;
  canceledByUserId?: Types.ObjectId;
  customerNote?: string;
}

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    source: { type: String, enum: ORDER_SOURCES, required: true, default: "online" },
    createdByAdminUserId: { type: Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ORDER_STATUSES, required: true, default: "preparing", index: true },
    items: {
      type: [orderItemSchema],
      validate: {
        validator: (v: IOrderItem[]) => v.length > 0,
        message: "Order must have at least one item",
      },
    },
    deliveryAddress: { type: orderAddressSnapshotSchema, required: true },
    subtotalAmount: { type: Number, required: true, min: 0, validate: tomanValidator },
    discountCode: { type: String },
    discountAmount: { type: Number, default: 0, validate: tomanValidator },
    deliveryFeeAmount: { type: Number, default: 0, validate: tomanValidator },
    totalAmount: { type: Number, required: true, min: 0, validate: tomanValidator },
    paymentMethod: { type: String, enum: ["cod"], required: true, default: "cod" },
    isPaid: { type: Boolean, default: false },
    paidAt: { type: Date },
    delivery: { type: orderDeliverySchema, default: () => ({ status: "unassigned" }) },
    cancelReason: { type: String },
    canceledAt: { type: Date },
    canceledByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    customerNote: { type: String },
  },
  baseSchemaOptions,
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ "delivery.courierId": 1, "delivery.status": 1 });

export const Order = (models.Order as Model<IOrder> | undefined) || model<IOrder>("Order", orderSchema);
