"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, UserX, Users } from "lucide-react";
import { CUSTOMER_STATUS_FILTERS, type CustomerListItemDto, type CustomerStatusFilter } from "@fruitland/shared";
import { Button, Card, StateMessage } from "@/components/ui";
import { ApiClientError } from "@/lib/client/apiClient";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchCustomers, type PageInfo } from "@/lib/client/adminCustomers";
import { formatJalaliDate } from "@/lib/client/format";
import { SectionState, StatusBadge, type LoadState } from "../site-content/useSectionLoad";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const STATUS_LABELS: Record<CustomerStatusFilter, string> = { all: "همه", active: "فعال", inactive: "غیرفعال" };

type ListData = { items: CustomerListItemDto[]; pagination: PageInfo };

/** Reads the three list parameters from the URL; anything invalid falls back to its default. */
function readParams(sp: URLSearchParams) {
  const pageRaw = Number(sp.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const statusRaw = sp.get("status");
  const status = (CUSTOMER_STATUS_FILTERS as readonly string[]).includes(statusRaw ?? "") ? (statusRaw as CustomerStatusFilter) : "all";
  return { page, status, q: (sp.get("q") ?? "").trim() };
}

export const customerName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || "بدون نام";

/**
 * /admin/customers — the list state (q, status, page) lives in the URL so it
 * survives reload and browser back/forward. Search typing is debounced and uses
 * `replace`; status/page changes use `push`. Changing search or status resets to page 1.
 */
export function CustomersManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { page, status, q } = readParams(new URLSearchParams(searchParams.toString()));

  const [input, setInput] = useState(q);
  const [attempt, setAttempt] = useState(0);
  // The result is tagged with the request key it belongs to; a stale/other key reads as "loading" (derived, no setState in the effect body).
  const requestKey = `${page}|${status}|${q}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState<ListData> } | null>(null);
  const state: LoadState<ListData> = result && result.key === requestKey ? result.state : { status: "loading" };
  const lastPushedQ = useRef(q);

  const go = (next: { page?: number; status?: CustomerStatusFilter; q?: string }, mode: "push" | "replace") => {
    const merged = { page, status, q, ...next };
    const qs = new URLSearchParams();
    if (merged.q) qs.set("q", merged.q);
    if (merged.status !== "all") qs.set("status", merged.status);
    if (merged.page > 1) qs.set("page", String(merged.page));
    const url = qs.toString() ? `${pathname}?${qs.toString()}` : pathname;
    if (mode === "push") router.push(url);
    else router.replace(url);
  };

  // URL → input (back/forward changed q from outside)
  useEffect(() => {
    if (q !== lastPushedQ.current) {
      lastPushedQ.current = q;
      setInput(q);
    }
  }, [q]);

  // input → URL, debounced; resets to page 1
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

  // URL → data
  useEffect(() => {
    let cancelled = false;
    const setState = (next: LoadState<ListData>) => setResult({ key: requestKey, state: next });
    fetchCustomers({ page, limit: PAGE_SIZE, search: q || undefined, status })
      .then(({ data, pagination }) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
        if (data.length === 0 && pagination.total > 0 && page > lastPage) {
          go({ page: lastPage }, "replace"); // page beyond the results (e.g. after a status change elsewhere)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is derived from page/status/q
  }, [requestKey]);

  const ready = state.status === "ready" ? state.data : null;
  const totalPages = ready ? Math.max(1, Math.ceil(ready.pagination.total / ready.pagination.pageSize)) : 1;
  const filtered = Boolean(q) || status !== "all";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="customer-search" className="mb-1 block text-xs font-medium text-gray-500">
              جست‌وجو (نام، نام‌خانوادگی یا شماره موبایل)
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
              <input
                id="customer-search"
                type="search"
                value={input}
                maxLength={50}
                onChange={(e) => setInput(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-3 pr-9 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
          <div>
            <label htmlFor="customer-status" className="mb-1 block text-xs font-medium text-gray-500">
              وضعیت حساب
            </label>
            <select
              id="customer-status"
              value={status}
              onChange={(e) => go({ status: e.target.value as CustomerStatusFilter, page: 1 }, "push")}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-40"
            >
              {CUSTOMER_STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <SectionState state={state} noun="مشتریان" returnTo="/admin/customers" onRetry={() => setAttempt((n) => n + 1)} />

      {ready && ready.items.length === 0 && (
        <Card>
          <StateMessage
            icon={filtered ? UserX : Users}
            title={filtered ? "مشتری‌ای با این شرایط پیدا نشد" : "هنوز مشتری‌ای ثبت‌نام نکرده است"}
            description={filtered ? "عبارت جست‌وجو یا فیلتر وضعیت را تغییر دهید." : "مشتریان با اولین ورود به فروشگاه اینجا نمایش داده می‌شوند."}
            action={
              filtered ? (
                <Button size="sm" variant="secondary" onClick={() => { setInput(""); go({ q: "", status: "all", page: 1 }, "push"); }}>
                  پاک‌کردن جست‌وجو و فیلتر
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {ready && ready.items.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-right text-sm">
              <caption className="sr-only">فهرست مشتریان</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">نام</th>
                  <th scope="col" className="px-4 py-3 font-medium">نام‌خانوادگی</th>
                  <th scope="col" className="px-4 py-3 font-medium">شماره موبایل</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت</th>
                  <th scope="col" className="px-4 py-3 font-medium">تاریخ ثبت‌نام</th>
                  <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">جزئیات</span></th>
                </tr>
              </thead>
              <tbody>
                {ready.items.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-semibold text-gray-800">{c.firstName ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-800">{c.lastName ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-700" dir="ltr"><span className="block text-right">{c.phone}</span></td>
                    <td className="px-4 py-3"><StatusBadge active={c.isActive} /></td>
                    <td className="px-4 py-3 text-gray-500">{formatJalaliDate(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${c.id}`}
                        aria-label={`جزئیات ${customerName(c)}`}
                        className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                      >
                        جزئیات
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {ready && ready.pagination.total > 0 && (
        <nav aria-label="صفحه‌بندی مشتریان" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500" aria-live="polite">
            صفحه {ready.pagination.page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")} — {ready.pagination.total.toLocaleString("fa-IR")} مشتری
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
