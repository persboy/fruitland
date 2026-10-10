"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Ban } from "lucide-react";
import { ORDER_CANCEL_REASON_MAX_LENGTH, PRODUCT_UNIT_LABELS, cancelOrderSchema, type OrderDetailDto } from "@fruitland/shared";
import { Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { cancelOrder, fetchOrder } from "@/lib/client/adminOrders";
import { formatJalaliDateTime, formatToman } from "@/lib/client/format";
import { InfoRow, InlineError, InlineSuccess } from "../settings/fields";
import { SectionState, useSectionLoad } from "../site-content/useSectionLoad";
import { DELIVERY_STATUS_LABELS, DeliveryStatusBadge, OrderStatusBadge, SOURCE_LABELS } from "./labels";

const dateOrDash = (iso: string | null) => (iso ? formatJalaliDateTime(iso) : "—");

/** Cancellation is offered only when the server would accept it: status preparing AND not in a delivery run. */
export const canCancel = (o: Pick<OrderDetailDto, "status" | "deliveryStatus">) => o.status === "preparing" && o.deliveryStatus === "unassigned";

function CancelPanel({ order, onCancelled }: { order: OrderDetailDto; onCancelled: (o: OrderDetailDto) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setError(null);
    const parsed = cancelOrderSchema.safeParse({ reason });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setSaving(true);
    try {
      onCancelled(await cancelOrder(order.id, parsed.data.reason));
    } catch (err) {
      setError(errorMessage(err)); // includes the server's specific 409 reason (e.g. the order just entered a delivery run)
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        <Ban className="h-4 w-4" aria-hidden="true" />
        لغو سفارش
      </Button>
    );
  }
  return (
    <form
      noValidate
      aria-label="لغو سفارش"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-3 rounded-xl border border-red-100 bg-red-50/40 p-4"
    >
      <p className="text-sm font-bold text-red-700">لغو سفارش {order.orderNumber}</p>
      <p className="text-xs text-gray-500">این کار قابل بازگشت نیست. دلیل لغو الزامی است و در تاریخچه ثبت می‌شود.</p>
      <div>
        <label htmlFor="order-cancel-reason" className="mb-1 block text-xs font-medium text-gray-500">دلیل لغو</label>
        <textarea
          id="order-cancel-reason"
          value={reason}
          maxLength={ORDER_CANCEL_REASON_MAX_LENGTH}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
        />
      </div>
      <InlineError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="danger" isLoading={saving} disabled={saving}>
          تأیید لغو سفارش
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => { setOpen(false); setError(null); }}>
          انصراف
        </Button>
      </div>
    </form>
  );
}

/** /admin/orders/[id] — read-only details from the order's own stored snapshots, plus ordinary cancellation. */
export function OrderDetail({ id }: { id: string }) {
  const { state, reload, setData } = useSectionLoad(() => fetchOrder(id));
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800">
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        بازگشت به فهرست سفارش‌ها
      </Link>

      <SectionState state={state} noun="سفارش" returnTo={`/admin/orders/${id}`} onRetry={reload} />

      {state.status === "ready" && (
        <OrderBody
          order={state.data}
          notice={notice}
          onCancelled={(o) => {
            setData(() => o);
            setNotice("سفارش لغو شد");
          }}
        />
      )}
    </div>
  );
}

function OrderBody({ order, notice, onCancelled }: { order: OrderDetailDto; notice: string | null; onCancelled: (o: OrderDetailDto) => void }) {
  const d = order.delivery;
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">
              سفارش <span dir="ltr">{order.orderNumber}</span>
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <DeliveryStatusBadge status={order.deliveryStatus} />
              <span className="text-xs text-gray-400">{SOURCE_LABELS[order.source]}</span>
              {order.isReplacement && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-600">سفارش جایگزین</span>}
            </div>
          </div>
          {canCancel(order) && <CancelPanelHost order={order} onCancelled={onCancelled} />}
        </div>
        <div className="mt-3 space-y-2">
          <InlineSuccess message={notice} />
        </div>
        {!canCancel(order) && order.status !== "cancelled" && (
          <p className="mt-3 text-[11px] text-gray-400">
            {order.status === "preparing" ? "این سفارش در ماموریت تحویل است و از این مسیر قابل لغو نیست." : "فقط سفارش «در حال آماده‌سازی» قابل لغو است."}
          </p>
        )}
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="تاریخ ثبت" value={formatJalaliDateTime(order.createdAt)} />
          <InfoRow label="آخرین تغییر" value={formatJalaliDateTime(order.updatedAt)} />
        </dl>
      </Card>

      {order.cancellation && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-gray-900">اطلاعات لغو</h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoRow label="دلیل لغو" value={order.cancellation.reason ?? "—"} />
            <InfoRow label="زمان لغو" value={dateOrDash(order.cancellation.canceledAt)} />
          </dl>
        </Card>
      )}

      {(order.replacesOrder || order.replacedBy.length > 0) && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-gray-900">سفارش جایگزین</h3>
          <div className="space-y-1 text-sm text-gray-700">
            {order.replacesOrder && (
              <p>
                این سفارش جایگزین سفارش{" "}
                <Link className="font-bold text-emerald-700 hover:underline" dir="ltr" href={`/admin/orders/${order.replacesOrder.id}`}>
                  {order.replacesOrder.orderNumber}
                </Link>{" "}
                است.
              </p>
            )}
            {order.replacedBy.map((r) => (
              <p key={r.id}>
                سفارش جایگزین این سفارش:{" "}
                <Link className="font-bold text-emerald-700 hover:underline" dir="ltr" href={`/admin/orders/${r.id}`}>
                  {r.orderNumber}
                </Link>
              </p>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h3 className="mb-2 text-sm font-bold text-gray-900">مشتری و آدرس تحویل (ثبت‌شده در سفارش)</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="مشتری" value={order.customer?.name ?? "بدون نام"} />
          <InfoRow label="موبایل مشتری" value={order.customer?.phone ?? "—"} ltr />
          <InfoRow label="گیرنده" value={order.deliveryAddress.recipientName} />
          <InfoRow label="موبایل گیرنده" value={order.deliveryAddress.phone} ltr />
          <InfoRow label="نشانی" value={`${order.deliveryAddress.province}، ${order.deliveryAddress.city}، ${order.deliveryAddress.addressLine}`} />
          <InfoRow label="کدپستی" value={order.deliveryAddress.postalCode ?? "—"} ltr />
        </dl>
        {order.customerNote && <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">توضیح مشتری: {order.customerNote}</p>}
      </Card>

      <Card className="p-0">
        <h3 className="px-4 pt-4 text-sm font-bold text-gray-900">اقلام سفارش</h3>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[36rem] text-right text-sm">
            <caption className="sr-only">اقلام سفارش</caption>
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th scope="col" className="px-4 py-2 font-medium">محصول</th>
                <th scope="col" className="px-4 py-2 font-medium">تعداد</th>
                <th scope="col" className="px-4 py-2 font-medium">قیمت واحد</th>
                <th scope="col" className="px-4 py-2 font-medium">جمع ردیف</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2 font-semibold text-gray-800">{i.productName}</td>
                  <td className="px-4 py-2 text-gray-600">{i.quantity.toLocaleString("fa-IR")} {PRODUCT_UNIT_LABELS[i.unit] ?? i.unit}</td>
                  <td className="px-4 py-2 text-gray-600">{formatToman(i.unitPrice)}</td>
                  <td className="px-4 py-2 text-gray-700">{formatToman(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-gray-900">مبالغ و پرداخت (فقط نمایش)</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="جمع اقلام" value={formatToman(order.subtotalAmount)} />
          <InfoRow label={order.discountCode ? `تخفیف (${order.discountCode})` : "تخفیف"} value={formatToman(order.discountAmount)} />
          <InfoRow label="هزینه‌ی ارسال" value={formatToman(order.deliveryFeeAmount)} />
          <InfoRow label="مبلغ کل" value={formatToman(order.totalAmount)} />
          <InfoRow label="روش پرداخت" value="پرداخت در محل" />
          <InfoRow label="وضعیت پرداخت" value={order.isPaid ? `پرداخت‌شده${order.paidAt ? ` — ${formatJalaliDateTime(order.paidAt)}` : ""}` : "پرداخت‌نشده"} />
        </dl>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-gray-900">تحویل</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="وضعیت تحویل" value={DELIVERY_STATUS_LABELS[d.status]} />
          <InfoRow label="پیک" value={d.courier ? `${d.courier.name ?? "بدون نام"} — ${d.courier.phone}` : "—"} />
          <InfoRow label="زمان تخصیص" value={dateOrDash(d.assignedAt)} />
          <InfoRow label="زمان تحویل‌گیری توسط پیک" value={dateOrDash(d.pickedUpAt)} />
          {d.proposedOutcome && <InfoRow label="پیشنهاد پیک" value={d.proposedOutcome === "delivered" ? "تحویل‌شد" : "عودت"} />}
          {d.proposedAt && <InfoRow label="زمان پیشنهاد" value={dateOrDash(d.proposedAt)} />}
          {d.resolvedAt && <InfoRow label="زمان نهایی‌شدن" value={dateOrDash(d.resolvedAt)} />}
          {d.emergencyCancelledAt && <InfoRow label="زمان لغو اضطراری" value={dateOrDash(d.emergencyCancelledAt)} />}
        </dl>
        {d.status === "proposed" && <p className="mt-3 text-[11px] text-gray-400">تأیید یا رد پیشنهاد پیک در صفحه‌ی مدیریت تحویل انجام می‌شود، نه اینجا.</p>}
      </Card>
    </>
  );
}

function CancelPanelHost({ order, onCancelled }: { order: OrderDetailDto; onCancelled: (o: OrderDetailDto) => void }) {
  return (
    <div className="w-full sm:w-auto sm:min-w-[20rem]">
      <CancelPanel order={order} onCancelled={onCancelled} />
    </div>
  );
}
