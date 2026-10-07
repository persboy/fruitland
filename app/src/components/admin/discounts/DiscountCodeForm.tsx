"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  createDiscountCodeSchema,
  generateDiscountCode,
  isValidCalendarDate,
  toTehranCalendarDate,
  updateDiscountCodeSchema,
  type CreateDiscountCodeRequest,
  type DiscountCodeDto,
  type DiscountType,
  type UpdateDiscountCodeRequest,
} from "@fruitland/shared";
import { Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { formatJalaliCalendarDate, formatNumberInput, parseTomanInput, toEnglishDigits } from "@/lib/client/format";
import { Field, InfoRow, InlineError } from "../settings/fields";
import { FormActions } from "../settings/FormActions";
import { OwnerPicker, type PickedOwner } from "./OwnerPicker";

type Props =
  | { mode: "create"; onSubmit: (input: CreateDiscountCodeRequest) => Promise<void>; onCancel: () => void }
  | { mode: "edit"; discountCode: DiscountCodeDto; onSubmit: (input: UpdateDiscountCodeRequest) => Promise<void>; onCancel: () => void };

export const TYPE_LABELS: Record<DiscountType, string> = { public: "عمومی", personal: "شخصی" };

/** Percentage is a small count, not money: digits only (Persian digits accepted). */
const digitsOnly = (value: string) => toEnglishDigits(value).replace(/\D/g, "");

const cryptoRandomInt = (max: number): number => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max; // max is 32, which divides 2^32 — no modulo bias
};

const numberText = (n: number | null | undefined) => (typeof n === "number" ? formatNumberInput(String(n)) : "");

export const ownerLabel = (o: NonNullable<DiscountCodeDto["owner"]>) =>
  [[o.firstName, o.lastName].filter(Boolean).join(" ") || "بدون نام", o.phone].filter(Boolean).join(" — ");

/**
 * One form for create and edit. Validation reuses the shared Zod schemas the API uses (UX only — the
 * server stays authoritative); server errors such as a duplicate code are shown inline and the entered
 * values are kept. In edit mode code, type and owner are read-only and only changed fields are sent.
 * `minOrderAmount` is only stored — this form says nothing about how Checkout applies it.
 */
export function DiscountCodeForm(props: Props) {
  const initial = props.mode === "edit" ? props.discountCode : null;
  const [code, setCode] = useState("");
  const [type, setType] = useState<DiscountType>("public");
  const [owner, setOwner] = useState<PickedOwner | null>(null);
  const [percentage, setPercentage] = useState(initial ? String(initial.percentage) : "");
  const [maxAmount, setMaxAmount] = useState(numberText(initial?.maxDiscountAmount));
  const [minAmount, setMinAmount] = useState(numberText(initial?.minOrderAmount));
  const [usageLimit, setUsageLimit] = useState(numberText(initial?.usageLimit));
  const [expiry, setExpiry] = useState(initial?.expiresAt ? toTehranCalendarDate(new Date(initial.expiresAt)) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const percentageValue = percentage === "" ? undefined : Number(percentage);
    const max = parseTomanInput(maxAmount);
    const min = parseTomanInput(minAmount);
    const limit = parseTomanInput(usageLimit);
    try {
      if (props.mode === "create") {
        const parsed = createDiscountCodeSchema.safeParse({
          code,
          type,
          ownerUserId: type === "personal" ? owner?.id : undefined,
          percentage: percentageValue,
          maxDiscountAmount: max ?? undefined,
          minOrderAmount: min ?? undefined,
          usageLimit: limit ?? undefined,
          expiresAt: expiry || undefined,
        });
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setSaving(true);
        await props.onSubmit(parsed.data);
      } else {
        const current = props.discountCode;
        if (percentageValue === undefined) return setError("درصد تخفیف الزامی است");
        // Send only what changed; an unchanged form just closes.
        const diff: UpdateDiscountCodeRequest = {};
        if (percentageValue !== current.percentage) diff.percentage = percentageValue;
        if (max === null) {
          if (current.maxDiscountAmount !== null) diff.maxDiscountAmount = null;
        } else if (max !== current.maxDiscountAmount) diff.maxDiscountAmount = max;
        if ((min ?? 0) !== current.minOrderAmount) diff.minOrderAmount = min ?? 0;
        if (limit === null) {
          if (current.usageLimit !== null) diff.usageLimit = null;
        } else if (limit !== current.usageLimit) diff.usageLimit = limit;
        const currentExpiry = current.expiresAt ? toTehranCalendarDate(new Date(current.expiresAt)) : "";
        if (expiry !== currentExpiry) diff.expiresAt = expiry === "" ? null : expiry;
        if (Object.keys(diff).length === 0) return props.onCancel();
        const parsed = updateDiscountCodeSchema.safeParse(diff);
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

  const title = props.mode === "create" ? "کد تخفیف جدید" : `ویرایش «${props.discountCode.code}»`;
  const expiryJalali = expiry && isValidCalendarDate(expiry) ? formatJalaliCalendarDate(expiry) : null;

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

        {props.mode === "create" ? (
          <>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label="کد تخفیف"
                  hint="حروف انگلیسی، عدد، _ و - ؛ ۳ تا ۳۰ نویسه"
                  dir="ltr"
                  value={code}
                  maxLength={30}
                  autoComplete="off"
                  className="text-left uppercase tracking-wide"
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <Button type="button" size="xs" variant="secondary" className="mb-5" onClick={() => setCode(generateDiscountCode(cryptoRandomInt))}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                تولید کد
              </Button>
            </div>

            <fieldset>
              <legend className="mb-1 text-xs font-medium text-gray-500">نوع کد</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(["public", "personal"] as const).map((t) => (
                  <label
                    key={t}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${
                      type === t ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="discount-type"
                      value={t}
                      checked={type === t}
                      onChange={() => {
                        setType(t);
                        if (t === "public") setOwner(null);
                      }}
                      className="accent-emerald-500"
                    />
                    {t === "public" ? "عمومی — برای همه مشتریان" : "شخصی — فقط یک مشتری"}
                  </label>
                ))}
              </div>
            </fieldset>

            {type === "personal" && <OwnerPicker value={owner} onChange={setOwner} />}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoRow label="کد تخفیف (غیرقابل ویرایش)" value={props.discountCode.code} ltr />
            <InfoRow label="نوع (غیرقابل ویرایش)" value={TYPE_LABELS[props.discountCode.type]} />
            {props.discountCode.owner && <InfoRow label="مشتری مالک (غیرقابل ویرایش)" value={ownerLabel(props.discountCode.owner)} />}
            <InfoRow label="تعداد استفاده‌شده (فقط‌خواندنی)" value={props.discountCode.usedCount.toLocaleString("fa-IR")} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="درصد تخفیف"
            hint="عدد صحیح بین ۱ تا ۱۰۰"
            dir="ltr"
            inputMode="numeric"
            value={percentage}
            maxLength={3}
            onChange={(e) => setPercentage(digitsOnly(e.target.value))}
          />
          <Field
            label="حداکثر مبلغ تخفیف (تومان)"
            hint="خالی = بدون سقف"
            dir="ltr"
            inputMode="numeric"
            value={maxAmount}
            onChange={(e) => setMaxAmount(formatNumberInput(e.target.value))}
          />
          <Field
            label="حداقل مبلغ سفارش (تومان)"
            hint="خالی = بدون حداقل"
            dir="ltr"
            inputMode="numeric"
            value={minAmount}
            onChange={(e) => setMinAmount(formatNumberInput(e.target.value))}
          />
          <Field
            label="سقف تعداد استفاده"
            hint="خالی = نامحدود"
            dir="ltr"
            inputMode="numeric"
            value={usageLimit}
            onChange={(e) => setUsageLimit(formatNumberInput(e.target.value))}
          />
          <div>
            <Field label="تاریخ انقضا (اختیاری)" hint="خالی = بدون انقضا" type="date" dir="ltr" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            {expiryJalali && (
              <p data-testid="expiry-jalali" className="mt-1 text-[11px] font-semibold text-gray-600">
                معادل شمسی: {expiryJalali} — تا پایان همین روز (به وقت تهران) معتبر است
              </p>
            )}
          </div>
        </div>

        <InlineError message={error} />
        <FormActions saving={saving} onCancel={props.onCancel} saveLabel={props.mode === "create" ? "ایجاد" : "ذخیره"} />
      </form>
    </Card>
  );
}
