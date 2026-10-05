"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Layers, Loader2, LockKeyhole, Pencil, Plus, Power, RotateCw } from "lucide-react";
import { Button, Card, Skeleton, StateMessage } from "@/components/ui";
import { ApiClientError } from "@/lib/client/apiClient";
import { errorMessage } from "@/lib/client/adminAuth";
import { cn } from "@/lib/cn";
import {
  createCategory,
  fetchCategories,
  setCategoryActive,
  updateCategory,
  type CategoryDto,
} from "@/lib/client/adminCategories";
import { InlineError, InlineSuccess } from "../settings/fields";
import { CategoryForm } from "./CategoryForm";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; items: CategoryDto[] }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

type Editor = { mode: "create" } | { mode: "edit"; category: CategoryDto } | null;

const sortItems = (items: CategoryDto[]) =>
  [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "fa") || a.id.localeCompare(b.id));

export function CategoriesManager() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [editor, setEditor] = useState<Editor>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items: sortItems(items) });
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
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const upsert = (saved: CategoryDto) =>
    setState((s) => {
      if (s.status !== "ready") return s;
      const exists = s.items.some((c) => c.id === saved.id);
      return { status: "ready", items: sortItems(exists ? s.items.map((c) => (c.id === saved.id ? saved : c)) : [...s.items, saved]) };
    });

  const handleCreate = async (input: Parameters<typeof createCategory>[0]) => {
    upsert(await createCategory(input));
    setEditor(null);
    setNotice("دسته‌بندی ایجاد شد");
  };

  const handleUpdate = async (id: string, input: Parameters<typeof updateCategory>[1]) => {
    upsert(await updateCategory(id, input));
    setEditor(null);
    setNotice("دسته‌بندی ذخیره شد");
  };

  const toggle = async (category: CategoryDto) => {
    setActionError(null);
    setNotice(null);
    setBusyId(category.id);
    try {
      upsert(await setCategoryActive(category.id, !category.isActive));
      setNotice(category.isActive ? "دسته‌بندی غیرفعال شد" : "دسته‌بندی فعال شد");
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">دسته‌بندی‌ها</h2>
          <p className="text-sm text-gray-400">مدیریت دسته‌بندی محصولات؛ حذف وجود ندارد و دسته‌ی بلااستفاده غیرفعال می‌شود</p>
        </div>
        {state.status === "ready" && !editor && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            دسته‌بندی جدید
          </Button>
        )}
      </div>

      {editor?.mode === "create" && <CategoryForm mode="create" onSubmit={handleCreate} onCancel={() => setEditor(null)} />}
      {editor?.mode === "edit" && (
        <CategoryForm
          key={editor.category.id}
          mode="edit"
          category={editor.category}
          onSubmit={(input) => handleUpdate(editor.category.id, input)}
          onCancel={() => setEditor(null)}
        />
      )}

      <InlineSuccess message={notice} />
      <InlineError message={actionError} />

      {state.status === "loading" && (
        <Card>
          <div role="status" aria-label="در حال دریافت دسته‌بندی‌ها" className="space-y-3">
            <p className="flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              در حال دریافت اطلاعات...
            </p>
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </Card>
      )}

      {state.status === "error" && (
        <Card>
          <StateMessage
            tone="error"
            icon={AlertCircle}
            title="دریافت دسته‌بندی‌ها انجام نشد"
            description={state.message}
            action={
              <Button size="sm" variant="secondary" onClick={reload}>
                <RotateCw className="h-4 w-4" aria-hidden="true" />
                تلاش دوباره
              </Button>
            }
          />
        </Card>
      )}

      {state.status === "forbidden" && (
        <Card>
          <StateMessage tone="error" icon={LockKeyhole} title="دسترسی ندارید" description="شما اجازه‌ی مدیریت دسته‌بندی‌ها را ندارید." />
        </Card>
      )}

      {state.status === "unauthenticated" && (
        <Card>
          <StateMessage
            tone="error"
            icon={LockKeyhole}
            title="نشست شما منقضی شده است"
            description="برای ادامه دوباره وارد شوید."
            action={
              <Link
                href={`/admin/login?returnTo=${encodeURIComponent("/admin/categories")}`}
                className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600"
              >
                ورود
              </Link>
            }
          />
        </Card>
      )}

      {state.status === "ready" && state.items.length === 0 && (
        <Card>
          <StateMessage
            icon={Layers}
            title="هنوز دسته‌بندی‌ای ثبت نشده است"
            description="اولین دسته‌بندی را بسازید تا بعداً محصولات را به آن اختصاص دهید."
            action={
              !editor && (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  دسته‌بندی جدید
                </Button>
              )
            }
          />
        </Card>
      )}

      {state.status === "ready" && state.items.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-right text-sm">
              <caption className="sr-only">فهرست دسته‌بندی‌ها</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">آیکون</th>
                  <th scope="col" className="px-4 py-3 font-medium">نام</th>
                  <th scope="col" className="px-4 py-3 font-medium">شناسه (slug)</th>
                  <th scope="col" className="px-4 py-3 font-medium">ترتیب</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت</th>
                  <th scope="col" className="px-4 py-3 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 text-lg">{c.icon ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500" dir="ltr">
                      <span className="block text-right">{c.slug}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.sortOrder.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-bold",
                          c.isActive ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500",
                        )}
                      >
                        {c.isActive ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          aria-label={`ویرایش ${c.name}`}
                          onClick={() => {
                            setNotice(null);
                            setActionError(null);
                            setEditor({ mode: "edit", category: c });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ویرایش
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          aria-label={`${c.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"} ${c.name}`}
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
    </div>
  );
}
