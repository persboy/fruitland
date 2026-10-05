"use client";

import { useState } from "react";
import { GalleryHorizontal, Pencil, Plus, Power } from "lucide-react";
import { HTTP_URL_PATTERN, createSlideSchema, updateSlideSchema, type CreateSlideInput, type SlideDto, type UpdateSlideInput } from "@fruitland/shared";
import { Button, Card, StateMessage } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { toEnglishDigits } from "@/lib/client/format";
import { createSlide, fetchSlides, setSlideActive, updateSlide } from "@/lib/client/adminSiteContent";
import { Field, InlineError, InlineSuccess } from "../settings/fields";
import { FormActions } from "../settings/FormActions";
import { SlideThumb } from "./SlideThumb";
import { SectionState, StatusBadge, useSectionLoad } from "./useSectionLoad";

const digitsOnly = (value: string) => toEnglishDigits(value).replace(/\D/g, "");
const sortItems = (items: SlideDto[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

type Props =
  | { mode: "create"; onSubmit: (input: CreateSlideInput) => Promise<void>; onCancel: () => void }
  | { mode: "edit"; slide: SlideDto; onSubmit: (input: UpdateSlideInput) => Promise<void>; onCancel: () => void };

function SlideForm(props: Props) {
  const initial = props.mode === "edit" ? props.slide : null;
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewable = HTTP_URL_PATTERN.test(imageUrl.trim());

  const submit = async () => {
    setError(null);
    const order = sortOrder === "" ? undefined : Number(sortOrder);
    try {
      if (props.mode === "create") {
        const parsed = createSlideSchema.safeParse({ imageUrl, title, linkUrl, sortOrder: order });
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setSaving(true);
        await props.onSubmit(parsed.data);
      } else {
        if (order === undefined) return setError("ترتیب نمایش الزامی است");
        const diff: Record<string, unknown> = {};
        if (imageUrl.trim() !== props.slide.imageUrl) diff.imageUrl = imageUrl;
        if (title.trim() !== (props.slide.title ?? "")) diff.title = title;
        if (linkUrl.trim() !== (props.slide.linkUrl ?? "")) diff.linkUrl = linkUrl;
        if (order !== props.slide.sortOrder) diff.sortOrder = order;
        if (Object.keys(diff).length === 0) return props.onCancel();
        const parsed = updateSlideSchema.safeParse(diff);
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

  const heading = props.mode === "create" ? "اسلاید جدید" : "ویرایش اسلاید";
  return (
    <Card>
      <form noValidate aria-label={heading} onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
        <p className="text-sm font-bold text-gray-900">{heading}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="آدرس تصویر (URL)" hint="فقط آدرس http:// یا https://؛ آپلود فایل وجود ندارد" dir="ltr" inputMode="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} maxLength={2100} />
          <Field label="عنوان اسلاید" hint="اختیاری" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <Field label="لینک مقصد" hint="اختیاری؛ آدرس کامل http:// یا https://" dir="ltr" inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} maxLength={400} />
          <Field label="ترتیب نمایش" hint="عدد صحیح؛ کوچک‌تر یعنی بالاتر" dir="ltr" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(digitsOnly(e.target.value))} />
        </div>
        {previewable && <SlideThumb key={imageUrl.trim()} src={imageUrl.trim()} className="h-24 w-40" />}
        <InlineError message={error} />
        <FormActions saving={saving} onCancel={props.onCancel} saveLabel={props.mode === "create" ? "ایجاد" : "ذخیره"} />
      </form>
    </Card>
  );
}

type Editor = { mode: "create" } | { mode: "edit"; slide: SlideDto } | null;

export function SlidesSection() {
  const { state, reload, setData } = useSectionLoad(fetchSlides);
  const [editor, setEditor] = useState<Editor>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upsert = (saved: SlideDto) =>
    setData((items) => sortItems(items.some((s) => s.id === saved.id) ? items.map((s) => (s.id === saved.id ? saved : s)) : [...items, saved]));
  const open = (next: Editor) => {
    setNotice(null);
    setActionError(null);
    setEditor(next);
  };

  const toggle = async (slide: SlideDto) => {
    setActionError(null);
    setNotice(null);
    setBusyId(slide.id);
    try {
      upsert(await setSlideActive(slide.id, !slide.isActive));
      setNotice(slide.isActive ? "اسلاید غیرفعال شد" : "اسلاید فعال شد");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const items = state.status === "ready" ? state.data : [];
  const nameOf = (s: SlideDto) => s.title ?? `اسلاید ${s.sortOrder.toLocaleString("fa-IR")}`;
  return (
    <section aria-labelledby="site-content-slides" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="site-content-slides" className="text-lg font-extrabold text-gray-900">اسلایدهای صفحه‌ی اصلی</h2>
          <p className="text-sm text-gray-400">تصویر از یک آدرس بیرونی خوانده می‌شود؛ حذف وجود ندارد و اسلاید بلااستفاده غیرفعال می‌شود</p>
        </div>
        {state.status === "ready" && !editor && (
          <Button size="sm" onClick={() => open({ mode: "create" })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            اسلاید جدید
          </Button>
        )}
      </div>

      {editor?.mode === "create" && (
        <SlideForm mode="create" onCancel={() => setEditor(null)} onSubmit={async (input) => { upsert(await createSlide(input)); setEditor(null); setNotice("اسلاید ایجاد شد"); }} />
      )}
      {editor?.mode === "edit" && (
        <SlideForm
          key={editor.slide.id}
          mode="edit"
          slide={editor.slide}
          onCancel={() => setEditor(null)}
          onSubmit={async (input) => { upsert(await updateSlide(editor.slide.id, input)); setEditor(null); setNotice("اسلاید ذخیره شد"); }}
        />
      )}

      <InlineSuccess message={notice} />
      <InlineError message={actionError} />
      <SectionState state={state} noun="اسلایدها" onRetry={reload} />

      {state.status === "ready" && items.length === 0 && (
        <Card>
          <StateMessage
            icon={GalleryHorizontal}
            title="هنوز اسلایدی ثبت نشده است"
            description="اولین اسلاید را با آدرس یک تصویر بسازید."
            action={!editor && (<Button size="sm" onClick={() => open({ mode: "create" })}><Plus className="h-4 w-4" aria-hidden="true" />اسلاید جدید</Button>)}
          />
        </Card>
      )}

      {state.status === "ready" && items.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-right text-sm">
              <caption className="sr-only">فهرست اسلایدهای صفحه‌ی اصلی</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">تصویر</th>
                  <th scope="col" className="px-4 py-3 font-medium">عنوان</th>
                  <th scope="col" className="px-4 py-3 font-medium">لینک مقصد</th>
                  <th scope="col" className="px-4 py-3 font-medium">ترتیب</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت</th>
                  <th scope="col" className="px-4 py-3 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3"><SlideThumb key={s.imageUrl} src={s.imageUrl} /></td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{s.title ?? <span className="text-gray-300">—</span>}</td>
                    <td className="max-w-[12rem] truncate px-4 py-3 text-gray-500" dir="ltr">
                      <span className="block truncate text-right">{s.linkUrl ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{s.sortOrder.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-3"><StatusBadge active={s.isActive} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="xs" variant="secondary" aria-label={`ویرایش ${nameOf(s)}`} onClick={() => open({ mode: "edit", slide: s })}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ویرایش
                        </Button>
                        <Button size="xs" variant="secondary" aria-label={`${s.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"} ${nameOf(s)}`} isLoading={busyId === s.id} disabled={busyId !== null} onClick={() => void toggle(s)}>
                          {busyId !== s.id && <Power className="h-3.5 w-3.5" aria-hidden="true" />}
                          {s.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
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
    </section>
  );
}
