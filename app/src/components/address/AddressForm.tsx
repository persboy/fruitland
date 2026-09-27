"use client";

import { ADDRESS_LABELS, type AddressLabel } from "@fruitland/shared";
import { Button } from "@/components/ui";

const LABEL_TEXT: Record<AddressLabel, string> = { home: "خانه", work: "محل کار", other: "سایر" };

export interface AddressFormValues {
  label: AddressLabel;
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  neighborhood: string;
  street: string;
  alley: string;
  plaque: string;
  unit: string;
  addressLine: string;
  postalCode: string;
  deliveryNotes: string;
}

export const emptyAddressForm: AddressFormValues = {
  label: "home",
  recipientName: "",
  phone: "",
  province: "",
  city: "",
  district: "",
  neighborhood: "",
  street: "",
  alley: "",
  plaque: "",
  unit: "",
  addressLine: "",
  postalCode: "",
  deliveryNotes: "",
};

/** Undefined/absent server fields become "" for the controlled inputs — the reverse (""→undefined) happens where this is submitted. */
export function addressFormFromPartial(partial: Partial<Record<keyof AddressFormValues, string | null | undefined>>): AddressFormValues {
  return { ...emptyAddressForm, ...Object.fromEntries(Object.entries(partial).map(([k, v]) => [k, v ?? ""])) };
}

const fieldClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

function Field({ id, label, ...props }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-500">
        {label}
      </label>
      <input id={id} className={fieldClass} {...props} />
    </div>
  );
}

/**
 * Pure, reusable address form. Knows nothing about maps, providers, or the
 * Address API — it only edits an `AddressFormValues` object and reports
 * changes/submission. Prefilled by a reverse-geocode result (via
 * `addressFormFromPartial`) but every field stays editable (map spec §32).
 */
export function AddressForm(props: {
  value: AddressFormValues;
  onChange: (value: AddressFormValues) => void;
  onSubmit: (value: AddressFormValues) => void;
  submitLabel: string;
  saving?: boolean;
  error?: string | null;
}) {
  const { value, onChange } = props;
  const set = <K extends keyof AddressFormValues>(key: K) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(value);
      }}
      className="space-y-3"
    >
      <div>
        <label htmlFor="address-label" className="mb-1 block text-xs font-medium text-gray-500">
          نوع آدرس
        </label>
        <select id="address-label" className={fieldClass} value={value.label} onChange={set("label")}>
          {ADDRESS_LABELS.map((l) => (
            <option key={l} value={l}>
              {LABEL_TEXT[l]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="address-recipient" label="نام گیرنده" value={value.recipientName} onChange={set("recipientName")} />
        <Field id="address-phone" label="شماره تماس" dir="ltr" value={value.phone} onChange={set("phone")} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="address-province" label="استان" value={value.province} onChange={set("province")} />
        <Field id="address-city" label="شهر" value={value.city} onChange={set("city")} />
        <Field id="address-district" label="منطقه" value={value.district} onChange={set("district")} />
        <Field id="address-neighborhood" label="محله" value={value.neighborhood} onChange={set("neighborhood")} />
        <Field id="address-street" label="خیابان" value={value.street} onChange={set("street")} />
        <Field id="address-alley" label="کوچه" value={value.alley} onChange={set("alley")} />
        <Field id="address-plaque" label="پلاک" value={value.plaque} onChange={set("plaque")} />
        <Field id="address-unit" label="واحد" value={value.unit} onChange={set("unit")} />
      </div>

      <div>
        <label htmlFor="address-line" className="mb-1 block text-xs font-medium text-gray-500">
          آدرس کامل
        </label>
        <textarea id="address-line" rows={2} className={fieldClass} value={value.addressLine} onChange={set("addressLine")} />
      </div>

      <Field id="address-postal-code" label="کد پستی" dir="ltr" value={value.postalCode} onChange={set("postalCode")} />

      <div>
        <label htmlFor="address-notes" className="mb-1 block text-xs font-medium text-gray-500">
          توضیحات برای پیک
        </label>
        <textarea id="address-notes" rows={2} className={fieldClass} value={value.deliveryNotes} onChange={set("deliveryNotes")} />
      </div>

      {props.error && (
        <p role="alert" className="text-xs font-semibold text-red-500">
          {props.error}
        </p>
      )}

      <Button type="submit" isLoading={props.saving}>
        {props.submitLabel}
      </Button>
    </form>
  );
}
