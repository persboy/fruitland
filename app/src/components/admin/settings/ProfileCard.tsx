"use client";

import { useState } from "react";
import { KeyRound, Lock, Pencil, Phone, User } from "lucide-react";
import { Card } from "@/components/ui";
import { ROLE_LABELS, displayNameOf, errorMessage } from "@/lib/client/adminAuth";
import { changePassword, confirmPhoneChange, requestPhoneChange, saveProfileName } from "@/lib/client/adminSettings";
import { useAdminUser } from "../AdminUserContext";
import { CardTitle, Field, InlineError, InlineSuccess } from "./fields";
import { FormActions } from "./FormActions";

type Mode = "view" | "name" | "phone" | "phone-code" | "password";

const PHONE_REGEX = /^09\d{9}$/;
const OTP_LENGTH = 4;
const digitsOnly = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

const linkButton =
  "flex cursor-pointer items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-emerald-600";

export function ProfileCard() {
  const { user, updateUser } = useAdminUser();
  const [mode, setMode] = useState<Mode>("view");
  const [success, setSuccess] = useState<string | null>(null);
  const name = displayNameOf(user);

  const finish = (message: string) => {
    setMode("view");
    setSuccess(message);
  };
  const open = (next: Mode) => {
    setSuccess(null);
    setMode(next);
  };

  return (
    <Card>
      <div className="mb-4">
        <CardTitle icon={User}>پروفایل من</CardTitle>
      </div>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
            {name.slice(0, 2)}
          </span>
          <div>
            <p className="text-sm font-bold text-gray-900">{name}</p>
            <p className="text-xs text-gray-400" dir="ltr">
              {ROLE_LABELS[user.role] ?? "ادمین"} · {user.phone}
            </p>
          </div>
        </div>
        {mode === "view" && (
          <button
            onClick={() => open("name")}
            className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            ویرایش نام
          </button>
        )}
      </div>

      {mode === "name" && (
        <NameForm
          initial={{ firstName: user.firstName ?? "", lastName: user.lastName ?? "" }}
          onCancel={() => setMode("view")}
          onSaved={(u) => {
            updateUser({ firstName: u.firstName ?? "", lastName: u.lastName ?? "" });
            finish("نام ذخیره شد");
          }}
        />
      )}

      <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
        {(mode === "view" || mode === "name") && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button onClick={() => open("phone")} className={linkButton}>
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              تغییر شماره موبایل
            </button>
            <button onClick={() => open("password")} className={linkButton}>
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              {user.hasPassword ? "تغییر رمز عبور" : "تعیین رمز عبور"}
            </button>
          </div>
        )}

        {(mode === "phone" || mode === "phone-code") && (
          <PhoneChangeForm
            onCancel={() => setMode("view")}
            onChanged={(phone) => {
              updateUser({ phone });
              finish("شماره‌ی موبایل تغییر کرد");
            }}
          />
        )}

        {mode === "password" && (
          <PasswordForm
            hasPassword={Boolean(user.hasPassword)}
            onCancel={() => setMode("view")}
            onSaved={() => {
              updateUser({ hasPassword: true });
              finish("رمز عبور با موفقیت ذخیره شد");
            }}
          />
        )}

        <InlineSuccess message={success} />
      </div>
    </Card>
  );
}

function NameForm(props: {
  initial: { firstName: string; lastName: string };
  onCancel: () => void;
  onSaved: (user: { firstName?: string; lastName?: string }) => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      props.onSaved(await saveProfileName(draft));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="mt-4 space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="نام" value={draft.firstName} onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))} />
        <Field label="نام خانوادگی" value={draft.lastName} onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))} />
      </div>
      <InlineError message={error} />
      <FormActions saving={saving} onCancel={props.onCancel} />
    </form>
  );
}

function PhoneChangeForm(props: { onCancel: () => void; onChanged: (phone: string) => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    if (!PHONE_REGEX.test(phone)) return setError("شماره موبایل را به‌درستی وارد کنید");
    setBusy(true);
    try {
      await requestPhoneChange(phone);
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setError(null);
    if (code.length !== OTP_LENGTH) return setError("کد ۴ رقمی را کامل وارد کنید");
    setBusy(true);
    try {
      const updated = await confirmPhoneChange(phone, code);
      props.onChanged(updated.phone);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void (step === "phone" ? sendCode() : confirm());
      }}
      className="space-y-3"
    >
      {step === "phone" ? (
        <Field
          label="شماره‌ی موبایل جدید"
          inputMode="numeric"
          dir="ltr"
          autoFocus
          placeholder="09123456789"
          value={phone}
          onChange={(e) => setPhone(digitsOnly(e.target.value, 11))}
          hint="یک کد تأیید به شماره‌ی جدید پیامک می‌شود. شماره‌ی ورود شما بعد از تأیید تغییر می‌کند."
        />
      ) : (
        <Field
          label={`کد تأیید ارسال‌شده به ${phone}`}
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          autoFocus
          maxLength={OTP_LENGTH}
          value={code}
          onChange={(e) => setCode(digitsOnly(e.target.value, OTP_LENGTH))}
        />
      )}
      <InlineError message={error} />
      <div className="flex items-center gap-2">
        <FormActions
          saving={busy}
          onCancel={props.onCancel}
          saveLabel={step === "phone" ? "ارسال کد" : "تأیید و تغییر شماره"}
        />
        {step === "code" && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep("phone");
            }}
            className="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-600"
          >
            ویرایش شماره
          </button>
        )}
      </div>
    </form>
  );
}

function PasswordForm(props: { hasPassword: boolean; onCancel: () => void; onSaved: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (setter: (v: string) => void) => (e: { target: { value: string } }) => {
    setError(null);
    setter(e.target.value);
  };

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const canSave = next.length >= 8 && next === confirm && (!props.hasPassword || current.length > 0);

  const save = async () => {
    setSaving(true);
    try {
      await changePassword({ currentPassword: props.hasPassword ? current : undefined, newPassword: next });
      props.onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save();
      }}
      className="space-y-3"
    >
      {props.hasPassword && (
        <Field
          label="رمز عبور فعلی"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          value={current}
          onChange={edit(setCurrent)}
        />
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="رمز عبور جدید"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={next}
          onChange={edit(setNext)}
          error={tooShort ? "رمز عبور باید حداقل ۸ کاراکتر باشد" : undefined}
        />
        <Field
          label="تکرار رمز عبور"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={confirm}
          onChange={edit(setConfirm)}
          error={mismatch ? "رمز عبور و تکرار آن یکسان نیستند" : undefined}
        />
      </div>
      <InlineError message={error} />
      <div className="flex items-center gap-2">
        <FormActions saving={saving} onCancel={props.onCancel} saveLabel="ذخیره رمز عبور" saveDisabled={!canSave} />
        <Lock className="h-3.5 w-3.5 text-gray-300" aria-hidden="true" />
      </div>
    </form>
  );
}
