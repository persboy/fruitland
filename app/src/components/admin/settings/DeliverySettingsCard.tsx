"use client";

import { useState } from "react";
import { Pencil, Truck } from "lucide-react";
import { Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchShippingSettings, saveShippingSettings, type ShippingSettings } from "@/lib/client/adminSettings";
import { formatNumberInput, formatToman, parseTomanInput } from "@/lib/client/format";
import { CardTitle, Field, InfoRow, InlineError, InlineSuccess } from "./fields";
import { FormActions } from "./FormActions";
import { LoadErrorLine, LoadingLine } from "./LoadStatus";
import { useLoadable } from "./useLoadable";

/** The single source of truth for the express fee and free-delivery threshold — the cart/checkout read the same document later. */
export function DeliverySettingsCard() {
  const { state, setData, reload } = useLoadable(fetchShippingSettings);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ fee: "", threshold: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const startEditing = (current: ShippingSettings) => {
    setDraft({
      fee: current.expressDeliveryFee === null ? "" : formatNumberInput(String(current.expressDeliveryFee)),
      threshold: current.freeDeliveryThreshold === null ? "" : formatNumberInput(String(current.freeDeliveryThreshold)),
    });
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const save = async () => {
    setError(null);
    const expressDeliveryFee = parseTomanInput(draft.fee);
    const freeDeliveryThreshold = parseTomanInput(draft.threshold);
    if (expressDeliveryFee === null) return setError("هزینه ارسال فوری را به‌صورت عدد صحیح (تومان) وارد کنید");
    if (freeDeliveryThreshold === null) return setError("حداقل مبلغ ارسال رایگان را به‌صورت عدد صحیح (تومان) وارد کنید");
    setSaving(true);
    try {
      setData(await saveShippingSettings({ expressDeliveryFee, freeDeliveryThreshold }));
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
        <CardTitle icon={Truck}>تنظیمات ارسال</CardTitle>
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
          <Field
            label="هزینه ارسال فوری (تومان)"
            inputMode="numeric"
            dir="ltr"
            value={draft.fee}
            onChange={(e) => setDraft((d) => ({ ...d, fee: formatNumberInput(e.target.value) }))}
          />
          <Field
            label="حداقل مبلغ برای ارسال رایگان (تومان)"
            inputMode="numeric"
            dir="ltr"
            value={draft.threshold}
            onChange={(e) => setDraft((d) => ({ ...d, threshold: formatNumberInput(e.target.value) }))}
          />
          <InlineError message={error} />
          <FormActions saving={saving} onCancel={() => setEditing(false)} />
        </form>
      )}

      {state.status === "ready" && !editing && !state.data.isConfigured && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-gray-400">هنوز هزینه‌ی ارسال و آستانه‌ی ارسال رایگان تعیین نشده است.</p>
          <button
            onClick={() => startEditing(state.data)}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            تعیین مبالغ ارسال
          </button>
        </div>
      )}

      {state.status === "ready" && !editing && state.data.isConfigured && (
        <div className="space-y-3">
          <InfoRow label="هزینه ارسال فوری" value={formatToman(state.data.expressDeliveryFee ?? 0)} />
          <InfoRow label="حداقل مبلغ برای ارسال رایگان" value={formatToman(state.data.freeDeliveryThreshold ?? 0)} />
          <InlineSuccess message={saved ? "تنظیمات ارسال ذخیره شد" : null} />
        </div>
      )}
    </Card>
  );
}
