"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, KeyRound, Lock, MessageSquareText, Phone, ShieldCheck } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  errorMessage,
  fetchCurrentUser,
  isAdminRole,
  loginWithPassword,
  logoutCurrentSession,
  requestOtp,
  safeReturnTo,
  verifyOtp,
} from "@/lib/client/adminAuth";
import { ApiClientError } from "@/lib/client/apiClient";

const PHONE_REGEX = /^09\d{9}$/;
const OTP_LENGTH = 4;
const RESEND_SECONDS = 60;
const NOT_ADMIN_MESSAGE = "این شماره دسترسی مدیریتی ندارد";

type Method = "password" | "otp";

export function AdminLoginClient() {
  const router = useRouter();
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  const [method, setMethod] = useState<Method>("password");

  // Already signed in as an admin (e.g. login opened in another tab) → straight to the panel.
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((user) => {
        if (!cancelled && isAdminRole(user.role)) router.replace(returnTo);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router, returnTo]);

  const handleSuccess = () => router.replace(returnTo);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9F8] px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-8 shadow-sm shadow-gray-200/60">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="text-center text-lg font-extrabold text-gray-900">ورود به پنل مدیریت</h1>
        <p className="mx-auto mt-1.5 max-w-[260px] text-center text-xs leading-6 text-gray-400">
          با شماره تلفن و رمز عبور، یا کد پیامکی وارد شوید
        </p>

        <div role="tablist" className="mx-auto mt-6 flex max-w-[280px] gap-1 rounded-full bg-gray-50 p-1">
          <MethodTab active={method === "password"} onClick={() => setMethod("password")} icon={KeyRound}>
            رمز عبور
          </MethodTab>
          <MethodTab active={method === "otp"} onClick={() => setMethod("otp")} icon={MessageSquareText}>
            کد پیامکی
          </MethodTab>
        </div>

        <div className="mt-6">
          {method === "password" ? (
            <PasswordLoginForm onSuccess={handleSuccess} onUseOtp={() => setMethod("otp")} />
          ) : (
            <OtpLoginForm onSuccess={handleSuccess} />
          )}
        </div>
      </div>
    </div>
  );
}

function MethodTab(props: {
  active: boolean;
  onClick: () => void;
  icon: typeof KeyRound;
  children: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <button
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={cn(
        "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full py-2 text-xs font-bold transition",
        props.active ? "bg-white text-emerald-600 shadow-sm" : "text-gray-400 hover:text-gray-600",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {props.children}
    </button>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-center text-xs font-medium text-red-500">
      {message}
    </p>
  );
}

const digitsOnly = (value: string, max: number) => value.replace(/\D/g, "").slice(0, max);

function PasswordLoginForm({ onSuccess, onUseOtp }: { onSuccess: () => void; onUseOtp: () => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!PHONE_REGEX.test(phone)) return setError("شماره موبایل را به‌درستی وارد کنید");
    if (!password) return setError("رمز عبور را وارد کنید");
    setLoading(true);
    try {
      const { user } = await loginWithPassword(phone, password);
      if (!isAdminRole(user.role)) {
        setError("شماره تلفن یا رمز عبور اشتباه است");
        return;
      }
      onSuccess();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "NO_PASSWORD_SET") {
        setError("برای این حساب هنوز رمز عبوری تنظیم نشده — از کد پیامکی استفاده کنید");
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="flex flex-col gap-3"
    >
      <Input
        label="شماره موبایل"
        icon={Phone}
        type="tel"
        inputMode="numeric"
        autoComplete="username"
        dir="ltr"
        autoFocus
        placeholder="09123456789"
        value={phone}
        onChange={(e) => setPhone(digitsOnly(e.target.value, 11))}
        className="text-base tracking-wider"
      />
      <Input
        label="رمز عبور"
        icon={Lock}
        type="password"
        autoComplete="current-password"
        dir="ltr"
        placeholder="رمز عبور"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <FormError message={error} />

      <Button type="submit" isLoading={loading}>
        ورود
      </Button>

      <button
        type="button"
        onClick={onUseOtp}
        className="cursor-pointer pt-1 text-center text-[11px] font-medium text-gray-400 hover:text-emerald-600"
      >
        رمز عبور را فراموش کرده‌اید؟ با کد پیامکی وارد شوید
      </button>
    </form>
  );
}

function OtpLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const send = async (afterSent: () => void) => {
    setError(null);
    setLoading(true);
    try {
      await requestOtp(phone);
      afterSent();
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = () => {
    if (!PHONE_REGEX.test(phone)) return setError("شماره موبایل را به‌درستی وارد کنید");
    void send(() => setStep("otp"));
  };

  const handleResend = () => {
    if (resendIn > 0) return;
    void send(() => setCode(""));
  };

  const handleVerify = async () => {
    setError(null);
    if (code.length !== OTP_LENGTH) return setError("کد ۴ رقمی را کامل وارد کنید");
    setLoading(true);
    try {
      const { user } = await verifyOtp(phone, code);
      if (!isAdminRole(user.role)) {
        // A valid phone but no admin access: it was just signed in as a plain customer — drop that session.
        await logoutCurrentSession().catch(() => undefined);
        setError(NOT_ADMIN_MESSAGE);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (step === "phone") {
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleRequest();
        }}
        className="flex flex-col gap-3"
      >
        <Input
          label="شماره موبایل"
          icon={Phone}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          dir="ltr"
          autoFocus
          placeholder="09123456789"
          value={phone}
          onChange={(e) => setPhone(digitsOnly(e.target.value, 11))}
          className="text-base tracking-wider"
        />
        <FormError message={error} />
        <Button type="submit" isLoading={loading}>
          ارسال کد
        </Button>
      </form>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void handleVerify();
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-center text-xs text-gray-400">کد ۴ رقمی برای {phone} پیامک شد</p>
      <Input
        label="کد تأیید"
        icon={Lock}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        autoFocus
        maxLength={OTP_LENGTH}
        placeholder="----"
        value={code}
        onChange={(e) => setCode(digitsOnly(e.target.value, OTP_LENGTH))}
        className="text-lg font-extrabold tracking-[0.6em]"
      />
      <FormError message={error} />
      <Button type="submit" isLoading={loading}>
        تأیید و ورود
      </Button>
      <div className="flex items-center justify-between px-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setStep("phone");
          }}
          className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600"
        >
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
          ویرایش شماره
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={resendIn > 0 || loading}
          className="cursor-pointer text-[11px] font-medium text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          {resendIn > 0 ? `ارسال مجدد تا ${resendIn} ثانیه` : "ارسال مجدد کد"}
        </button>
      </div>
    </form>
  );
}
