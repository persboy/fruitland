import type { OrderDeliveryStatus, OrderSource, OrderStatus } from "@fruitland/shared";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  preparing: "در حال آماده‌سازی",
  shipped: "ارسال‌شده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
  returned: "مرجوعی",
};

export const DELIVERY_STATUS_LABELS: Record<OrderDeliveryStatus, string> = {
  unassigned: "بدون پیک",
  assigned: "تخصیص‌یافته",
  picked_up: "تحویل پیک شد",
  proposed: "پیشنهاد پیک (در انتظار تأیید)",
  resolved: "نهایی‌شده",
  emergency_cancelled: "لغو اضطراری",
};

export const SOURCE_LABELS: Record<OrderSource, string> = { online: "آنلاین", phone: "تلفنی" };

const STATUS_TONE: Record<OrderStatus, string> = {
  preparing: "bg-amber-50 text-amber-700",
  shipped: "bg-sky-50 text-sky-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-gray-100 text-gray-500",
  returned: "bg-red-50 text-red-600",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[status]}`}>{ORDER_STATUS_LABELS[status]}</span>;
}

export function DeliveryStatusBadge({ status }: { status: OrderDeliveryStatus }) {
  return <span className="inline-block rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-bold text-gray-600">{DELIVERY_STATUS_LABELS[status]}</span>;
}
