import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const api = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  fetchSetupStatus: vi.fn(),
  loginWithPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  requestSetupOtp: vi.fn(),
  verifySetupOtp: vi.fn(),
  setInitialPassword: vi.fn(),
  logoutCurrentSession: vi.fn(),
}));
vi.mock("@/lib/client/adminAuth", async (orig) => ({ ...(await orig<typeof import("@/lib/client/adminAuth")>()), ...api }));

import { AdminLoginFlow } from "./AdminLoginFlow";

describe("AdminLoginFlow", () => {
  beforeEach(() => {
    replace.mockReset();
    Object.values(api).forEach((f) => f.mockReset());
    api.fetchCurrentUser.mockRejectedValue(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    api.fetchSetupStatus.mockResolvedValue({ setupRequired: false });
    api.logoutCurrentSession.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("shows required-field errors without calling the API", async () => {
    render(<AdminLoginFlow />);
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByText("شماره موبایل الزامی است")).toBeInTheDocument();
    expect(screen.getByText("رمز عبور الزامی است")).toBeInTheDocument();
    expect(api.loginWithPassword).not.toHaveBeenCalled();
  });

  it("logs in and redirects to /admin", async () => {
    api.loginWithPassword.mockResolvedValue({ user: { phone: "0912", role: "admin" } });
    render(<AdminLoginFlow />);
    fireEvent.change(screen.getByLabelText("شماره موبایل"), { target: { value: "09120000000" } });
    fireEvent.change(screen.getByLabelText("رمز عبور"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
    expect(api.loginWithPassword).toHaveBeenCalledWith("09120000000", "secret-pass");
  });

  it("shows the server's Persian error on wrong credentials", async () => {
    api.loginWithPassword.mockRejectedValue(new ApiClientError(401, "INVALID_CREDENTIALS", "شماره تلفن یا رمز عبور اشتباه است"));
    render(<AdminLoginFlow />);
    fireEvent.change(screen.getByLabelText("شماره موبایل"), { target: { value: "09120000000" } });
    fireEvent.change(screen.getByLabelText("رمز عبور"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("شماره تلفن یا رمز عبور اشتباه است");
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a network-failure message when the request cannot reach the server", async () => {
    api.loginWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AdminLoginFlow />);
    fireEvent.change(screen.getByLabelText("شماره موبایل"), { target: { value: "09120000000" } });
    fireEvent.change(screen.getByLabelText("رمز عبور"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ارتباط با سرور برقرار نشد");
  });

  it("hides the first-time setup link once setup is done", async () => {
    render(<AdminLoginFlow />);
    await waitFor(() => expect(api.fetchSetupStatus).toHaveBeenCalled());
    expect(screen.queryByText("راه‌اندازی اولیه سیستم")).not.toBeInTheDocument();
  });

  it("offers setup while no master admin exists and walks OTP → password", async () => {
    api.fetchSetupStatus.mockResolvedValue({ setupRequired: true });
    api.requestSetupOtp.mockResolvedValue({ phone: "09120000000" });
    api.verifySetupOtp.mockResolvedValue({ user: { phone: "09120000000", role: "master_admin" } });
    api.setInitialPassword.mockResolvedValue(null);
    render(<AdminLoginFlow />);

    fireEvent.click(await screen.findByText("راه‌اندازی اولیه سیستم"));
    fireEvent.change(screen.getByLabelText("شماره موبایل"), { target: { value: "09120000000" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد" }));
    fireEvent.change(await screen.findByLabelText("کد تأیید"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید" }));

    fireEvent.change(await screen.findByLabelText("رمز عبور"), { target: { value: "long-enough-pass" } });
    fireEvent.change(screen.getByLabelText("تکرار رمز عبور"), { target: { value: "long-enough-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره و ورود" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
    expect(api.setInitialPassword).toHaveBeenCalledWith("long-enough-pass");
  });

  it("if someone else claimed MASTER_ADMIN first, drops the customer session and says so", async () => {
    api.fetchSetupStatus.mockResolvedValue({ setupRequired: true });
    api.requestSetupOtp.mockResolvedValue({ phone: "09120000000" });
    api.verifySetupOtp.mockResolvedValue({ user: { phone: "09120000000", role: "customer" } });
    render(<AdminLoginFlow />);
    fireEvent.click(await screen.findByText("راه‌اندازی اولیه سیستم"));
    fireEvent.change(screen.getByLabelText("شماره موبایل"), { target: { value: "09120000000" } });
    fireEvent.click(screen.getByRole("button", { name: "ارسال کد" }));
    fireEvent.change(await screen.findByLabelText("کد تأیید"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "تأیید" }));
    expect(await screen.findByText("راه‌اندازی اولیه قبلاً انجام شده است.")).toBeInTheDocument();
    expect(api.logoutCurrentSession).toHaveBeenCalled();
  });

  it("redirects straight to /admin when already signed in as admin", async () => {
    api.fetchCurrentUser.mockResolvedValue({ phone: "0912", role: "master_admin" });
    render(<AdminLoginFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });
});
