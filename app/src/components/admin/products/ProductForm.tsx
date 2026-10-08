"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  PRODUCT_UNITS,
  PRODUCT_UNIT_LABELS,
  createProductSchema,
  normalizePersianText,
  updateProductSchema,
  type CategoryDto,
  type CreateProductRequest,
  type ProductDto,
  type ProductUnit,
  type UpdateProductRequest,
} from "@fruitland/shared";
import { Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { formatNumberInput, parseTomanInput, toEnglishDigits } from "@/lib/client/format";
import { Field, InlineError, TextAreaField } from "../settings/fields";
import { FormActions } from "../settings/FormActions";

type Props =
  | { mode: "create"; categories: CategoryDto[]; onSubmit: (input: CreateProductRequest) => Promise<void>; onCancel: () => void }
  | { mode: "edit"; product: ProductDto; categories: CategoryDto[]; onSubmit: (input: UpdateProductRequest) => Promise<void>; onCancel: () => void };

interface VariantRow {
  /** Local React key only. */
  key: number;
  /** Present for a variant that already exists on the server — its identity must be sent back unchanged. */
  id?: string;
  unit: ProductUnit | "";
  price: string;
  isAvailable: boolean;
}

/** sortOrder is a small count, not money: digits only (Persian digits accepted). */
const digitsOnly = (value: string) => toEnglishDigits(value).replace(/\D/g, "");

const selectClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

const byOrder = (a: CategoryDto, b: CategoryDto) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "fa") || a.id.localeCompare(b.id);

let nextKey = 1;
const newKey = () => nextKey++;

const rowsOf = (p: ProductDto | null): VariantRow[] =>
  p
    ? p.variants.map((v) => ({ key: newKey(), id: v.id, unit: v.unit, price: formatNumberInput(String(v.price)), isAvailable: v.isAvailable }))
    : [{ key: newKey(), unit: "kg", price: "", isAvailable: true }];

/**
 * One form for create and edit. Validation reuses the shared Zod schemas the API uses (UX only — the server stays authoritative).
 * Slug is not a field (the server generates it); there is no image input, no stock, no original price and no delete.
 * Existing variants keep their id and can only be disabled (never removed); only variants added in this form can be dropped.
 * Only ACTIVE categories can be picked; in edit mode the product's current category stays selectable as "unchanged" even if inactive.
 */
export function ProductForm(props: Props) {
  const initial = props.mode === "edit" ? props.product : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category?.id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isOrganic, setIsOrganic] = useState(initial?.isOrganic ?? false);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(initial ? String(initial.sortOrder) : "0");
  const [rows, setRows] = useState<VariantRow[]>(() => rowsOf(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentCategory = initial?.category ?? null;
  const options = [...props.categories].filter((c) => c.isActive).sort(byOrder);
  const currentIsMissingFromOptions = currentCategory !== null && !options.some((c) => c.id === currentCategory.id);

  const usedUnits = new Set(rows.map((r) => r.unit).filter(Boolean));
  const nextUnit = PRODUCT_UNITS.find((u) => !usedUnits.has(u));

  const updateRow = (key: number, patch: Partial<VariantRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const toVariantInput = (r: VariantRow) => ({
    ...(r.id ? { id: r.id } : {}),
    unit: r.unit === "" ? undefined : r.unit,
    price: parseTomanInput(r.price) ?? undefined,
    isAvailable: r.isAvailable,
  });

  const submit = async () => {
    setError(null);
    if (!categoryId) return setError("دسته‌بندی را انتخاب کنید");
    const sortOrderValue = sortOrder === "" ? undefined : Number(sortOrder);
    try {
      if (props.mode === "create") {
        const parsed = createProductSchema.safeParse({
          name,
          categoryId,
          description: description.trim() === "" ? undefined : description,
          isOrganic,
          isActive,
          sortOrder: sortOrderValue,
          variants: rows.map(toVariantInput).map(({ unit, price, isAvailable }) => ({ unit, price, isAvailable })),
        });
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setSaving(true);
        await props.onSubmit(parsed.data);
      } else {
        const current = props.product;
        const diff: UpdateProductRequest = {};
        if (normalizePersianText(name) !== current.name) diff.name = name;
        if (categoryId !== (current.category?.id ?? "")) diff.categoryId = categoryId;
        if (description.trim() !== (current.description ?? "")) diff.description = description;
        if (isOrganic !== current.isOrganic) diff.isOrganic = isOrganic;
        if (sortOrderValue !== undefined && sortOrderValue !== current.sortOrder) diff.sortOrder = sortOrderValue;
        if (sortOrderValue === undefined) return setError("ترتیب نمایش الزامی است");
        const variantsChanged =
          rows.length !== current.variants.length ||
          rows.some((r, i) => {
            const v = current.variants[i];
            return !v || r.id !== v.id || r.unit !== v.unit || parseTomanInput(r.price) !== v.price || r.isAvailable !== v.isAvailable;
          });
        if (variantsChanged) diff.variants = rows.map(toVariantInput);
        if (Object.keys(diff).length === 0) return props.onCancel();
        const parsed = updateProductSchema.safeParse(diff);
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setSaving(true);
        await props.onSubmit(parsed.data);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const title = props.mode === "create" ? "محصول جدید" : `ویرایش «${props.product.name}»`;

  return (
    <Card>
      <form
        noValidate
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <p className="text-sm font-bold text-gray-900">{title}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="نام محصول" hint="نشانی (slug) محصول به‌صورت خودکار از نام ساخته می‌شود" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <div>
            <label htmlFor="product-category" className="mb-1 block text-xs font-medium text-gray-500">
              دسته‌بندی محصول
            </label>
            <select id="product-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
              <option value="">انتخاب دسته‌بندی</option>
              {currentIsMissingFromOptions && currentCategory && (
                <option value={currentCategory.id}>{currentCategory.name} (غیرفعال — بدون تغییر)</option>
              )}
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">فقط دسته‌بندی‌های فعال قابل انتخاب‌اند.</p>
          </div>
        </div>

        <TextAreaField label="توضیحات (اختیاری)" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="ترتیب نمایش" hint="عدد صحیح، ۰ یا بیشتر" dir="ltr" inputMode="numeric" value={sortOrder} maxLength={9} onChange={(e) => setSortOrder(digitsOnly(e.target.value))} />
          <label className="flex cursor-pointer items-center gap-2 self-center rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-600">
            <input type="checkbox" checked={isOrganic} onChange={(e) => setIsOrganic(e.target.checked)} className="accent-emerald-500" />
            محصول ارگانیک
          </label>
          {props.mode === "create" && (
            <label className="flex cursor-pointer items-center gap-2 self-center rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-600">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-emerald-500" />
              فعال
            </label>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-gray-500">واحدهای فروش و قیمت (تومان)</legend>
          {rows.map((r, index) => (
            <div key={r.key} className="grid grid-cols-1 items-end gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
              <div>
                <label htmlFor={`variant-unit-${r.key}`} className="mb-1 block text-xs font-medium text-gray-500">
                  واحد {(index + 1).toLocaleString("fa-IR")}
                </label>
                <select id={`variant-unit-${r.key}`} value={r.unit} onChange={(e) => updateRow(r.key, { unit: e.target.value as ProductUnit | "" })} className={selectClass}>
                  <option value="">انتخاب واحد</option>
                  {PRODUCT_UNITS.map((u) => (
                    <option key={u} value={u} disabled={u !== r.unit && usedUnits.has(u)}>
                      {PRODUCT_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                label={`قیمت واحد ${(index + 1).toLocaleString("fa-IR")} (تومان)`}
                dir="ltr"
                inputMode="numeric"
                value={r.price}
                onChange={(e) => updateRow(r.key, { price: formatNumberInput(e.target.value) })}
              />
              <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs font-semibold text-gray-600">
                <input
                  type="checkbox"
                  aria-label={`موجود بودن واحد ${(index + 1).toLocaleString("fa-IR")}`}
                  checked={r.isAvailable}
                  onChange={(e) => updateRow(r.key, { isAvailable: e.target.checked })}
                  className="accent-emerald-500"
                />
                موجود
              </label>
              {/* An existing variant can only be disabled, never removed; only rows added in this form can be dropped. */}
              {!r.id && rows.length > 1 ? (
                <Button type="button" size="xs" variant="secondary" aria-label={`حذف ردیف واحد ${(index + 1).toLocaleString("fa-IR")}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={nextUnit === undefined}
            onClick={() => nextUnit && setRows((rs) => [...rs, { key: newKey(), unit: nextUnit, price: "", isAvailable: true }])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            افزودن واحد فروش
          </Button>
          <p className="text-[11px] text-gray-400">هر واحد فقط یک‌بار قابل ثبت است. واحد ثبت‌شده حذف نمی‌شود؛ برای کنار گذاشتن آن، «موجود» را بردارید.</p>
        </fieldset>

        <InlineError message={error} />
        <FormActions saving={saving} onCancel={props.onCancel} saveLabel={props.mode === "create" ? "ایجاد" : "ذخیره"} />
      </form>
    </Card>
  );
}
