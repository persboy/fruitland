import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

const api = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  loginWithPassword: vi.fn(),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  logoutCurrentSession: vi.fn(),
}));
vi.mock("@/lib/client/adminAuth", async (orig) => ({ ...(await orig<typeof import("@/lib/client/adminAuth")>()), ...api }));

import { AdminLoginClient } from "./AdminLoginClient";

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("AdminLoginClient", () => {
  beforeEach(() => {
    search = "";
    replace.mockReset();
    Object.values(api).forEach((f) => f.mockReset());
    api.fetchCurrentUser.mockRejectedValue(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    api.logoutCurrentSession.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("validates phone and password before calling the API", async () => {
    render(<AdminLoginClient />);
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("شماره موبایل را به‌درستی وارد کنید");
    fill("شماره موبایل", "09120000000");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByText("رمز عبور را وارد کنید")).toBeInTheDocument();
    expect(api.loginWithPassword).not.toHaveBeenCalled();
  });

  it("keeps only digits in the phone field (max 11)", () => {
    render(<AdminLoginClient />);
    fill("شماره موبایل", "0912-abc-000 0000999");
    expect(screen.getByLabelText("شماره موبایل")).toHaveValue("09120000000");
  });

  it("logs in with password and goes to /admin", async () => {
    api.loginWithPassword.mockResolvedValue({ user: { phone: "09120000000", role: "admin" } });
    render(<AdminLoginClient />);
    fill("شماره موبایل", "09120000000");
    fill("رمز عبور", "secret-pass");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
    expect(api.loginWithPassword).toHaveBeenCalledWith("09120000000", "secret-pass");
  });

  it("honors a safe returnTo but ignores anything outside /admin", async () => {
    api.loginWithPassword.mockResolvedValue({ user: { phone: "09120000000", role: "admin" } });
    search = "returnTo=/admin/orders";
    const { unmount } = render(<AdminLoginClient />);
    fill("شماره موبایل", "09120000000");
    fill("رمز عبور", "x");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/orders"));
    unmount();

    replace.mockReset();
    search = "returnTo=https://evil.example";
    render(<AdminLoginClient />);
    fill("شماره موبایل", "09120000000");
    fill("رمز عبور", "x");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });

  it("shows the server's Persian error on wrong credentials", async () => {
    api.loginWithPassword.mockRejectedValue(new ApiClientError(401, "INVALID_CREDENTIALS", "شماره تلفن یا رمز عبور اشتباه است"));
    render(<AdminLoginClient />);
    fill("شماره موبایل", "09120000000");
    fill("رمز عبور", "bad");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("شماره تلفن یا رمز عبور اشتباه است");
    expect(replace).not.toHaveBeenCalled();
  });

  it("points to the SMS code when the account has no password yet", async () => {
    api.loginWithPassword.mockRejectedValue(new ApiClientError(401, "NO_PASSWORD_SET", "x"));
    render(<AdminLoginClient />);
    fill("شماره موبایل", "09120000000");
    fill("رمز عبور", "x");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("از کد پیامکی استفاده کنید");
  });

  it("shows a network-failure message when the server cannot be reached", async () => {
    api.loginWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AdminLoginClient />);
    fill("شماره موبایل", "09120000000");
    fill("رمز عبور", "x");
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ارتباط با سرور برقرار نشد");
  });

  it("SMS tab: sends the code, then verifies it and signs an admin in", async () => {
    api.requestOtp.mockResolvedValue({ phone: "09120000000" });
    api.verifyOtp.mockResolvedValue({ user: { phone: "09120000000", role: "master_admin" } });
    render(<AdminLoginClient />);
    fireEvent.click(screen.getByRole("tab", { name: "کد پیامکی" }));
    fill("شماره موبایل", "09120000000");
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد" }));
    expect(await screen.findByText("کد ۴ رقمی برای 09120000000 پیامک شد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ارسال مجدد تا/ })).toBeDisabled();

    fill("کد تأیید", "12");
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("کد ۴ رقمی را کامل وارد کنید");

    fill("کد تأیید", "1234");
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ورود" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
    expect(api.verifyOtp).toHaveBeenCalledWith("09120000000", "1234");
  });

  it("SMS tab: a valid non-admin phone is signed out again and told it has no admin access", async () => {
    api.requestOtp.mockResolvedValue({ phone: "09120000000" });
    api.verifyOtp.mockResolvedValue({ user: { phone: "09120000000", role: "customer" } });
    render(<AdminLoginClient />);
    fireEvent.click(screen.getByRole("tab", { name: "کد پیامکی" }));
    fill("شماره موبایل", "09120000000");
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد" }));
    await screen.findByLabelText("کد تأیید");
    fill("کد تأیید", "1234");
    fireEvent.click(screen.getByRole("button", { name: "تأیید و ورود" }));
    expect(await screen.findByText("این شماره دسترسی مدیریتی ندارد")).toBeInTheDocument();
    expect(api.logoutCurrentSession).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects straight to the panel when already signed in as admin", async () => {
    api.fetchCurrentUser.mockResolvedValue({ phone: "09120000000", role: "master_admin" });
    render(<AdminLoginClient />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });
});
