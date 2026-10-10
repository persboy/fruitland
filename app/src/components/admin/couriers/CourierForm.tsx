"use client";

import { useState } from "react";
import { VEHICLE_TYPES, createCourierSchema, updateCourierSchema, type CourierDto, type CreateCourierRequest, type UpdateCourierRequest, type VehicleType } from "@fruitland/shared";
import { Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { Field, InfoRow, InlineError } from "../settings/fields";
import { FormActions } from "../settings/FormActions";
import { OwnerPicker, type PickedOwner } from "../discounts/OwnerPicker";
import { AVAILABILITY_LABELS, VEHICLE_LABELS, courierName } from "./labels";

type Props =
  | { mode: "create"; onSubmit: (input: CreateCourierRequest) => Promise<void>; onCancel: () => void }
  | { mode: "edit"; courier: CourierDto; onSubmit: (input: UpdateCourierRequest) => Promise<void>; onCancel: () => void };

const selectClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

/**
 * One form for promotion (create) and profile edit. Validation reuses the shared Zod schemas the API
 * uses (UX only — the server stays authoritative); server errors (e.g. an ineligible customer) are
 * shown inline and the entered values are kept. Role, availability status and location are not
 * editable here. A pending submission disables the buttons, so it cannot be sent twice.
 */
export function CourierForm(props: Props) {
  const initial = props.mode === "edit" ? props.courier : null;
  const [customer, setCustomer] = useState<PickedOwner | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType | "">(initial?.vehicleType ?? "");
  const [plate, setPlate] = useState(initial?.plateNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setError(null);
    try {
      if (props.mode === "create") {
        const parsed = createCourierSchema.safeParse({ userId: customer?.id, vehicleType: vehicleType || undefined, plateNumber: plate });
        if (!parsed.success) return setError(customer ? parsed.error.issues[0]!.message : "ابتدا مشتری را انتخاب کنید");
        setSaving(true);
        await props.onSubmit(parsed.data);
      } else {
        const current = props.courier;
        const diff: Record<string, unknown> = {};
        if (vehicleType && vehicleType !== current.vehicleType) diff.vehicleType = vehicleType;
        if (plate.trim() !== (current.plateNumber ?? "")) diff.plateNumber = plate;
        if (Object.keys(diff).length === 0) return props.onCancel();
        const parsed = updateCourierSchema.safeParse(diff);
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

  const title = props.mode === "create" ? "تبدیل مشتری به پیک" : `ویرایش «${courierName(props.courier)}»`;

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
            <OwnerPicker value={customer} onChange={setCustomer} heading="مشتری انتخاب‌شده" searchLabel="مشتری (جست‌وجوی نام یا شماره موبایل)" inputId="courier-customer-search" />
            <p className="text-[11px] text-gray-400">فقط مشتری فعالی که نام و نام‌خانوادگی ثبت کرده می‌تواند پیک شود. این کار قابل بازگشت نیست؛ بعداً فقط می‌توان حساب را غیرفعال کرد.</p>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <InfoRow label="شماره موبایل (غیرقابل ویرایش)" value={props.courier.phone} ltr />
            <InfoRow label="وضعیت حضور (فقط‌خواندنی)" value={AVAILABILITY_LABELS[props.courier.availabilityStatus]} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="courier-vehicle" className="mb-1 block text-xs font-medium text-gray-500">
              نوع وسیله‌ی نقلیه
            </label>
            <select id="courier-vehicle" value={vehicleType} onChange={(e) => setVehicleType(e.target.value as VehicleType | "")} className={selectClass}>
              <option value="">انتخاب کنید</option>
              {VEHICLE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {VEHICLE_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
          <Field label="پلاک (اختیاری)" hint="خالی = بدون پلاک" maxLength={20} autoComplete="off" value={plate} onChange={(e) => setPlate(e.target.value)} />
        </div>

        <InlineError message={error} />
        <FormActions saving={saving} onCancel={props.onCancel} saveLabel={props.mode === "create" ? "تبدیل به پیک" : "ذخیره"} />
      </form>
    </Card>
  );
}
