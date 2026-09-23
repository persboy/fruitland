"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button, Card, Input } from "@/components/ui";
import {
  confirmPasswordReset,
  errorMessage,
  fetchCurrentUser,
  fetchSetupStatus,
  isAdminRole,
  loginWithPassword,
  logoutCurrentSession,
  requestPasswordReset,
  requestSetupOtp,
  setInitialPassword,
  verifySetupOtp,
} from "@/lib/client/adminAuth";

type View = "login" | "reset-request" | "reset-confirm" | "setup-phone" | "setup-code" | "setup-password";

const phoneRules = { required: "شماره موبایل الزامی است" };
const codeRules = { required: "کد پیامک‌شده الزامی است" };
const newPasswordRules = {
  required: "رمز عبور الزامی است",
  minLength: { value: 8, message: "رمز عبور باید حداقل ۸ نویسه باشد" },
};

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-500/10 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  );
}

function TextLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 text-sm font-medium text-brand-600 underline underline-offset-4">
      {children}
    </button>
  );
}

export function AdminLoginFlow() {
  const router = useRouter();
  const [view, setView] = useState<View>("login");
  const [setupRequired, setSetupRequired] = useState(false);
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Already signed in as an admin → skip the form. Also learn whether first-time setup is still open.
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((user) => {
        if (!cancelled && isAdminRole(user.role)) router.replace("/admin");
      })
      .catch(() => undefined);
    fetchSetupStatus()
      .then((s) => !cancelled && setSetupRequired(s.setupRequired))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  const goTo = (next: View, message: string | null = null) => {
    setNotice(message);
    setView(next);
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      {notice && (
        <p role="status" className="rounded-md bg-brand-500/10 px-3 py-2 text-sm text-brand-600">
          {notice}
        </p>
      )}

      {view === "login" && (
        <LoginView
          onForgot={() => goTo("reset-request")}
          onSuccess={() => router.replace("/admin")}
          setupRequired={setupRequired}
          onSetup={() => goTo("setup-phone")}
        />
      )}
      {view === "reset-request" && (
        <PhoneStep
          title="بازیابی رمز عبور"
          description="شماره موبایل حساب مدیریتی خود را وارد کنید تا کد تأیید پیامک شود."
          submitLabel="ارسال کد"
          submit={async (p) => {
            await requestPasswordReset(p);
            setPhone(p);
            goTo("reset-confirm");
          }}
          onBack={() => goTo("login")}
        />
      )}
      {view === "reset-confirm" && (
        <ResetConfirmView phone={phone} onDone={() => goTo("login", "رمز عبور تغییر کرد. با رمز جدید وارد شوید.")} onBack={() => goTo("login")} />
      )}
      {view === "setup-phone" && (
        <PhoneStep
          title="راه‌اندازی اولیه"
          description="اولین کاربری که وارد شود، مدیر ارشد سیستم می‌شود. شماره موبایل خود را وارد کنید."
          submitLabel="ارسال کد"
          submit={async (p) => {
            await requestSetupOtp(p);
            setPhone(p);
            goTo("setup-code");
          }}
          onBack={() => goTo("login")}
        />
      )}
      {view === "setup-code" && (
        <SetupCodeView
          phone={phone}
          onVerified={() => goTo("setup-password")}
          onTaken={() => goTo("login", "راه‌اندازی اولیه قبلاً انجام شده است.")}
          onBack={() => goTo("setup-phone")}
        />
      )}
      {view === "setup-password" && <SetupPasswordView onDone={() => router.replace("/admin")} />}
    </Card>
  );
}

function LoginView(props: { onForgot: () => void; onSuccess: () => void; setupRequired: boolean; onSetup: () => void }) {
  const form = useForm<{ phone: string; password: string }>();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async ({ phone, password }) => {
    setError(null);
    try {
      const { user } = await loginWithPassword(phone, password);
      if (!isAdminRole(user.role)) {
        setError("شماره تلفن یا رمز عبور اشتباه است");
        return;
      }
      props.onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">ورود به پنل مدیریت</h1>
      <Input
        label="شماره موبایل"
        type="tel"
        inputMode="tel"
        dir="ltr"
        autoComplete="username"
        placeholder="09123456789"
        error={form.formState.errors.phone?.message}
        {...form.register("phone", phoneRules)}
      />
      <Input
        label="رمز عبور"
        type="password"
        dir="ltr"
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
        {...form.register("password", { required: "رمز عبور الزامی است" })}
      />
      <FormError message={error} />
      <Button type="submit" isLoading={form.formState.isSubmitting}>
        ورود
      </Button>
      <div className="flex flex-col items-start">
        <TextLink onClick={props.onForgot}>رمز عبور را فراموش کرده‌ام</TextLink>
        {props.setupRequired && <TextLink onClick={props.onSetup}>راه‌اندازی اولیه سیستم</TextLink>}
      </div>
    </form>
  );
}

function PhoneStep(props: {
  title: string;
  description: string;
  submitLabel: string;
  submit: (phone: string) => Promise<void>;
  onBack: () => void;
}) {
  const form = useForm<{ phone: string }>();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async ({ phone }) => {
    setError(null);
    try {
      await props.submit(phone);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">{props.title}</h1>
      <p className="text-sm text-muted">{props.description}</p>
      <Input
        label="شماره موبایل"
        type="tel"
        inputMode="tel"
        dir="ltr"
        autoComplete="tel"
        placeholder="09123456789"
        error={form.formState.errors.phone?.message}
        {...form.register("phone", phoneRules)}
      />
      <FormError message={error} />
      <Button type="submit" isLoading={form.formState.isSubmitting}>
        {props.submitLabel}
      </Button>
      <TextLink onClick={props.onBack}>بازگشت</TextLink>
    </form>
  );
}

function ResetConfirmView(props: { phone: string; onDone: () => void; onBack: () => void }) {
  const form = useForm<{ code: string; newPassword: string }>();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async ({ code, newPassword }) => {
    setError(null);
    try {
      await confirmPasswordReset(props.phone, code, newPassword);
      props.onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">تنظیم رمز عبور جدید</h1>
      <p className="text-sm text-muted">اگر این شماره متعلق به یک حساب مدیریتی باشد، کد تأیید پیامک شده است.</p>
      <Input
        label="کد تأیید"
        inputMode="numeric"
        dir="ltr"
        autoComplete="one-time-code"
        error={form.formState.errors.code?.message}
        {...form.register("code", codeRules)}
      />
      <Input
        label="رمز عبور جدید"
        type="password"
        dir="ltr"
        autoComplete="new-password"
        hint="حداقل ۸ نویسه"
        error={form.formState.errors.newPassword?.message}
        {...form.register("newPassword", newPasswordRules)}
      />
      <FormError message={error} />
      <Button type="submit" isLoading={form.formState.isSubmitting}>
        تغییر رمز عبور
      </Button>
      <TextLink onClick={props.onBack}>بازگشت به ورود</TextLink>
    </form>
  );
}

function SetupCodeView(props: { phone: string; onVerified: () => void; onTaken: () => void; onBack: () => void }) {
  const form = useForm<{ code: string }>();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async ({ code }) => {
    setError(null);
    try {
      const { user } = await verifySetupOtp(props.phone, code);
      if (user.role === "master_admin") {
        props.onVerified();
        return;
      }
      // Someone else claimed MASTER_ADMIN first: this phone just became a plain customer. Drop that session.
      await logoutCurrentSession().catch(() => undefined);
      props.onTaken();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">تأیید شماره موبایل</h1>
      <p className="text-sm text-muted">کد تأیید به {props.phone} پیامک شد.</p>
      <Input
        label="کد تأیید"
        inputMode="numeric"
        dir="ltr"
        autoComplete="one-time-code"
        error={form.formState.errors.code?.message}
        {...form.register("code", codeRules)}
      />
      <FormError message={error} />
      <Button type="submit" isLoading={form.formState.isSubmitting}>
        تأیید
      </Button>
      <TextLink onClick={props.onBack}>تغییر شماره</TextLink>
    </form>
  );
}

function SetupPasswordView({ onDone }: { onDone: () => void }) {
  const form = useForm<{ newPassword: string; confirm: string }>();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async ({ newPassword }) => {
    setError(null);
    try {
      await setInitialPassword(newPassword);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">تعیین رمز عبور</h1>
      <p className="text-sm text-muted">شما مدیر ارشد سیستم شدید. برای ورودهای بعدی یک رمز عبور تعیین کنید.</p>
      <Input
        label="رمز عبور"
        type="password"
        dir="ltr"
        autoComplete="new-password"
        hint="حداقل ۸ نویسه"
        error={form.formState.errors.newPassword?.message}
        {...form.register("newPassword", newPasswordRules)}
      />
      <Input
        label="تکرار رمز عبور"
        type="password"
        dir="ltr"
        autoComplete="new-password"
        error={form.formState.errors.confirm?.message}
        {...form.register("confirm", {
          required: "تکرار رمز عبور الزامی است",
          validate: (value) => value === form.getValues("newPassword") || "رمز عبور و تکرار آن یکسان نیست",
        })}
      />
      <FormError message={error} />
      <Button type="submit" isLoading={form.formState.isSubmitting}>
        ذخیره و ورود
      </Button>
    </form>
  );
}
