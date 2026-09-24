"use client";

import { useState } from "react";
import { Pencil, Store } from "lucide-react";
import { Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchStoreSettings, saveStoreSettings, type StoreSettings } from "@/lib/client/adminSettings";
import { CardTitle, Field, InfoRow, InlineError, InlineSuccess, TextAreaField } from "./fields";
import { FormActions } from "./FormActions";
import { LoadErrorLine, LoadingLine } from "./LoadStatus";
import { useLoadable } from "./useLoadable";

export function StoreInfoCard() {
  const { state, setData, reload } = useLoadable(fetchStoreSettings);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ storeName: "", supportPhone: "", address: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const startEditing = (current: StoreSettings) => {
    setDraft({ storeName: current.storeName, supportPhone: current.supportPhone, address: current.address });
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const save = async () => {
    setError(null);
    if (!draft.storeName.trim()) return setError("نام فروشگاه الزامی است");
    if (!draft.supportPhone.trim()) return setError("شماره پشتیبانی الزامی است");
    setSaving(true);
    try {
      setData(await saveStoreSettings(draft));
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle icon={Store}>اطلاعات فروشگاه</CardTitle>
        {state.status === "ready" && !editing && state.data.isConfigured && (
          <button
            onClick={() => startEditing(state.data)}
            className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-emerald-600"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            ویرایش
          </button>
        )}
      </div>

      {state.status === "loading" && <LoadingLine />}
      {state.status === "error" && <LoadErrorLine message={state.message} onRetry={reload} />}

      {state.status === "ready" && editing && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-3"
        >
          <Field label="نام فروشگاه" value={draft.storeName} onChange={(e) => setDraft((d) => ({ ...d, storeName: e.target.value }))} />
          <Field
            label="شماره پشتیبانی"
            dir="ltr"
            inputMode="tel"
            value={draft.supportPhone}
            onChange={(e) => setDraft((d) => ({ ...d, supportPhone: e.target.value }))}
          />
          <TextAreaField label="آدرس" value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} />
          <InlineError message={error} />
          <FormActions saving={saving} onCancel={() => setEditing(false)} />
        </form>
      )}

      {state.status === "ready" && !editing && !state.data.isConfigured && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-gray-400">هنوز اطلاعات فروشگاه ثبت نشده است.</p>
          <button
            onClick={() => startEditing(state.data)}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            ثبت اطلاعات فروشگاه
          </button>
        </div>
      )}

      {state.status === "ready" && !editing && state.data.isConfigured && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoRow label="نام فروشگاه" value={state.data.storeName} />
            <InfoRow label="شماره پشتیبانی" value={state.data.supportPhone} ltr />
            <InfoRow label="آدرس" value={state.data.address || "—"} full />
          </div>
          <InlineSuccess message={saved ? "اطلاعات فروشگاه ذخیره شد" : null} />
        </div>
      )}
    </Card>
  );
}
