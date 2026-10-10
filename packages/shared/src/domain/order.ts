import { z } from "zod";
import {
  ORDER_DELIVERY_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  type OrderDeliveryProposedOutcome,
  type OrderDeliveryStatus,
  type OrderSource,
  type OrderStatus,
  type ProductUnit,
} from "./enums";
import { normalizeDigits } from "./customer";

/**
 * Admin Orders (MASTER-PROMPT §39 Phase 4, page 9): list, read-only detail and
 * ordinary cancellation. Owner decisions frozen for this page:
 *  - Ordinary cancellation: only `Order.status === "preparing"` AND the order is not in a
 *    delivery run (`delivery.status === "unassigned"`); the reason is mandatory.
 *  - No create / edit / payment / discount / stock behaviour exists here.
 *  - The list/detail bounds mirror Customers (limit 1–100 default 20, search ≤ 50, out-of-range
 *    values are rejected, never clamped).
 */

export const ORDER_LIST_DEFAULT_LIMIT = 20;
export const ORDER_LIST_MAX_LIMIT = 100;
export const ORDER_SEARCH_MAX_LENGTH = 50;
export const ORDER_CANCEL_REASON_MAX_LENGTH = 500;

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(z.enum(values, { errorMap: () => ({ message }) }).optional())
    .optional();

export const orderListQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: "شماره‌ی صفحه نامعتبر است" })
    .int("شماره‌ی صفحه باید عدد صحیح باشد")
    .min(1, "شماره‌ی صفحه باید حداقل ۱ باشد")
    .max(1_000_000, "شماره‌ی صفحه بیش از حد بزرگ است")
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: "تعداد در صفحه نامعتبر است" })
    .int("تعداد در صفحه باید عدد صحیح باشد")
    .min(1, "تعداد در صفحه باید حداقل ۱ باشد")
    .max(ORDER_LIST_MAX_LIMIT, `تعداد در صفحه حداکثر ${ORDER_LIST_MAX_LIMIT} باشد`)
    .default(ORDER_LIST_DEFAULT_LIMIT),
  search: z
    .string()
    .trim()
    .max(ORDER_SEARCH_MAX_LENGTH, `عبارت جست‌وجو حداکثر ${ORDER_SEARCH_MAX_LENGTH} نویسه باشد`)
    .transform((v) => normalizeDigits(v))
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  status: optionalEnum(ORDER_STATUSES, "فیلتر وضعیت سفارش نامعتبر است"),
  deliveryStatus: optionalEnum(ORDER_DELIVERY_STATUSES, "فیلتر وضعیت تحویل نامعتبر است"),
  source: optionalEnum(ORDER_SOURCES, "فیلتر منبع سفارش نامعتبر است"),
});

/** `reason` is mandatory (non-blank after trim). Unknown keys (status, isPaid, …) are rejected, not stripped. */
export const cancelOrderSchema = z
  .object({
    reason: z
      .string({ required_error: "دلیل لغو الزامی است", invalid_type_error: "دلیل لغو نامعتبر است" })
      .trim()
      .min(1, "دلیل لغو الزامی است")
      .max(ORDER_CANCEL_REASON_MAX_LENGTH, `دلیل لغو حداکثر ${ORDER_CANCEL_REASON_MAX_LENGTH} نویسه باشد`),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (key !== "reason") ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `فیلد «${key}» مجاز نیست` });
    }
  })
  .transform(({ reason }) => ({ reason }));

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type CancelOrderRequest = z.infer<typeof cancelOrderSchema>;

export interface OrderListItemDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  deliveryStatus: OrderDeliveryStatus;
  source: OrderSource;
  /** Account name of the ordering customer; null when never registered or the account is gone. */
  customerName: string | null;
  customerPhone: string | null;
  /** Recipient written on the order's own address snapshot. */
  recipientName: string;
  itemCount: number;
  totalAmount: number;
  isReplacement: boolean;
  createdAt: string;
}

export interface OrderItemDto {
  id: string;
  productName: string;
  unit: ProductUnit;
  unitPrice: number;
  quantity: number;
  discountAmount: number;
  lineTotal: number;
}

export interface OrderLinkDto {
  id: string;
  orderNumber: string;
}

/** Read-only detail. Courier data is name/phone only — never a location. */
export interface OrderDetailDto extends OrderListItemDto {
  customer: { id: string; name: string | null; phone: string } | null;
  deliveryAddress: { recipientName: string; phone: string; province: string; city: string; addressLine: string; postalCode: string | null };
  items: OrderItemDto[];
  subtotalAmount: number;
  discountCode: string | null;
  discountAmount: number;
  deliveryFeeAmount: number;
  paymentMethod: "cod";
  isPaid: boolean;
  paidAt: string | null;
  customerNote: string | null;
  delivery: {
    status: OrderDeliveryStatus;
    courier: { id: string; name: string | null; phone: string } | null;
    assignedAt: string | null;
    pickedUpAt: string | null;
    proposedOutcome: OrderDeliveryProposedOutcome | null;
    proposedAt: string | null;
    resolvedAt: string | null;
    emergencyCancelledAt: string | null;
  };
  cancellation: { reason: string | null; canceledAt: string | null; canceledByUserId: string | null } | null;
  replacesOrder: OrderLinkDto | null;
  replacedBy: OrderLinkDto[];
  updatedAt: string;
}

export interface OrderListResult {
  items: OrderListItemDto[];
  pagination: { page: number; pageSize: number; total: number };
}
