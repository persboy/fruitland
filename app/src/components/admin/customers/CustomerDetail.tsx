"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPin, Power } from "lucide-react";
import { updateCustomerProfileSchema, type CustomerDetailDto, type UpdateCustomerProfileInput } from "@fruitland/shared";
import { Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/client/adminAuth";
import { fetchCustomer, setCustomerActive, updateCustomerProfile } from "@/lib/client/adminCustomers";
import { formatJalaliCalendarDate, formatJalaliDateTime } from "@/lib/client/format";
import { Field, InfoRow, InlineError, InlineSuccess } from "../settings/fields";
import { SectionState, StatusBadge, useSectionLoad } from "../site-content/useSectionLoad";
import { customerName } from "./CustomersManager";

const ADDRESS_LABELS: Record<string, string> = { home: "خانه", work: "محل کار", other: "سایر" };

function ProfileForm({ customer, onSaved }: { customer: CustomerDetailDto; onSaved: (c: CustomerDetailDto) => void }) {
  const [firstName, setFirstName] = useState(customer.firstName ?? "");
  const [lastName, setLastName] = useState(customer.lastName ?? "");
  const [birthDate, setBirthDate] = useState(customer.birthDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    const diff: UpdateCustomerProfileInput = {};
    if (firstName.trim() !== (customer.firstName ?? "")) diff.firstName = firstName;
    if (lastName.trim() !== (customer.lastName ?? "")) diff.lastName = lastName;
    if (birthDate !== (customer.birthDate ?? "")) {
      if (birthDate === "") return setError("حذف تاریخ تولد پشتیبانی نمی‌شود");
      diff.birthDate = birthDate;
    }
    if (Object.keys(diff).length === 0) return setNotice("تغییری برای ذخیره وجود ندارد");
    const parsed = updateCustomerProfileSchema.safeParse(diff);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setSaving(true);
    try {
      const saved = await updateCustomerProfile(customer.id, parsed.data);
      onSaved(saved);
      setFirstName(saved.firstName ?? "");
      setLastName(saved.lastName ?? "");
      setBirthDate(saved.birthDate ?? "");
      setNotice("اطلاعات مشتری ذخیره شد");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form noValidate aria-label="ویرایش پروفایل مشتری" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
        <p className="text-sm font-bold text-gray-900">ویرایش پروفایل</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="نام" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} />
          <Field label="نام‌خانوادگی" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} />
          <div>
            <Field
              label="تاریخ تولد"
              type="date"
              dir="ltr"
              min="1900-01-01"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              hint={birthDate ? `تاریخ شمسی: ${formatJalaliCalendarDate(birthDate)}` : "ثبت نشده"}
            />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">شماره موبایل در این بخش قابل ویرایش نیست. تغییر تاریخ تولد در گزارش تغییرات (AuditLog) ثبت می‌شود.</p>
        <InlineError message={error} />
        <InlineSuccess message={notice} />
        <Button type="submit" size="xs" isLoading={saving}>ذخیره</Button>
      </form>
    </Card>
  );
}

export function CustomerDetail({ id }: { id: string }) {
  const { state, reload, setData } = useSectionLoad(() => fetchCustomer(id));
  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async (customer: CustomerDetailDto) => {
    setActionError(null);
    setNotice(null);
    setToggling(true);
    try {
      const saved = await setCustomerActive(customer.id, !customer.isActive);
      setData(() => saved);
      setNotice(saved.isActive ? "حساب مشتری فعال شد" : "حساب مشتری غیرفعال شد");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-4">
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800">
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        بازگشت به فهرست مشتریان
      </Link>

      <SectionState state={state} noun="مشتری" returnTo={`/admin/customers/${id}`} onRetry={reload} />

      {state.status === "ready" && (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">{customerName(state.data)}</h2>
                <div className="mt-1"><StatusBadge active={state.data.isActive} /></div>
              </div>
              <Button size="sm" variant="secondary" isLoading={toggling} onClick={() => void toggle(state.data)}>
                {!toggling && <Power className="h-4 w-4" aria-hidden="true" />}
                {state.data.isActive ? "غیرفعال‌سازی حساب" : "فعال‌سازی حساب"}
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              <InlineSuccess message={notice} />
              <InlineError message={actionError} />
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoRow label="شماره موبایل" value={state.data.phone} ltr />
              <InfoRow label="تاریخ ثبت‌نام" value={formatJalaliDateTime(state.data.createdAt)} />
              <InfoRow label="آخرین ورود" value={state.data.lastLoginAt ? formatJalaliDateTime(state.data.lastLoginAt) : "—"} />
              <InfoRow label="آخرین ویرایش" value={formatJalaliDateTime(state.data.updatedAt)} />
            </dl>
            <p className="mt-3 text-[11px] text-gray-400">غیرفعال‌سازی ورود و تمدید نشست را متوقف می‌کند؛ نشست‌های فعلی تا انقضای توکن (حداکثر ۱۵ دقیقه) ادامه می‌یابند.</p>
          </Card>

          <ProfileForm key={state.data.updatedAt} customer={state.data} onSaved={(c) => setData(() => c)} />

          <section aria-labelledby="customer-addresses" className="space-y-3">
            <h3 id="customer-addresses" className="text-sm font-bold text-gray-900">آدرس‌ها (فقط نمایش)</h3>
            {state.data.addresses.length === 0 ? (
              <Card><p className="text-sm text-gray-400">این مشتری آدرسی ثبت نکرده است.</p></Card>
            ) : (
              <ul className="space-y-3">
                {state.data.addresses.map((a) => (
                  <li key={a.id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-gray-300" aria-hidden="true" />
                        <span className="font-bold text-gray-800">{ADDRESS_LABELS[a.label] ?? a.label}</span>
                        {a.isDefault && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600">پیش‌فرض</span>}
                      </div>
                      <p className="mt-2 text-sm text-gray-700">{a.province}، {a.city}، {a.addressLine}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        گیرنده: {a.recipientName} — <span dir="ltr">{a.phone}</span>
                        {a.postalCode && <> — کدپستی: <span dir="ltr">{a.postalCode}</span></>}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
