"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus, Power, Search, TicketPercent } from "lucide-react";
import {
  DISCOUNT_CODE_STATUS_FILTERS,
  DISCOUNT_CODE_TYPE_FILTERS,
  type DiscountCodeStatus,
  type DiscountCodeStatusFilter,
  type DiscountCodeTypeFilter,
} from "@fruitland/shared";
import { Button, Card, StateMessage } from "@/components/ui";
import { ApiClientError } from "@/lib/client/apiClient";
import { errorMessage } from "@/lib/client/adminAuth";
import { cn } from "@/lib/cn";
import {
  createDiscountCode,
  fetchDiscountCodes,
  setDiscountCodeActive,
  updateDiscountCode,
  type DiscountCodeDto,
  type PageInfo,
} from "@/lib/client/adminDiscountCodes";
import { formatJalaliDate } from "@/lib/client/format";
import { InlineError, InlineSuccess } from "../settings/fields";
import { SectionState, type LoadState } from "../site-content/useSectionLoad";
import { DiscountCodeForm, TYPE_LABELS, ownerLabel } from "./DiscountCodeForm";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const TYPE_FILTER_LABELS: Record<DiscountCodeTypeFilter, string> = { all: "همه‌ی انواع", public: "عمومی", personal: "شخصی" };
const STATUS_FILTER_LABELS: Record<DiscountCodeStatusFilter, string> = {
  all: "همه‌ی وضعیت‌ها",
  active: "فعال",
  disabled: "غیرفعال",
  exhausted: "تمام‌شده",
  expired: "منقضی‌شده",
};
const STATUS_BADGE: Record<DiscountCodeStatus, { label: string; className: string }> = {
  active: { label: "فعال", className: "bg-emerald-50 text-emerald-600" },
  disabled: { label: "غیرفعال", className: "bg-gray-100 text-gray-500" },
  exhausted: { label: "تمام‌شده", className: "bg-amber-50 text-amber-600" },
  expired: { label: "منقضی‌شده", className: "bg-red-50 text-red-500" },
};

type ListData = { items: DiscountCodeDto[]; pagination: PageInfo };
type Editor = { mode: "create" } | { mode: "edit"; discountCode: DiscountCodeDto } | null;

/** Reads the four list parameters from the URL; anything invalid falls back to its default. */
function readParams(sp: URLSearchParams) {
  const pageRaw = Number(sp.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const typeRaw = sp.get("type") ?? "";
  const type = (DISCOUNT_CODE_TYPE_FILTERS as readonly string[]).includes(typeRaw) ? (typeRaw as DiscountCodeTypeFilter) : "all";
  const statusRaw = sp.get("status") ?? "";
  const status = (DISCOUNT_CODE_STATUS_FILTERS as readonly string[]).includes(statusRaw) ? (statusRaw as DiscountCodeStatusFilter) : "all";
  return { page, type, status, q: (sp.get("q") ?? "").trim() };
}

const selectClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-44";

/**
 * /admin/discounts — the list state (q, type, status, page) lives in the URL so it survives reload and
 * browser back/forward. Search typing is debounced and uses `replace`; type/status/page changes use `push`.
 * Changing search, type or status resets to page 1. There is no delete: a code is only activated/deactivated.
 */
export function DiscountCodesManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { page, type, status, q } = readParams(new URLSearchParams(searchParams.toString()));

  const [input, setInput] = useState(q);
  const [attempt, setAttempt] = useState(0);
  // The result is tagged with the request key it belongs to; another key reads as "loading" (derived, no setState in the effect body).
  const requestKey = `${page}|${type}|${status}|${q}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState<ListData> } | null>(null);
  const state: LoadState<ListData> = result && result.key === requestKey ? result.state : { status: "loading" };
  const lastPushedQ = useRef(q);

  const [editor, setEditor] = useState<Editor>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (next: { page?: number; type?: DiscountCodeTypeFilter; status?: DiscountCodeStatusFilter; q?: string }, mode: "push" | "replace") => {
    const merged = { page, type, status, q, ...next };
    const qs = new URLSearchParams();
    if (merged.q) qs.set("q", merged.q);
    if (merged.type !== "all") qs.set("type", merged.type);
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
    fetchDiscountCodes({ page, limit: PAGE_SIZE, search: q || undefined, type, status })
      .then(({ data, pagination }) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
        if (data.length === 0 && pagination.total > 0 && page > lastPage) {
          go({ page: lastPage }, "replace"); // page beyond the results
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is derived from page/type/status/q
  }, [requestKey]);

  const replaceItem = (saved: DiscountCodeDto) =>
    setResult((r) =>
      r && r.state.status === "ready"
        ? { key: r.key, state: { status: "ready", data: { ...r.state.data, items: r.state.data.items.map((c) => (c.id === saved.id ? saved : c)) } } }
        : r,
    );

  const handleCreate = async (body: Parameters<typeof createDiscountCode>[0]) => {
    await createDiscountCode(body);
    setEditor(null);
    setNotice("کد تخفیف ایجاد شد");
    // The newest code sorts first: show page 1 without filters, and refetch even when the URL does not change.
    setInput("");
    lastPushedQ.current = "";
    go({ q: "", type: "all", status: "all", page: 1 }, "push");
    setAttempt((n) => n + 1);
  };

  const handleUpdate = async (id: string, body: Parameters<typeof updateDiscountCode>[1]) => {
    replaceItem(await updateDiscountCode(id, body));
    setEditor(null);
    setNotice("کد تخفیف ذخیره شد");
  };

  const toggle = async (c: DiscountCodeDto) => {
    setActionError(null);
    setNotice(null);
    setBusyId(c.id);
    try {
      replaceItem(await setDiscountCodeActive(c.id, !c.isActive));
      setNotice(c.isActive ? "کد تخفیف غیرفعال شد" : "کد تخفیف فعال شد");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const openCreate = () => {
    setNotice(null);
    setActionError(null);
    setEditor({ mode: "create" });
  };

  const ready = state.status === "ready" ? state.data : null;
  const totalPages = ready ? Math.max(1, Math.ceil(ready.pagination.total / ready.pagination.pageSize)) : 1;
  const filtered = Boolean(q) || type !== "all" || status !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">کدهای تخفیف</h2>
          <p className="text-sm text-gray-400">حذف وجود ندارد؛ کدی که نباید استفاده شود غیرفعال می‌شود</p>
        </div>
        {!editor && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            کد تخفیف جدید
          </Button>
        )}
      </div>

      {editor?.mode === "create" && <DiscountCodeForm mode="create" onSubmit={handleCreate} onCancel={() => setEditor(null)} />}
      {editor?.mode === "edit" && (
        <DiscountCodeForm
          key={editor.discountCode.id}
          mode="edit"
          discountCode={editor.discountCode}
          onSubmit={(body) => handleUpdate(editor.discountCode.id, body)}
          onCancel={() => setEditor(null)}
        />
      )}

      <InlineSuccess message={notice} />
      <InlineError message={actionError} />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="discount-search" className="mb-1 block text-xs font-medium text-gray-500">
              جست‌وجوی کد تخفیف
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
              <input
                id="discount-search"
                type="search"
                dir="ltr"
                value={input}
                maxLength={30}
                onChange={(e) => setInput(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-3 pr-9 text-left text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
          <div>
            <label htmlFor="discount-type-filter" className="mb-1 block text-xs font-medium text-gray-500">
              نوع
            </label>
            <select id="discount-type-filter" value={type} onChange={(e) => go({ type: e.target.value as DiscountCodeTypeFilter, page: 1 }, "push")} className={selectClass}>
              {DISCOUNT_CODE_TYPE_FILTERS.map((t) => (
                <option key={t} value={t}>
                  {TYPE_FILTER_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="discount-status-filter" className="mb-1 block text-xs font-medium text-gray-500">
              وضعیت
            </label>
            <select
              id="discount-status-filter"
              value={status}
              onChange={(e) => go({ status: e.target.value as DiscountCodeStatusFilter, page: 1 }, "push")}
              className={selectClass}
            >
              {DISCOUNT_CODE_STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_FILTER_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <SectionState state={state} noun="کدهای تخفیف" returnTo="/admin/discounts" onRetry={() => setAttempt((n) => n + 1)} />

      {ready && ready.items.length === 0 && (
        <Card>
          <StateMessage
            icon={TicketPercent}
            title={filtered ? "کد تخفیفی با این شرایط پیدا نشد" : "هنوز کد تخفیفی ساخته نشده است"}
            description={filtered ? "عبارت جست‌وجو یا فیلترها را تغییر دهید." : "اولین کد تخفیف را بسازید."}
            action={
              filtered ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setInput("");
                    go({ q: "", type: "all", status: "all", page: 1 }, "push");
                  }}
                >
                  پاک‌کردن جست‌وجو و فیلترها
                </Button>
              ) : (
                !editor && (
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    کد تخفیف جدید
                  </Button>
                )
              )
            }
          />
        </Card>
      )}

      {ready && ready.items.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-right text-sm">
              <caption className="sr-only">فهرست کدهای تخفیف</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">کد</th>
                  <th scope="col" className="px-4 py-3 font-medium">نوع</th>
                  <th scope="col" className="px-4 py-3 font-medium">مشتری مالک</th>
                  <th scope="col" className="px-4 py-3 font-medium">درصد</th>
                  <th scope="col" className="px-4 py-3 font-medium">استفاده</th>
                  <th scope="col" className="px-4 py-3 font-medium">انقضا</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت</th>
                  <th scope="col" className="px-4 py-3 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {ready.items.map((c) => {
                  const badge = STATUS_BADGE[c.status];
                  return (
                    <tr key={c.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 font-bold text-gray-800" dir="ltr">
                        <span className="block text-right">{c.code}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{TYPE_LABELS[c.type]}</td>
                      <td className="px-4 py-3 text-gray-700">{c.owner ? ownerLabel(c.owner) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-700">{c.percentage.toLocaleString("fa-IR")}٪</td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.usedCount.toLocaleString("fa-IR")} از {c.usageLimit === null ? "نامحدود" : c.usageLimit.toLocaleString("fa-IR")}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{c.expiresAt ? formatJalaliDate(c.expiresAt) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", badge.className)}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="xs"
                            variant="secondary"
                            aria-label={`ویرایش ${c.code}`}
                            onClick={() => {
                              setNotice(null);
                              setActionError(null);
                              setEditor({ mode: "edit", discountCode: c });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            ویرایش
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            aria-label={`${c.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"} ${c.code}`}
                            isLoading={busyId === c.id}
                            disabled={busyId !== null}
                            onClick={() => void toggle(c)}
                          >
                            {busyId !== c.id && <Power className="h-3.5 w-3.5" aria-hidden="true" />}
                            {c.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {ready && ready.pagination.total > 0 && (
        <nav aria-label="صفحه‌بندی کدهای تخفیف" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500" aria-live="polite">
            صفحه {ready.pagination.page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")} — {ready.pagination.total.toLocaleString("fa-IR")} کد
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
