"use client";

import { useState } from "react";
import { HelpCircle, Pencil, Plus, Power } from "lucide-react";
import { createFaqSchema, updateFaqSchema, type CreateFaqInput, type FaqDto, type UpdateFaqInput } from "@fruitland/shared";
import { Button, Card, StateMessage } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { toEnglishDigits } from "@/lib/client/format";
import { createFaq, fetchFaqs, setFaqActive, updateFaq } from "@/lib/client/adminSiteContent";
import { Field, InlineError, InlineSuccess, TextAreaField } from "../settings/fields";
import { FormActions } from "../settings/FormActions";
import { SectionState, StatusBadge, useSectionLoad } from "./useSectionLoad";

/** sortOrder is NOT money: digits only (Persian digits accepted), no thousands separator. */
const digitsOnly = (value: string) => toEnglishDigits(value).replace(/\D/g, "");
const sortItems = (items: FaqDto[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

type Props =
  | { mode: "create"; onSubmit: (input: CreateFaqInput) => Promise<void>; onCancel: () => void }
  | { mode: "edit"; faq: FaqDto; onSubmit: (input: UpdateFaqInput) => Promise<void>; onCancel: () => void };

function FaqForm(props: Props) {
  const initial = props.mode === "edit" ? props.faq : null;
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const order = sortOrder === "" ? undefined : Number(sortOrder);
    try {
      if (props.mode === "create") {
        const parsed = createFaqSchema.safeParse({ question, answer, sortOrder: order });
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setSaving(true);
        await props.onSubmit(parsed.data);
      } else {
        if (order === undefined) return setError("ترتیب نمایش الزامی است");
        const diff: Record<string, unknown> = {};
        if (question.trim() !== props.faq.question) diff.question = question;
        if (answer.trim() !== props.faq.answer) diff.answer = answer;
        if (order !== props.faq.sortOrder) diff.sortOrder = order;
        if (Object.keys(diff).length === 0) return props.onCancel();
        const parsed = updateFaqSchema.safeParse(diff);
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

  const title = props.mode === "create" ? "سؤال متداول جدید" : "ویرایش سؤال متداول";
  return (
    <Card>
      <form noValidate aria-label={title} onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        <Field label="سؤال" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={400} />
        <TextAreaField label="پاسخ (متن ساده)" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <Field label="ترتیب نمایش" hint="عدد صحیح؛ کوچک‌تر یعنی بالاتر" dir="ltr" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(digitsOnly(e.target.value))} />
        <InlineError message={error} />
        <FormActions saving={saving} onCancel={props.onCancel} saveLabel={props.mode === "create" ? "ایجاد" : "ذخیره"} />
      </form>
    </Card>
  );
}

type Editor = { mode: "create" } | { mode: "edit"; faq: FaqDto } | null;

export function FaqSection() {
  const { state, reload, setData } = useSectionLoad(fetchFaqs);
  const [editor, setEditor] = useState<Editor>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upsert = (saved: FaqDto) =>
    setData((items) => sortItems(items.some((f) => f.id === saved.id) ? items.map((f) => (f.id === saved.id ? saved : f)) : [...items, saved]));
  const open = (next: Editor) => {
    setNotice(null);
    setActionError(null);
    setEditor(next);
  };

  const toggle = async (faq: FaqDto) => {
    setActionError(null);
    setNotice(null);
    setBusyId(faq.id);
    try {
      upsert(await setFaqActive(faq.id, !faq.isActive));
      setNotice(faq.isActive ? "سؤال متداول غیرفعال شد" : "سؤال متداول فعال شد");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const items = state.status === "ready" ? state.data : [];
  return (
    <section aria-labelledby="site-content-faq" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="site-content-faq" className="text-lg font-extrabold text-gray-900">سؤالات متداول</h2>
          <p className="text-sm text-gray-400">حذف وجود ندارد؛ سؤال بلااستفاده غیرفعال می‌شود</p>
        </div>
        {state.status === "ready" && !editor && (
          <Button size="sm" onClick={() => open({ mode: "create" })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            سؤال متداول جدید
          </Button>
        )}
      </div>

      {editor?.mode === "create" && (
        <FaqForm mode="create" onCancel={() => setEditor(null)} onSubmit={async (input) => { upsert(await createFaq(input)); setEditor(null); setNotice("سؤال متداول ایجاد شد"); }} />
      )}
      {editor?.mode === "edit" && (
        <FaqForm
          key={editor.faq.id}
          mode="edit"
          faq={editor.faq}
          onCancel={() => setEditor(null)}
          onSubmit={async (input) => { upsert(await updateFaq(editor.faq.id, input)); setEditor(null); setNotice("سؤال متداول ذخیره شد"); }}
        />
      )}

      <InlineSuccess message={notice} />
      <InlineError message={actionError} />
      <SectionState state={state} noun="سؤالات متداول" onRetry={reload} />

      {state.status === "ready" && items.length === 0 && (
        <Card>
          <StateMessage
            icon={HelpCircle}
            title="هنوز سؤال متداولی ثبت نشده است"
            description="اولین سؤال را بسازید تا بعداً در فروشگاه نمایش داده شود."
            action={!editor && (<Button size="sm" onClick={() => open({ mode: "create" })}><Plus className="h-4 w-4" aria-hidden="true" />سؤال متداول جدید</Button>)}
          />
        </Card>
      )}

      {state.status === "ready" && items.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-right text-sm">
              <caption className="sr-only">فهرست سؤالات متداول</caption>
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th scope="col" className="px-4 py-3 font-medium">سؤال</th>
                  <th scope="col" className="px-4 py-3 font-medium">ترتیب</th>
                  <th scope="col" className="px-4 py-3 font-medium">وضعیت</th>
                  <th scope="col" className="px-4 py-3 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-semibold text-gray-800">{f.question}</td>
                    <td className="px-4 py-3 text-gray-700">{f.sortOrder.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-3"><StatusBadge active={f.isActive} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="xs" variant="secondary" aria-label={`ویرایش ${f.question}`} onClick={() => open({ mode: "edit", faq: f })}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ویرایش
                        </Button>
                        <Button size="xs" variant="secondary" aria-label={`${f.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"} ${f.question}`} isLoading={busyId === f.id} disabled={busyId !== null} onClick={() => void toggle(f)}>
                          {busyId !== f.id && <Power className="h-3.5 w-3.5" aria-hidden="true" />}
                          {f.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
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
