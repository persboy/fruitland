"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, PackageSearch, Search, ShoppingBag } from "lucide-react";
import { ORDER_DELIVERY_STATUSES, ORDER_SOURCES, ORDER_STATUSES, type OrderDeliveryStatus, type OrderSource, type OrderStatus } from "@fruitland/shared";
import { Button, Card, StateMessage } from "@/components/ui";
import { ApiClientError } from "@/lib/client/apiClient";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchOrders, type OrderListItemDto, type PageInfo } from "@/lib/client/adminOrders";
import { formatJalaliDateTime, formatToman } from "@/lib/client/format";
import { SectionState, type LoadState } from "../site-content/useSectionLoad";
import { DELIVERY_STATUS_LABELS, DeliveryStatusBadge, ORDER_STATUS_LABELS, OrderStatusBadge, SOURCE_LABELS } from "./labels";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

type ListData = { items: OrderListItemDto[]; pagination: PageInfo };
type Params = { page: number; q: string; status: OrderStatus | ""; deliveryStatus: OrderDeliveryStatus | ""; source: OrderSource | "" };

const pick = <T extends string>(values: readonly T[], raw: string | null): T | "" => (values as readonly string[]).includes(raw ?? "") ? (raw as T) : "";

/** Reads the list parameters from the URL; anything invalid falls back to its default. */
function readParams(sp: URLSearchParams): Params {
  const pageRaw = Number(sp.get("page"));
  return {
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    q: (sp.get("q") ?? "").trim(),
    status: pick(ORDER_STATUSES, sp.get("status")),
    deliveryStatus: pick(ORDER_DELIVERY_STATUSES, sp.get("deliveryStatus")),
    source: pick(ORDER_SOURCES, sp.get("source")),
  };
}

const selectClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

/**
 * /admin/orders — read-only list. Every filter/search/page lives in the URL (same behaviour as
 * Customers/Couriers) so it survives reload and back/forward. There are no mutations on this page.
 */
export function OrdersManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = readParams(new URLSearchParams(searchParams.toString()));
  const { page, q, status, deliveryStatus, source } = params;

  const [input, setInput] = useState(q);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${page}|${q}|${status}|${deliveryStatus}|${source}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState<ListData> } | null>(null);
  const state: LoadState<ListData> = result && result.key === requestKey ? result.state : { status: "loading" };
  const lastPushedQ = useRef(q);

  const go = (next: Partial<Params>, mode: "push" | "replace") => {
    const merged = { ...params, ...next };
    const qs = new URLSearchParams();
    if (merged.q) qs.set("q", merged.q);
    if (merged.status) qs.set("status", merged.status);
    if (merged.deliveryStatus) qs.set("deliveryStatus", merged.deliveryStatus);
    if (merged.source) qs.set("source", merged.source);
    if (merged.page > 1) qs.set("page", String(merged.page));
    const url = qs.toString() ? `${pathname}?${qs.toString()}` : pathname;
    if (mode === "push") router.push(url);
    else router.replace(url);
  };

  useEffect(() => {
    if (q !== lastPushedQ.current) {
      lastPushedQ.current = q;
      setInput(q);
    }
  }, [q]);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === q) return;
    const t = setTimeout(() => {
      lastPushedQ.current = trimmed;
      go({ q: trimmed, page: 1 }, "replace");
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` only closes over the URL values already in the deps
  }, [input, q]);

  useEffect(() => {
    let cancelled = false;
    const setState = (next: LoadState<ListData>) => setResult({ key: requestKey, state: next });
    fetchOrders({ page, limit: PAGE_SIZE, search: q || undefined, status: status || undefined, deliveryStatus: deliveryStatus || undefined, source: source || undefined })
      .then(({ data, pagination }) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
        if (data.length === 0 && pagination.total > 0 && page > lastPage) {
          go({ page: lastPage }, "replace");
          return;
        }
        setState({ status: "ready", data: { items: data, pagination } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 403) setState({ status: "forbidden" });
        else if (err instanceof ApiClientError && err.status === 401) setState({ status: "unauthenticated" });
        else setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is derived from the URL params
  }, [requestKey]);

  const ready = state.status === "ready" ? state.data : null;
  const totalPages = ready ? Math.max(1, Math.ceil(ready.pagination.total / ready.pagination.pageSize)) : 1;
  const filtered = Boolean(q || status || deliveryStatus || source);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900">سفارش‌ها</h2>
        <p className="text-sm text-gray-400">فهرست و جزئیات سفارش‌ها؛ لغو سفارش در صفحه‌ی جزئیات انجام می‌شود</p>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-4">
            <label htmlFor="order-search" className="mb-1 block text-xs font-medium text-gray-500">
              جست‌وجو (شماره‌ی سفارش، نام یا موبایل مشتری)
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
              <input
                id="order-search"
                type="search"
                value={input}
                maxLength={50}
                onChange={(e) => setInput(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-3 pr-9 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
          <div>
            <label htmlFor="order-status" className="mb-1 block text-xs font-medium text-gray-500">وضعیت سفارش</label>
            <select id="order-status" value={status} onChange={(e) => go({ status: e.target.value as OrderStatus | "", page: 1 }, "push")} className={selectClass}>
              <option value="">همه</option>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="order-delivery-status" className="mb-1 block text-xs font-medium text-gray-500">وضعیت تحویل</label>
            <select id="order-delivery-status" value={deliveryStatus} onChange={(e) => go({ deliveryStatus: e.target.value as OrderDeliveryStatus | "", page: 1 }, "push")} className={selectClass}>
              <option value="">همه</option>
              {ORDER_DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{DELIVERY_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="order-source" className="mb-1 block text-xs font-medium text-gray-500">منبع سفارش</label>
            <select id="order-source" value={source} onChange={(e) => go({ source: e.target.value as OrderSource | "", page: 1 }, "push")} className={selectClass}>
              <option value="">همه</option>
              {ORDER_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <SectionState state={state} noun="سفارش‌ها" returnTo="/admin/orders" onRetry={() => setAttempt((n) => n + 1)} />

      {ready && ready.items.length === 0 && (
        <Card>
          <StateMessage
            icon={filtered ? PackageSearch : ShoppingBag}
            title={filtered ? "سفارشی با این شرایط پیدا نشد" : "هنوز سفارشی ثبت نشده است"}
            description={filtered ? "عبارت جست‌وجو یا فیلترها را تغییر دهید." : "سفارش‌ها پس از ثبت اینجا نمایش داده می‌شوند."}
            action={
              filtered ? (
                <Button size="sm" variant="secondary" onClick={() => { setInput(""); go({ q: "", status: "", deliveryStatus: "", source: "", page: 1 }, "push"); }}>
                  پاک‌کردن جست‌وجو و فیلترها
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {ready && ready.items.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-right text-sm">
              <caption className="sr-only">فهرست سفارش‌ها</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">شماره</th>
                  <th scope="col" className="px-4 py-3 font-medium">مشتری</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت سفارش</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت تحویل</th>
                  <th scope="col" className="px-4 py-3 font-medium">منبع</th>
                  <th scope="col" className="px-4 py-3 font-medium">اقلام</th>
                  <th scope="col" className="px-4 py-3 font-medium">مبلغ کل</th>
                  <th scope="col" className="px-4 py-3 font-medium">تاریخ ثبت</th>
                </tr>
              </thead>
              <tbody>
                {ready.items.map((o) => (
                  <tr key={o.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-bold text-emerald-700 hover:underline" dir="ltr">
                        {o.orderNumber}
                      </Link>
                      {o.isReplacement && <span className="mr-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-600">جایگزین</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <span className="block font-semibold">{o.customerName ?? o.recipientName}</span>
                      {o.customerPhone && <span className="block text-xs text-gray-400" dir="ltr">{o.customerPhone}</span>}
                    </td>
                    <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                    <td className="px-4 py-3"><DeliveryStatusBadge status={o.deliveryStatus} /></td>
                    <td className="px-4 py-3 text-gray-500">{SOURCE_LABELS[o.source]}</td>
                    <td className="px-4 py-3 text-gray-500">{o.itemCount.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-3 text-gray-700">{formatToman(o.totalAmount)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatJalaliDateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {ready && ready.pagination.total > 0 && (
        <nav aria-label="صفحه‌بندی سفارش‌ها" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500" aria-live="polite">
            صفحه {ready.pagination.page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")} — {ready.pagination.total.toLocaleString("fa-IR")} سفارش
          </p>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => go({ page: page - 1 }, "push")}>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              قبلی
            </Button>
            <Button size="xs" variant="secondary" disabled={page >= totalPages} onClick={() => go({ page: page + 1 }, "push")}>
              بعدی
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
