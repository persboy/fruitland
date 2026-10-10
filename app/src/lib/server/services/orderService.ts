import { Types } from "mongoose";
import type { OrderDetailDto, OrderLinkDto, OrderListItemDto, OrderListQuery, OrderListResult } from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { Order, type IOrder } from "../models/Order";
import { User } from "../models/User";

/**
 * Admin Orders (MASTER-PROMPT §39 Phase 4, page 9): list, read-only detail and ordinary
 * cancellation. There is no order creation, edit, payment, discount-usage, stock or
 * notification logic here.
 *
 * Boundaries (Owner decisions):
 *  - `Order.status` and `Order.delivery.status` stay independent. This service writes
 *    `Order.status` in exactly ONE place: cancelling a `preparing` order that is `unassigned`
 *    (below). The other `Order.status` write in the codebase is `confirmPickup`
 *    (preparing → shipped, atomic with delivery.status picked_up) in deliveryRunService.
 *  - Approving/rejecting a courier's `proposed` outcome is NOT here (roadmap item 11, Delivery).
 *  - `isPaid` / `paidAt` / `DiscountCode.usedCount` are never touched.
 *  - Everything returned is built field-by-field from an explicit projection: customer and courier
 *    are reduced to name + phone; `courierProfile` (incl. currentLocation), addresses, codes and
 *    credentials are never selected. The address shown is the order's own snapshot, never the
 *    current `User.addresses`; item names/prices are the stored snapshot, never `Product`.
 */

const ORDER_NOT_FOUND = () => AppError.notFound("سفارش یافت نشد", "ORDER_NOT_FOUND");

type LeanPerson = { _id: Types.ObjectId; firstName?: string; lastName?: string; phone: string };
type LeanListOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  userId: Types.ObjectId;
  status: OrderListItemDto["status"];
  source: OrderListItemDto["source"];
  delivery?: { status?: OrderListItemDto["deliveryStatus"] };
  deliveryAddress: { recipientName: string };
  items: Array<{ _id: Types.ObjectId }>;
  totalAmount: number;
  replacesOrderId?: Types.ObjectId;
  createdAt: Date;
};
type LeanDetailOrder = Omit<IOrder, "items"> & {
  _id: Types.ObjectId;
  items: Array<{ _id: Types.ObjectId; productName: string; unit: OrderDetailDto["items"][number]["unit"]; unitPrice: number; quantity: number; discountAmount?: number; lineTotal: number }>;
  createdAt: Date;
  updatedAt: Date;
};

const PERSON_PROJECTION = { firstName: 1, lastName: 1, phone: 1 } as const;
const LIST_PROJECTION = {
  orderNumber: 1,
  userId: 1,
  status: 1,
  source: 1,
  "delivery.status": 1,
  "deliveryAddress.recipientName": 1,
  "items._id": 1,
  totalAmount: 1,
  replacesOrderId: 1,
  createdAt: 1,
} as const;

const personName = (p: Pick<LeanPerson, "firstName" | "lastName"> | undefined) => {
  const name = [p?.firstName, p?.lastName].filter(Boolean).join(" ");
  return name || null;
};
const iso = (d: Date | undefined | null) => (d ? d.toISOString() : null);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_SEARCH_TOKENS = 3;
/** Search is resolved through at most this many matching customer accounts (documented limit; keeps the `userId $in` bounded). */
export const ORDER_SEARCH_MAX_CUSTOMERS = 50;

/**
 * Search = order number (anchored prefix of digits, served by the unique `orderNumber` index) OR the
 * ordering customer's name/phone (resolved on `User`, whose phone index serves the anchored phone
 * prefix; names are an unanchored, escaped match exactly like Customers) → `userId $in`.
 * Free text over the order's own address snapshot is deliberately NOT searched: it would be an
 * unindexed regex over the whole orders collection.
 */
async function searchCondition(search: string): Promise<Record<string, unknown>> {
  const or: Record<string, unknown>[] = [];
  if (/^\d+$/.test(search)) or.push({ orderNumber: new RegExp(`^${escapeRegex(search)}`) });

  const tokens = search.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
  const users = await User.find(
    {
      $and: tokens.map((token) => ({
        $or: [{ phone: new RegExp(`^${escapeRegex(token)}`) }, { firstName: new RegExp(escapeRegex(token), "i") }, { lastName: new RegExp(escapeRegex(token), "i") }],
      })),
    },
    { _id: 1 },
  )
    .limit(ORDER_SEARCH_MAX_CUSTOMERS)
    .lean<Array<{ _id: Types.ObjectId }>>();
  if (users.length > 0) or.push({ userId: { $in: users.map((u) => u._id) } });

  return or.length > 0 ? { $or: or } : { _id: { $in: [] } };
}

const toListItem = (o: LeanListOrder, users: Map<string, LeanPerson>): OrderListItemDto => {
  const user = users.get(o.userId.toString());
  return {
    id: o._id.toString(),
    orderNumber: o.orderNumber,
    status: o.status,
    deliveryStatus: o.delivery?.status ?? "unassigned",
    source: o.source,
    customerName: personName(user),
    customerPhone: user?.phone ?? null,
    recipientName: o.deliveryAddress.recipientName,
    itemCount: o.items.length,
    totalAmount: o.totalAmount,
    isReplacement: o.replacesOrderId !== undefined,
    createdAt: o.createdAt.toISOString(),
  };
};

async function loadPeople(ids: Types.ObjectId[]): Promise<Map<string, LeanPerson>> {
  if (ids.length === 0) return new Map();
  const docs = await User.find({ _id: { $in: ids } }, PERSON_PROJECTION).lean<LeanPerson[]>();
  return new Map(docs.map((d) => [d._id.toString(), d]));
}

export async function listOrders(query: OrderListQuery): Promise<OrderListResult> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.deliveryStatus) filter["delivery.status"] = query.deliveryStatus;
  if (query.source) filter.source = query.source;
  if (query.search) Object.assign(filter, await searchCondition(query.search));

  const [docs, total] = await Promise.all([
    Order.find(filter, LIST_PROJECTION)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<LeanListOrder[]>(),
    Order.countDocuments(filter),
  ]);
  const people = await loadPeople([...new Map(docs.map((d) => [d.userId.toString(), d.userId])).values()]);
  return { items: docs.map((d) => toListItem(d, people)), pagination: { page: query.page, pageSize: query.limit, total } };
}

export async function getOrder(id: string): Promise<OrderDetailDto> {
  if (!Types.ObjectId.isValid(id)) throw ORDER_NOT_FOUND();
  const _id = new Types.ObjectId(id);
  const o = await Order.findById(_id, {
    orderNumber: 1,
    userId: 1,
    source: 1,
    status: 1,
    items: 1,
    deliveryAddress: 1,
    subtotalAmount: 1,
    discountCode: 1,
    discountAmount: 1,
    deliveryFeeAmount: 1,
    totalAmount: 1,
    paymentMethod: 1,
    isPaid: 1,
    paidAt: 1,
    delivery: 1,
    cancelReason: 1,
    canceledAt: 1,
    canceledByUserId: 1,
    customerNote: 1,
    replacesOrderId: 1,
    createdAt: 1,
    updatedAt: 1,
  }).lean<LeanDetailOrder | null>();
  if (!o) throw ORDER_NOT_FOUND();

  const personIds = [o.userId, ...(o.delivery?.courierId ? [o.delivery.courierId] : [])];
  const [people, replaces, replacedBy] = await Promise.all([
    loadPeople(personIds),
    o.replacesOrderId ? Order.findById(o.replacesOrderId, { orderNumber: 1 }).lean<{ _id: Types.ObjectId; orderNumber: string } | null>() : Promise.resolve(null),
    Order.find({ replacesOrderId: _id }, { orderNumber: 1 }).sort({ createdAt: 1 }).lean<Array<{ _id: Types.ObjectId; orderNumber: string }>>(),
  ]);
  const customer = people.get(o.userId.toString());
  const courier = o.delivery?.courierId ? people.get(o.delivery.courierId.toString()) : undefined;
  const link = (x: { _id: Types.ObjectId; orderNumber: string }): OrderLinkDto => ({ id: x._id.toString(), orderNumber: x.orderNumber });
  const d = o.delivery;

  return {
    id: o._id.toString(),
    orderNumber: o.orderNumber,
    status: o.status,
    deliveryStatus: d?.status ?? "unassigned",
    source: o.source,
    customerName: personName(customer),
    customerPhone: customer?.phone ?? null,
    recipientName: o.deliveryAddress.recipientName,
    itemCount: o.items.length,
    totalAmount: o.totalAmount,
    isReplacement: o.replacesOrderId !== undefined,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    customer: customer ? { id: customer._id.toString(), name: personName(customer), phone: customer.phone } : null,
    deliveryAddress: {
      recipientName: o.deliveryAddress.recipientName,
      phone: o.deliveryAddress.phone,
      province: o.deliveryAddress.province,
      city: o.deliveryAddress.city,
      addressLine: o.deliveryAddress.addressLine,
      postalCode: o.deliveryAddress.postalCode ?? null,
    },
    items: o.items.map((i) => ({
      id: i._id.toString(),
      productName: i.productName,
      unit: i.unit,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      discountAmount: i.discountAmount ?? 0,
      lineTotal: i.lineTotal,
    })),
    subtotalAmount: o.subtotalAmount,
    discountCode: o.discountCode ?? null,
    discountAmount: o.discountAmount ?? 0,
    deliveryFeeAmount: o.deliveryFeeAmount ?? 0,
    paymentMethod: o.paymentMethod,
    isPaid: o.isPaid ?? false,
    paidAt: iso(o.paidAt),
    customerNote: o.customerNote ?? null,
    delivery: {
      status: d?.status ?? "unassigned",
      courier: courier ? { id: courier._id.toString(), name: personName(courier), phone: courier.phone } : null,
      assignedAt: iso(d?.assignedAt),
      pickedUpAt: iso(d?.pickedUpAt),
      proposedOutcome: d?.proposedOutcome ?? null,
      proposedAt: iso(d?.proposedAt),
      resolvedAt: iso(d?.resolvedAt),
      emergencyCancelledAt: iso(d?.emergencyCancelledAt),
    },
    cancellation:
      o.cancelReason || o.canceledAt || o.canceledByUserId
        ? { reason: o.cancelReason ?? null, canceledAt: iso(o.canceledAt), canceledByUserId: o.canceledByUserId?.toString() ?? null }
        : null,
    replacesOrder: replaces ? link(replaces) : null,
    replacedBy: replacedBy.map(link),
  };
}

/**
 * Ordinary cancellation (Owner decision, page 9). ONE conditional write whose FILTER pins both
 * expected states — `status: "preparing"` AND `delivery.status: "unassigned"` — so it can never
 * interleave with `activateRun` (which claims `preparing`+`unassigned` orders with the same
 * kind of conditional write) or `confirmPickup` (which needs `assigned`): whichever wins, the
 * other matches nothing and is rejected cleanly (409). No find-then-save.
 *
 * It deliberately refuses an order that is already in a run (`assigned`, `picked_up`, `proposed`,
 * `resolved`, `emergency_cancelled`) — those go through the delivery workflow (and Emergency
 * Cancel after pickup), never through this route — and never touches any DeliveryRun.
 * `isPaid`, `paidAt`, discount usage and every delivery field are left alone.
 *
 * The AuditLog entry follows the write (same pattern as the other single-document admin
 * services); it is written only for a cancellation that actually happened.
 */
export async function cancelOrder(actorUserId: string, id: string, reason: string): Promise<OrderDetailDto> {
  if (!Types.ObjectId.isValid(id)) throw ORDER_NOT_FOUND();
  const _id = new Types.ObjectId(id);
  const actor = new Types.ObjectId(actorUserId);

  const before = await Order.findOneAndUpdate(
    { _id, status: "preparing", "delivery.status": "unassigned" },
    { $set: { status: "cancelled", cancelReason: reason, canceledAt: new Date(), canceledByUserId: actor } },
    { new: false, runValidators: true, projection: { status: 1 } },
  ).lean<{ status: string } | null>();

  if (!before) {
    // Lost the race or never eligible: report the CURRENT reason; nothing was written.
    const fresh = await Order.findById(_id, { status: 1, "delivery.status": 1 }).lean<{ status: string; delivery?: { status?: string } } | null>();
    if (!fresh) throw ORDER_NOT_FOUND();
    if (fresh.status === "cancelled") throw AppError.conflict("این سفارش قبلاً لغو شده است", "ORDER_ALREADY_CANCELLED");
    if (fresh.status !== "preparing") {
      throw AppError.conflict("فقط سفارش «در حال آماده‌سازی» قابل لغو است", "ORDER_NOT_CANCELLABLE");
    }
    throw AppError.conflict(
      "این سفارش در ماموریت تحویل قرار دارد و از این مسیر قابل لغو نیست؛ ابتدا آن را از ماموریت خارج کنید",
      "ORDER_IN_DELIVERY",
    );
  }

  await AuditLog.create({
    actorUserId: actor,
    action: "order.cancelled",
    entityType: "Order",
    entityId: _id,
    before: { status: before.status },
    after: { status: "cancelled", cancelReason: reason },
  });
  return getOrder(id);
}
