import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { SessionUser } from "@/lib/client/adminAuth";

const api = vi.hoisted(() => ({
  fetchStoreSettings: vi.fn(),
  saveStoreSettings: vi.fn(),
  fetchShippingSettings: vi.fn(),
  saveShippingSettings: vi.fn(),
  saveProfileName: vi.fn(),
  requestPhoneChange: vi.fn(),
  confirmPhoneChange: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock("@/lib/client/adminSettings", () => api);

import { AdminUserContext } from "../AdminUserContext";
import { DeliverySettingsCard } from "./DeliverySettingsCard";
import { PaymentMethodsCard } from "./PaymentMethodsCard";
import { ProfileCard } from "./ProfileCard";
import { StoreInfoCard } from "./StoreInfoCard";

function WithUser({ initial, children }: { initial: SessionUser; children: React.ReactNode }) {
  const [user, setUser] = useState(initial);
  return <AdminUserContext.Provider value={{ user, updateUser: (p) => setUser((u) => ({ ...u, ...p })) }}>{children}</AdminUserContext.Provider>;
}

const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe("DeliverySettingsCard", () => {
  it("shows an empty state (no invented defaults) and saves integer Toman typed with Persian digits", async () => {
    api.fetchShippingSettings.mockResolvedValue({ expressDeliveryFee: null, freeDeliveryThreshold: null, isConfigured: false });
    api.saveShippingSettings.mockResolvedValue({ expressDeliveryFee: 25000, freeDeliveryThreshold: 500000, isConfigured: true });
    render(<DeliverySettingsCard />);

    fireEvent.click(await screen.findByRole("button", { name: /تعیین مبالغ ارسال/ }));
    fill(/هزینه ارسال فوری/, "۲۵٬۰۰۰");
    fill(/حداقل مبلغ برای ارسال رایگان/, "500000");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(api.saveShippingSettings).toHaveBeenCalledWith({ expressDeliveryFee: 25000, freeDeliveryThreshold: 500000 }));
    expect(await screen.findByText("۲۵٬۰۰۰ تومان")).toBeInTheDocument();
    expect(screen.getByText("تنظیمات ارسال ذخیره شد")).toBeInTheDocument();
  });

  it("formats typed digits live with the Persian thousands separator, and blocks decimals/letters", async () => {
    api.fetchShippingSettings.mockResolvedValue({ expressDeliveryFee: 1000, freeDeliveryThreshold: 2000, isConfigured: true });
    render(<DeliverySettingsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));
    expect(screen.getByLabelText(/هزینه ارسال فوری/)).toHaveValue("۱٬۰۰۰"); // initial value is formatted too
    fill(/هزینه ارسال فوری/, "1234567");
    expect(screen.getByLabelText(/هزینه ارسال فوری/)).toHaveValue("۱٬۲۳۴٬۵۶۷");
    fill(/هزینه ارسال فوری/, "12.5abc");
    expect(screen.getByLabelText(/هزینه ارسال فوری/)).toHaveValue("۱۲۵");
  });

  it("rejects an empty amount without calling the API", async () => {
    api.fetchShippingSettings.mockResolvedValue({ expressDeliveryFee: 1000, freeDeliveryThreshold: 2000, isConfigured: true });
    render(<DeliverySettingsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));
    fill(/هزینه ارسال فوری/, "");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("عدد صحیح");
    expect(api.saveShippingSettings).not.toHaveBeenCalled();
  });

  it("shows a load error with retry", async () => {
    api.fetchShippingSettings.mockRejectedValueOnce(new ApiClientError(500, "X", "خطای داخلی سرور رخ داد"));
    api.fetchShippingSettings.mockResolvedValueOnce({ expressDeliveryFee: 1000, freeDeliveryThreshold: 2000, isConfigured: true });
    render(<DeliverySettingsCard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("خطای داخلی سرور رخ داد");
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByText("۱٬۰۰۰ تومان")).toBeInTheDocument();
  });
});

describe("StoreInfoCard", () => {
  it("validates required fields, then saves and shows the stored values", async () => {
    api.fetchStoreSettings.mockResolvedValue({ storeName: "", supportPhone: "", address: "", isConfigured: false });
    api.saveStoreSettings.mockResolvedValue({ storeName: "پرزبوی", supportPhone: "02412345678", address: "", isConfigured: true });
    render(<StoreInfoCard />);
    fireEvent.click(await screen.findByRole("button", { name: /ثبت اطلاعات فروشگاه/ }));

    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("نام فروشگاه الزامی است");
    expect(api.saveStoreSettings).not.toHaveBeenCalled();

    fill("نام فروشگاه", "پرزبوی");
    fill("شماره پشتیبانی", "02412345678");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("اطلاعات فروشگاه ذخیره شد")).toBeInTheDocument();
    expect(screen.getByText("پرزبوی")).toBeInTheDocument();
  });
});

describe("PaymentMethodsCard", () => {
  it("lists only cash-on-delivery", () => {
    render(<PaymentMethodsCard />);
    expect(screen.getByText("پرداخت در محل (COD)")).toBeInTheDocument();
    expect(screen.queryByText(/آنلاین/)).not.toBeInTheDocument();
  });
});

describe("ProfileCard", () => {
  const admin: SessionUser = { phone: "09120000100", role: "master_admin", hasPassword: false };

  it("uses the generic name until one is saved, then shows the saved name", async () => {
    api.saveProfileName.mockResolvedValue({ firstName: "علی", lastName: "رضایی", phone: admin.phone, role: admin.role });
    render(
      <WithUser initial={admin}>
        <ProfileCard />
      </WithUser>,
    );
    expect(screen.getByText("ادمین")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ویرایش نام/ }));
    fill("نام", "علی");
    fill("نام خانوادگی", "رضایی");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("علی رضایی")).toBeInTheDocument();
    expect(api.saveProfileName).toHaveBeenCalledWith({ firstName: "علی", lastName: "رضایی" });
  });

  it("phone change: code goes to the NEW number, confirming updates the shown phone", async () => {
    api.requestPhoneChange.mockResolvedValue(null);
    api.confirmPhoneChange.mockResolvedValue({ phone: "09120000101", role: "master_admin" });
    render(
      <WithUser initial={admin}>
        <ProfileCard />
      </WithUser>,
    );
    fireEvent.click(screen.getByRole("button", { name: /تغییر شماره موبایل/ }));
    fill(/شماره‌ی موبایل جدید/, "0912"); // too short
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("شماره موبایل را به‌درستی وارد کنید");
    expect(api.requestPhoneChange).not.toHaveBeenCalled();

    fill(/شماره‌ی موبایل جدید/, "09120000101");
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد" }));
    await waitFor(() => expect(api.requestPhoneChange).toHaveBeenCalledWith("09120000101"));

    fill(/کد تأیید ارسال‌شده/, "1234");
    fireEvent.click(screen.getByRole("button", { name: "تأیید و تغییر شماره" }));
    await waitFor(() => expect(api.confirmPhoneChange).toHaveBeenCalledWith("09120000101", "1234"));
    expect(await screen.findByText(/09120000101/)).toBeInTheDocument();
    expect(screen.getByText("شماره‌ی موبایل تغییر کرد")).toBeInTheDocument();
  });

  it("phone change: surfaces a server error such as an already-registered number", async () => {
    api.requestPhoneChange.mockRejectedValue(new ApiClientError(409, "PHONE_ALREADY_REGISTERED", "این شماره قبلاً در سیستم ثبت شده است"));
    render(
      <WithUser initial={admin}>
        <ProfileCard />
      </WithUser>,
    );
    fireEvent.click(screen.getByRole("button", { name: /تغییر شماره موبایل/ }));
    fill(/شماره‌ی موبایل جدید/, "09120000102");
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("قبلاً در سیستم ثبت شده");
  });

  it("first password: no current-password field; save is blocked until valid and matching", async () => {
    api.changePassword.mockResolvedValue(null);
    render(
      <WithUser initial={admin}>
        <ProfileCard />
      </WithUser>,
    );
    fireEvent.click(screen.getByRole("button", { name: "تعیین رمز عبور" }));
    expect(screen.queryByLabelText("رمز عبور فعلی")).not.toBeInTheDocument();

    const save = screen.getByRole("button", { name: "ذخیره رمز عبور" });
    expect(save).toBeDisabled();
    fill("رمز عبور جدید", "short");
    expect(await screen.findByText("رمز عبور باید حداقل ۸ کاراکتر باشد")).toBeInTheDocument();
    fill("رمز عبور جدید", "long-enough-1");
    fill("تکرار رمز عبور", "different-1");
    expect(screen.getByText("رمز عبور و تکرار آن یکسان نیستند")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fill("تکرار رمز عبور", "long-enough-1");
    fireEvent.click(save);
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith({ currentPassword: undefined, newPassword: "long-enough-1" }));
    expect(await screen.findByText("رمز عبور با موفقیت ذخیره شد")).toBeInTheDocument();
    // now that a password exists, the button label changes
    expect(screen.getByRole("button", { name: "تغییر رمز عبور" })).toBeInTheDocument();
  });

  it("changing an existing password requires the current one and shows a wrong-current error", async () => {
    api.changePassword.mockRejectedValue(new ApiClientError(403, "CURRENT_PASSWORD_INVALID", "رمز عبور فعلی نادرست است"));
    render(
      <WithUser initial={{ ...admin, hasPassword: true }}>
        <ProfileCard />
      </WithUser>,
    );
    fireEvent.click(screen.getByRole("button", { name: "تغییر رمز عبور" }));
    const save = screen.getByRole("button", { name: "ذخیره رمز عبور" });
    fill("رمز عبور جدید", "long-enough-1");
    fill("تکرار رمز عبور", "long-enough-1");
    expect(save).toBeDisabled(); // current password still empty
    fill("رمز عبور فعلی", "wrong-guess");
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("رمز عبور فعلی نادرست است");
    expect(api.changePassword).toHaveBeenCalledWith({ currentPassword: "wrong-guess", newPassword: "long-enough-1" });
  });
});
