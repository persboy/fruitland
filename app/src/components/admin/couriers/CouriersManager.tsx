"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bike, ChevronLeft, ChevronRight, Pencil, Plus, Power, Search, UserX } from "lucide-react";
import { COURIER_STATUS_FILTERS, type CourierDto, type CourierStatusFilter } from "@fruitland/shared";
import { Button, Card, StateMessage } from "@/components/ui";
import { ApiClientError } from "@/lib/client/apiClient";
import { errorMessage } from "@/lib/client/adminAuth";
import { createCourier, fetchCouriers, setCourierActive, updateCourier, type PageInfo } from "@/lib/client/adminCouriers";
import { formatJalaliDate } from "@/lib/client/format";
import { InlineError, InlineSuccess } from "../settings/fields";
import { SectionState, StatusBadge, type LoadState } from "../site-content/useSectionLoad";
import { CourierForm } from "./CourierForm";
import { AVAILABILITY_LABELS, VEHICLE_LABELS, courierName } from "./labels";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const STATUS_LABELS: Record<CourierStatusFilter, string> = { all: "همه", active: "فعال", inactive: "غیرفعال" };
const ACTIVE_RUN_MESSAGE = "این پیک یک ماموریت فعال دارد؛ تا پایان یا لغو آن نمی‌توان حسابش را غیرفعال کرد.";

type ListData = { items: CourierDto[]; pagination: PageInfo };
type Editor = { mode: "create" } | { mode: "edit"; courier: CourierDto } | null;

/** Reads the three list parameters from the URL; anything invalid falls back to its default. */
function readParams(sp: URLSearchParams) {
  const pageRaw = Number(sp.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const statusRaw = sp.get("status");
  const status = (COURIER_STATUS_FILTERS as readonly string[]).includes(statusRaw ?? "") ? (statusRaw as CourierStatusFilter) : "all";
  return { page, status, q: (sp.get("q") ?? "").trim() };
}

const selectClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-40";

/**
 * /admin/couriers — the list state (q, status, page) lives in the URL so it survives reload and browser
 * back/forward (same behaviour as Customers). Couriers are only made by promoting an existing customer;
 * there is no delete and no downgrade — an account is only activated/deactivated. The courier's location
 * is never requested or shown.
 */
export function CouriersManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { page, status, q } = readParams(new URLSearchParams(searchParams.toString()));

  const [input, setInput] = useState(q);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${page}|${status}|${q}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState<ListData> } | null>(null);
  const state: LoadState<ListData> = result && result.key === requestKey ? result.state : { status: "loading" };
  const lastPushedQ = useRef(q);

  const [editor, setEditor] = useState<Editor>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (next: { page?: number; status?: CourierStatusFilter; q?: string }, mode: "push" | "replace") => {
    const merged = { page, status, q, ...next };
    const qs = new URLSearchParams();
    if (merged.q) qs.set("q", merged.q);
    if (merged.status !== "all") qs.set("status", merged.status);
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
    fetchCouriers({ page, limit: PAGE_SIZE, search: q || undefined, status })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is derived from page/status/q
  }, [requestKey]);

  const replaceItem = (saved: CourierDto) =>
    setResult((r) =>
      r && r.state.status === "ready"
        ? { key: r.key, state: { status: "ready", data: { ...r.state.data, items: r.state.data.items.map((c) => (c.id === saved.id ? saved : c)) } } }
        : r,
    );

  const handleCreate = async (body: Parameters<typeof createCourier>[0]) => {
    await createCourier(body);
    setEditor(null);
    setNotice("مشتری به پیک تبدیل شد");
    // The list is newest-account-first and a promoted customer may be old: show page 1 without filters and refetch even if the URL is unchanged.
    setInput("");
    lastPushedQ.current = "";
    go({ q: "", status: "all", page: 1 }, "push");
    setAttempt((n) => n + 1);
  };

  const handleUpdate = async (id: string, body: Parameters<typeof updateCourier>[1]) => {
    replaceItem(await updateCourier(id, body));
    setEditor(null);
    setNotice("اطلاعات پیک ذخیره شد");
  };

  const toggle = async (c: CourierDto) => {
    if (busyId !== null) return;
    setActionError(null);
    setNotice(null);
    setBusyId(c.id);
    try {
      replaceItem(await setCourierActive(c.id, !c.isActive));
      setNotice(c.isActive ? "حساب پیک غیرفعال شد" : "حساب پیک فعال شد");
    } catch (err) {
      setActionError(err instanceof ApiClientError && err.status === 409 && err.code === "COURIER_HAS_ACTIVE_RUN" ? ACTIVE_RUN_MESSAGE : errorMessage(err));
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
  const filtered = Boolean(q) || status !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">پیک‌ها</h2>
          <p className="text-sm text-gray-400">پیک از میان مشتریان موجود انتخاب می‌شود؛ حذف و بازگشت به مشتری وجود ندارد، فقط غیرفعال‌سازی</p>
        </div>
        {!editor && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            تبدیل مشتری به پیک
          </Button>
        )}
      </div>

      {editor?.mode === "create" && <CourierForm mode="create" onSubmit={handleCreate} onCancel={() => setEditor(null)} />}
      {editor?.mode === "edit" && (
        <CourierForm key={editor.courier.id} mode="edit" courier={editor.courier} onSubmit={(body) => handleUpdate(editor.courier.id, body)} onCancel={() => setEditor(null)} />
      )}

      <InlineSuccess message={notice} />
      <InlineError message={actionError} />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="courier-search" className="mb-1 block text-xs font-medium text-gray-500">
              جست‌وجو (نام، نام‌خانوادگی یا شماره موبایل)
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
              <input
                id="courier-search"
                type="search"
                value={input}
                maxLength={50}
                onChange={(e) => setInput(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-3 pr-9 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
          <div>
            <label htmlFor="courier-status" className="mb-1 block text-xs font-medium text-gray-500">
              وضعیت حساب
            </label>
            <select id="courier-status" value={status} onChange={(e) => go({ status: e.target.value as CourierStatusFilter, page: 1 }, "push")} className={selectClass}>
              {COURIER_STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <SectionState state={state} noun="پیک‌ها" returnTo="/admin/couriers" onRetry={() => setAttempt((n) => n + 1)} />

      {ready && ready.items.length === 0 && (
        <Card>
          <StateMessage
            icon={filtered ? UserX : Bike}
            title={filtered ? "پیکی با این شرایط پیدا نشد" : "هنوز پیکی ثبت نشده است"}
            description={filtered ? "عبارت جست‌وجو یا فیلتر وضعیت را تغییر دهید." : "اولین پیک را از میان مشتریان موجود انتخاب کنید."}
            action={
              filtered ? (
                <Button size="sm" variant="secondary" onClick={() => { setInput(""); go({ q: "", status: "all", page: 1 }, "push"); }}>
                  پاک‌کردن جست‌وجو و فیلتر
                </Button>
              ) : (
                !editor && (
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    تبدیل مشتری به پیک
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
              <caption className="sr-only">فهرست پیک‌ها</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">نام</th>
                  <th scope="col" className="px-4 py-3 font-medium">شماره موبایل</th>
                  <th scope="col" className="px-4 py-3 font-medium">وسیله</th>
                  <th scope="col" className="px-4 py-3 font-medium">پلاک</th>
                  <th scope="col" className="px-4 py-3 font-medium">حساب</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت حضور</th>
                  <th scope="col" className="px-4 py-3 font-medium">تاریخ ثبت‌نام</th>
                  <th scope="col" className="px-4 py-3 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {ready.items.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-semibold text-gray-800">{courierName(c)}</td>
                    <td className="px-4 py-3 text-gray-700" dir="ltr"><span className="block text-right">{c.phone}</span></td>
                    <td className="px-4 py-3 text-gray-700">{c.vehicleType ? VEHICLE_LABELS[c.vehicleType] : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-700">{c.plateNumber ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3"><StatusBadge active={c.isActive} /></td>
                    <td className="px-4 py-3 text-gray-500">{AVAILABILITY_LABELS[c.availabilityStatus]}</td>
                    <td className="px-4 py-3 text-gray-500">{formatJalaliDate(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          aria-label={`ویرایش ${courierName(c)}`}
                          onClick={() => {
                            setNotice(null);
                            setActionError(null);
                            setEditor({ mode: "edit", courier: c });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ویرایش
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          aria-label={`${c.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"} ${courierName(c)}`}
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {ready && ready.pagination.total > 0 && (
        <nav aria-label="صفحه‌بندی پیک‌ها" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500" aria-live="polite">
            صفحه {ready.pagination.page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")} — {ready.pagination.total.toLocaleString("fa-IR")} پیک
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
