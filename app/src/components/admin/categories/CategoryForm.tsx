"use client";

import { useState } from "react";
import { createCategorySchema, updateCategorySchema, type CategoryDto, type CreateCategoryInput, type UpdateCategoryInput } from "@fruitland/shared";
import { errorMessage } from "@/lib/client/adminAuth";
import { toEnglishDigits } from "@/lib/client/format";
import { Card } from "@/components/ui";
import { Field, InlineError } from "../settings/fields";
import { FormActions } from "../settings/FormActions";

type Props =
  | { mode: "create"; onSubmit: (input: CreateCategoryInput) => Promise<void>; onCancel: () => void }
  | { mode: "edit"; category: CategoryDto; onSubmit: (input: UpdateCategoryInput) => Promise<void>; onCancel: () => void };

/** sortOrder is NOT money: digits only (Persian digits accepted), no thousands separator. */
const digitsOnly = (value: string) => toEnglishDigits(value).replace(/\D/g, "");

/**
 * One form for create and edit. Validation reuses the shared Zod schemas the
 * API uses (UX only — the server stays authoritative); server errors such as a
 * duplicate slug are shown inline and the entered values are kept.
 */
export function CategoryForm(props: Props) {
  const initial = props.mode === "edit" ? props.category : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const values = { name, slug, icon, sortOrder: sortOrder === "" ? undefined : Number(sortOrder) };
    try {
      if (props.mode === "create") {
        const parsed = createCategorySchema.safeParse({ ...values, icon: values.icon || undefined });
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setSaving(true);
        await props.onSubmit(parsed.data);
      } else {
        // Send only what changed; an unchanged form just closes.
        const diff: Record<string, unknown> = {};
        if (values.name.trim() !== props.category.name) diff.name = values.name;
        if (values.slug.trim().toLowerCase() !== props.category.slug) diff.slug = values.slug;
        if (values.icon.trim() !== (props.category.icon ?? "")) diff.icon = values.icon;
        if (values.sortOrder === undefined) return setError("ترتیب نمایش الزامی است");
        if (values.sortOrder !== props.category.sortOrder) diff.sortOrder = values.sortOrder;
        if (Object.keys(diff).length === 0) return props.onCancel();
        const parsed = updateCategorySchema.safeParse(diff);
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

  const title = props.mode === "create" ? "دسته‌بندی جدید" : `ویرایش «${props.category.name}»`;

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
          <Field label="نام" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Field
            label="شناسه (slug)"
            hint="حروف کوچک انگلیسی، عدد و خط تیره؛ مثل fresh-fruit"
            dir="ltr"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={80}
          />
          <Field label="آیکون" hint="اختیاری؛ مثلاً یک ایموجی" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={24} />
          <Field
            label="ترتیب نمایش"
            hint="عدد صحیح؛ کوچک‌تر یعنی بالاتر"
            dir="ltr"
            inputMode="numeric"
            value={sortOrder}
            onChange={(e) => setSortOrder(digitsOnly(e.target.value))}
          />
        </div>
        <InlineError message={error} />
        <FormActions saving={saving} onCancel={props.onCancel} saveLabel={props.mode === "create" ? "ایجاد" : "ذخیره"} />
      </form>
    </Card>
  );
}
