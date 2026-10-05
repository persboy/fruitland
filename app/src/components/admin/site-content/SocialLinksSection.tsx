"use client";

import { useState } from "react";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  updateSocialLinksSchema,
  type SocialLinksDto,
  type UpdateSocialLinksInput,
} from "@fruitland/shared";
import { Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchSocialLinks, updateSocialLinks } from "@/lib/client/adminSiteContent";
import { Field, InlineError, InlineSuccess } from "../settings/fields";
import { SectionState, useSectionLoad } from "./useSectionLoad";

function SocialLinksForm({ links, onSaved }: { links: SocialLinksDto; onSaved: (l: SocialLinksDto) => void }) {
  const [values, setValues] = useState<SocialLinksDto>(links);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    const diff: UpdateSocialLinksInput = {};
    for (const p of SOCIAL_PLATFORMS) if (values[p].trim() !== links[p]) diff[p] = values[p];
    if (Object.keys(diff).length === 0) return setNotice("تغییری برای ذخیره وجود ندارد");
    const parsed = updateSocialLinksSchema.safeParse(diff);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setSaving(true);
    try {
      const saved = await updateSocialLinks(parsed.data);
      onSaved(saved);
      setValues(saved);
      setNotice("لینک‌های شبکه‌های اجتماعی ذخیره شد");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form noValidate aria-label="ویرایش لینک‌های شبکه‌های اجتماعی" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SOCIAL_PLATFORMS.map((p) => (
            <Field
              key={p}
              label={SOCIAL_PLATFORM_LABELS[p]}
              hint="اختیاری؛ آدرس کامل http:// یا https://"
              dir="ltr"
              inputMode="url"
              value={values[p]}
              onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
              maxLength={400}
            />
          ))}
        </div>
        <InlineError message={error} />
        <InlineSuccess message={notice} />
        <Button type="submit" size="xs" isLoading={saving}>
          ذخیره
        </Button>
      </form>
    </Card>
  );
}

export function SocialLinksSection() {
  const { state, reload, setData } = useSectionLoad(fetchSocialLinks);
  return (
    <section aria-labelledby="site-content-social" className="space-y-3">
      <div>
        <h2 id="site-content-social" className="text-lg font-extrabold text-gray-900">شبکه‌های اجتماعی</h2>
        <p className="text-sm text-gray-400">لینک خالی یعنی آن شبکه نمایش داده نمی‌شود</p>
      </div>
      <SectionState state={state} noun="لینک‌های شبکه‌های اجتماعی" onRetry={reload} />
      {state.status === "ready" && <SocialLinksForm links={state.data} onSaved={(l) => setData(() => l)} />}
    </section>
  );
}
