"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Package, Pencil, Plus, Power, Search } from "lucide-react";
import { PRODUCT_UNIT_LABELS } from "@fruitland/shared";
import { Button, Card, StateMessage } from "@/components/ui";
import { ApiClientError } from "@/lib/client/apiClient";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchCategories } from "@/lib/client/adminCategories";
import { createProduct, fetchProducts, setProductActive, updateProduct, type PageInfo, type ProductDto } from "@/lib/client/adminProducts";
import { formatToman } from "@/lib/client/format";
import { InlineError, InlineSuccess } from "../settings/fields";
import { SectionState, StatusBadge, useSectionLoad, type LoadState } from "../site-content/useSectionLoad";
import { ProductForm } from "./ProductForm";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

type StatusFilter = "all" | "active" | "inactive";
type OrganicFilter = "all" | "yes" | "no";
const STATUS_LABELS: Record<StatusFilter, string> = { all: "همه‌ی وضعیت‌ها", active: "فعال", inactive: "غیرفعال" };
const ORGANIC_LABELS: Record<OrganicFilter, string> = { all: "همه (ارگانیک و غیرارگانیک)", yes: "ارگانیک", no: "غیرارگانیک" };

type ListData = { items: ProductDto[]; pagination: PageInfo };
type Editor = { mode: "create" } | { mode: "edit"; product: ProductDto } | null;

/** Reads the list parameters from the URL; anything invalid falls back to its default. */
function readParams(sp: URLSearchParams) {
  const pageRaw = Number(sp.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const statusRaw = sp.get("status") ?? "";
  const status: StatusFilter = statusRaw === "active" || statusRaw === "inactive" ? statusRaw : "all";
  const organicRaw = sp.get("organic") ?? "";
  const organic: OrganicFilter = organicRaw === "yes" || organicRaw === "no" ? organicRaw : "all";
  const categoryRaw = sp.get("categoryId") ?? "";
  const categoryId = /^[a-f0-9]{24}$/i.test(categoryRaw) ? categoryRaw : "";
  return { page, status, organic, categoryId, q: (sp.get("q") ?? "").trim() };
}

const selectClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-48";

/**
 * /admin/products — the list state (q, categoryId, status, organic, page) lives in the URL so it survives reload and browser
 * back/forward. Search typing is debounced and uses `replace`; every filter/page change uses `push`; changing search or any
 * filter resets to page 1. There is no delete: a product is only activated/deactivated, and a variant is only made unavailable.
 */
export function ProductsManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { page, status, organic, categoryId, q } = readParams(new URLSearchParams(searchParams.toString()));

  const categories = useSectionLoad(fetchCategories);
  const [input, setInput] = useState(q);
  const [attempt, setAttempt] = useState(0);
  // The result is tagged with the request key it belongs to; another key reads as "loading" (derived, no setState in the effect body).
  const requestKey = `${page}|${status}|${organic}|${categoryId}|${q}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState<ListData> } | null>(null);
  const state: LoadState<ListData> = result && result.key === requestKey ? result.state : { status: "loading" };
  const lastPushedQ = useRef(q);

  const [editor, setEditor] = useState<Editor>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (next: { page?: number; status?: StatusFilter; organic?: OrganicFilter; categoryId?: string; q?: string }, mode: "push" | "replace") => {
    const merged = { page, status, organic, categoryId, q, ...next };
    const qs = new URLSearchParams();
    if (merged.q) qs.set("q", merged.q);
    if (merged.categoryId) qs.set("categoryId", merged.categoryId);
    if (merged.status !== "all") qs.set("status", merged.status);
    if (merged.organic !== "all") qs.set("organic", merged.organic);
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
    fetchProducts({
      page,
      limit: PAGE_SIZE,
      search: q || undefined,
      categoryId: categoryId || undefined,
      isActive: status === "all" ? undefined : status === "active",
      isOrganic: organic === "all" ? undefined : organic === "yes",
    })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is derived from the URL values in requestKey
  }, [requestKey]);

  const replaceItem = (saved: ProductDto) =>
    setResult((r) =>
      r && r.state.status === "ready"
        ? { key: r.key, state: { status: "ready", data: { ...r.state.data, items: r.state.data.items.map((p) => (p.id === saved.id ? saved : p)) } } }
        : r,
    );

  const handleCreate = async (body: Parameters<typeof createProduct>[0]) => {
    await createProduct(body);
    setEditor(null);
    setNotice("محصول ایجاد شد");
    setInput("");
    lastPushedQ.current = "";
    go({ q: "", categoryId: "", status: "all", organic: "all", page: 1 }, "push");
    setAttempt((n) => n + 1); // refetch even when the URL does not change
  };

  const handleUpdate = async (id: string, body: Parameters<typeof updateProduct>[1]) => {
    replaceItem(await updateProduct(id, body));
    setEditor(null);
    setNotice("محصول ذخیره شد");
  };

  const toggle = async (p: ProductDto) => {
    setActionError(null);
    setNotice(null);
    setBusyId(p.id);
    try {
      replaceItem(await setProductActive(p.id, !p.isActive));
      setNotice(p.isActive ? "محصول غیرفعال شد" : "محصول فعال شد");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const openEditor = (next: Exclude<Editor, null>) => {
    setNotice(null);
    setActionError(null);
    setEditor(next);
  };

  const ready = state.status === "ready" ? state.data : null;
  const totalPages = ready ? Math.max(1, Math.ceil(ready.pagination.total / ready.pagination.pageSize)) : 1;
  const filtered = Boolean(q) || status !== "all" || organic !== "all" || categoryId !== "";
  const categoryOptions = categories.state.status === "ready" ? categories.state.data : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">محصولات</h2>
          <p className="text-sm text-gray-400">حذف وجود ندارد؛ محصول غیرفعال می‌شود و هر واحد فروش «ناموجود» می‌شود</p>
        </div>
        {!editor && (
          <Button size="sm" onClick={() => openEditor({ mode: "create" })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            محصول جدید
          </Button>
        )}
      </div>

      {editor &&
        (categories.state.status === "ready" ? (
          editor.mode === "create" ? (
            <ProductForm mode="create" categories={categories.state.data} onSubmit={handleCreate} onCancel={() => setEditor(null)} />
          ) : (
            <ProductForm
              key={editor.product.id}
              mode="edit"
              product={editor.product}
              categories={categories.state.data}
              onSubmit={(body) => handleUpdate(editor.product.id, body)}
              onCancel={() => setEditor(null)}
            />
          )
        ) : (
          <SectionState state={categories.state} noun="دسته‌بندی‌ها" returnTo="/admin/products" onRetry={categories.reload} />
        ))}

      <InlineSuccess message={notice} />
      <InlineError message={actionError} />

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <div className="flex-1">
            <label htmlFor="product-search" className="mb-1 block text-xs font-medium text-gray-500">
              جست‌وجوی محصول
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
              <input
                id="product-search"
                type="search"
                value={input}
                maxLength={100}
                onChange={(e) => setInput(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-3 pr-9 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
          <div>
            <label htmlFor="product-category-filter" className="mb-1 block text-xs font-medium text-gray-500">
              دسته‌بندی
            </label>
            <select id="product-category-filter" value={categoryId} onChange={(e) => go({ categoryId: e.target.value, page: 1 }, "push")} className={selectClass}>
              <option value="">همه‌ی دسته‌بندی‌ها</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.isActive ? c.name : `${c.name} (غیرفعال)`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="product-status-filter" className="mb-1 block text-xs font-medium text-gray-500">
              وضعیت
            </label>
            <select id="product-status-filter" value={status} onChange={(e) => go({ status: e.target.value as StatusFilter, page: 1 }, "push")} className={selectClass}>
              {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="product-organic-filter" className="mb-1 block text-xs font-medium text-gray-500">
              ارگانیک
            </label>
            <select id="product-organic-filter" value={organic} onChange={(e) => go({ organic: e.target.value as OrganicFilter, page: 1 }, "push")} className={selectClass}>
              {(Object.keys(ORGANIC_LABELS) as OrganicFilter[]).map((o) => (
                <option key={o} value={o}>
                  {ORGANIC_LABELS[o]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <SectionState state={state} noun="محصولات" returnTo="/admin/products" onRetry={() => setAttempt((n) => n + 1)} />

      {ready && ready.items.length === 0 && (
        <Card>
          <StateMessage
            icon={Package}
            title={filtered ? "محصولی با این شرایط پیدا نشد" : "هنوز محصولی ساخته نشده است"}
            description={filtered ? "عبارت جست‌وجو یا فیلترها را تغییر دهید." : "اولین محصول را بسازید."}
            action={
              filtered ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setInput("");
                    go({ q: "", categoryId: "", status: "all", organic: "all", page: 1 }, "push");
                  }}
                >
                  پاک‌کردن جست‌وجو و فیلترها
                </Button>
              ) : (
                !editor && (
                  <Button size="sm" onClick={() => openEditor({ mode: "create" })}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    محصول جدید
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
              <caption className="sr-only">فهرست محصولات</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">محصول</th>
                  <th scope="col" className="px-4 py-3 font-medium">دسته‌بندی</th>
                  <th scope="col" className="px-4 py-3 font-medium">واحدها و قیمت</th>
                  <th scope="col" className="px-4 py-3 font-medium">ارگانیک</th>
                  <th scope="col" className="px-4 py-3 font-medium">ترتیب</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت</th>
                  <th scope="col" className="px-4 py-3 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {ready.items.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-800">{p.name}</p>
                      <p className="text-[11px] text-gray-400">{p.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {p.category ? (
                        <>
                          {p.category.name}
                          {!p.category.isActive && <span className="me-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">دسته‌ی غیرفعال</span>}
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1">
                        {p.variants.map((v) => (
                          <li key={v.id} className={v.isAvailable ? "text-gray-700" : "text-gray-400 line-through"}>
                            {PRODUCT_UNIT_LABELS[v.unit]}: {formatToman(v.price)}
                            {!v.isAvailable && <span className="me-1 text-[10px] font-bold no-underline">(ناموجود)</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{p.isOrganic ? "بله" : "خیر"}</td>
                    <td className="px-4 py-3 text-gray-700">{p.sortOrder.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-3">
                      <StatusBadge active={p.isActive} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="xs" variant="secondary" aria-label={`ویرایش ${p.name}`} onClick={() => openEditor({ mode: "edit", product: p })}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ویرایش
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          aria-label={`${p.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"} ${p.name}`}
                          isLoading={busyId === p.id}
                          disabled={busyId !== null}
                          onClick={() => void toggle(p)}
                        >
                          {busyId !== p.id && <Power className="h-3.5 w-3.5" aria-hidden="true" />}
                          {p.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
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
        <nav aria-label="صفحه‌بندی محصولات" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500" aria-live="polite">
            صفحه {ready.pagination.page.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")} — {ready.pagination.total.toLocaleString("fa-IR")} محصول
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
