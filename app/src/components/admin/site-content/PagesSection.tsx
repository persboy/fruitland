"use client";

import { useState } from "react";
import { updateSiteContentPageSchema, type SiteContentPageDto, type UpdateSiteContentPageInput } from "@fruitland/shared";
import { Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchSitePages, updateSitePage } from "@/lib/client/adminSiteContent";
import { Field, InlineError, InlineSuccess, TextAreaField } from "../settings/fields";
import { SectionState, StatusBadge, useSectionLoad } from "./useSectionLoad";

/** One fixed page = one form. There is no slug input and no way to add a page. Plain text only. */
function PageCard({ page, onSaved }: { page: SiteContentPageDto; onSaved: (p: SiteContentPageDto) => void }) {
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [isPublished, setIsPublished] = useState(page.exists ? page.isPublished : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    let input: UpdateSiteContentPageInput;
    if (!page.exists) {
      // The first save creates the page: title and body are both required.
      if (!title.trim()) return setError("عنوان صفحه الزامی است");
      if (!body.trim()) return setError("متن صفحه الزامی است");
      input = { title, body, isPublished };
    } else {
      const diff: UpdateSiteContentPageInput = {};
      if (title.trim() !== page.title) diff.title = title;
      if (body.trim() !== page.body) diff.body = body;
      if (isPublished !== page.isPublished) diff.isPublished = isPublished;
      if (Object.keys(diff).length === 0) return setNotice("تغییری برای ذخیره وجود ندارد");
      input = diff;
    }
    const parsed = updateSiteContentPageSchema.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setSaving(true);
    try {
      const saved = await updateSitePage(page.slug, parsed.data);
      onSaved(saved);
      setTitle(saved.title);
      setBody(saved.body);
      setIsPublished(saved.isPublished);
      setNotice("صفحه ذخیره شد");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form
        noValidate
        aria-label={`ویرایش صفحه‌ی ${page.label}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-gray-900">{page.label}</p>
          {page.exists ? <StatusBadge active={page.isPublished} on="منتشرشده" off="منتشرنشده" /> : <StatusBadge active={false} off="هنوز ذخیره نشده" />}
        </div>
        <Field label="عنوان" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <TextAreaField label="متن (فقط متن ساده)" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-emerald-500"
          />
          منتشر شود
        </label>
        <InlineError message={error} />
        <InlineSuccess message={notice} />
        <Button type="submit" size="xs" isLoading={saving}>
          ذخیره
        </Button>
      </form>
    </Card>
  );
}

export function PagesSection() {
  const { state, reload, setData } = useSectionLoad(fetchSitePages);
  return (
    <section aria-labelledby="site-content-pages" className="space-y-3">
      <div>
        <h2 id="site-content-pages" className="text-lg font-extrabold text-gray-900">صفحات ثابت</h2>
        <p className="text-sm text-gray-400">متن صفحات «درباره ما» و «قوانین و مقررات»؛ مجموعه‌ی صفحات ثابت است و صفحه‌ی جدید ساخته نمی‌شود</p>
      </div>
      <SectionState state={state} noun="صفحات" onRetry={reload} />
      {state.status === "ready" &&
        state.data.map((page) => (
          <PageCard
            key={page.slug}
            page={page}
            onSaved={(saved) => setData((list) => list.map((p) => (p.slug === saved.slug ? saved : p)))}
          />
        ))}
    </section>
  );
}
