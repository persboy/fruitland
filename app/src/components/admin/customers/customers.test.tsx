import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { CustomerDetailDto, CustomerListItemDto } from "@fruitland/shared";

const nav = vi.hoisted(() => {
  const store = { search: "", listeners: new Set<() => void>(), push: [] as string[], replace: [] as string[] };
  const set = (url: string) => {
    store.search = url.includes("?") ? url.split("?")[1]! : "";
    store.listeners.forEach((l) => l());
  };
  return { store, set };
});
vi.mock("next/navigation", async () => {
  const React = await import("react");
  const subscribe = (l: () => void) => {
    nav.store.listeners.add(l);
    return () => nav.store.listeners.delete(l);
  };
  return {
    usePathname: () => "/admin/customers",
    useRouter: () => ({
      push: (url: string) => { nav.store.push.push(url); nav.set(url); },
      replace: (url: string) => { nav.store.replace.push(url); nav.set(url); },
    }),
    useSearchParams: () => {
      const search = React.useSyncExternalStore(subscribe, () => nav.store.search, () => nav.store.search);
      return new URLSearchParams(search);
    },
  };
});

const api = vi.hoisted(() => ({ fetchCustomers: vi.fn(), fetchCustomer: vi.fn(), updateCustomerProfile: vi.fn(), setCustomerActive: vi.fn() }));
vi.mock("@/lib/client/adminCustomers", () => api);

import { CustomersManager } from "./CustomersManager";
import { CustomerDetail } from "./CustomerDetail";

const T = "2026-01-01T10:00:00.000Z";
const row = (over: Partial<CustomerListItemDto> = {}): CustomerListItemDto => ({ id: "c1", firstName: "علی", lastName: "رضایی", phone: "09120000001", isActive: true, createdAt: T, ...over });
const detail = (over: Partial<CustomerDetailDto> = {}): CustomerDetailDto => ({ ...row(), birthDate: "1990-05-17", lastLoginAt: T, updatedAt: T, addresses: [], ...over });
const page = (items: CustomerListItemDto[], total = items.length, p = 1) => ({ data: items, pagination: { page: p, pageSize: 20, total } });
const addr = { id: "a1", label: "home", recipientName: "علی", phone: "0912", province: "تهران", city: "تهران", addressLine: "خیابان آزادی", postalCode: "1234567890", isDefault: true };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  nav.store.search = "";
  nav.store.push = [];
  nav.store.replace = [];
  nav.store.listeners.clear();
  api.fetchCustomers.mockResolvedValue(page([row()]));
});
afterEach(cleanup);

describe("CustomersManager — list", () => {
  it("shows a loading state, then the customers with name, phone, status, Jalali registration date and a details link", async () => {
    render(<CustomersManager />);
    expect(screen.getByRole("status", { name: "در حال دریافت مشتریان" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("علی");
    expect(cells[1]).toHaveTextContent("رضایی");
    expect(cells[2]).toHaveTextContent("09120000001");
    expect(cells[3]).toHaveTextContent("فعال");
    expect(cells[4]!.textContent).toMatch(/[۰-۹]/); // Persian digits (Jalali)
    expect(screen.getByRole("link", { name: "جزئیات علی رضایی" })).toHaveAttribute("href", "/admin/customers/c1");
    expect(api.fetchCustomers).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, status: "all" });
  });

  it("shows inactive customers and a placeholder for missing names; no create/delete/edit controls", async () => {
    api.fetchCustomers.mockResolvedValue(page([row({ isActive: false, firstName: null, lastName: null })]));
    render(<CustomersManager />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("غیرفعال")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "جزئیات بدون نام" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف|ایجاد|افزودن|مشتری جدید/ })).not.toBeInTheDocument();
  });

  it("empty state without filters", async () => {
    api.fetchCustomers.mockResolvedValue(page([]));
    render(<CustomersManager />);
    expect(await screen.findByText("هنوز مشتری‌ای ثبت‌نام نکرده است")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "صفحه‌بندی مشتریان" })).not.toBeInTheDocument();
  });

  it("empty state with a filter offers to clear it", async () => {
    nav.store.search = "q=zzz";
    api.fetchCustomers.mockResolvedValue(page([]));
    render(<CustomersManager />);
    expect(await screen.findByText("مشتری‌ای با این شرایط پیدا نشد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "پاک‌کردن جست‌وجو و فیلتر" }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/customers"));
  });

  it("error state shows the message and retry reloads", async () => {
    api.fetchCustomers.mockRejectedValueOnce(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<CustomersManager />);
    expect(await screen.findByText("دریافت مشتریان انجام نشد")).toBeInTheDocument();
    expect(screen.getByText("خطای داخلی سرور رخ داد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("403 → forbidden state; 401 → session-expired state with returnTo=/admin/customers", async () => {
    api.fetchCustomers.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    const first = render(<CustomersManager />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    first.unmount();
    api.fetchCustomers.mockRejectedValueOnce(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<CustomersManager />);
    expect(await screen.findByText("نشست شما منقضی شده است")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute("href", `/admin/login?returnTo=${encodeURIComponent("/admin/customers")}`);
  });

  it("restores q, status and page from the URL (survives reload/back/forward) and falls back safely on garbage", async () => {
    nav.store.search = `q=${encodeURIComponent("علی")}&status=inactive&page=2`;
    api.fetchCustomers.mockResolvedValue(page([row()], 45, 2));
    render(<CustomersManager />);
    await screen.findByRole("table");
    expect(api.fetchCustomers).toHaveBeenCalledWith({ page: 2, limit: 20, search: "علی", status: "inactive" });
    expect(screen.getByLabelText(/جست‌وجو/)).toHaveValue("علی");
    expect(screen.getByLabelText("وضعیت حساب")).toHaveValue("inactive");
    cleanup();
    api.fetchCustomers.mockClear();
    nav.store.search = "page=-3&status=hacked";
    render(<CustomersManager />);
    await screen.findByRole("table");
    expect(api.fetchCustomers).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, status: "all" });
  });
});

describe("CustomersManager — search, filter, pagination", () => {
  it("search is debounced (no request per keystroke), goes into the URL, and resets to page 1", async () => {
    nav.store.search = "page=3";
    api.fetchCustomers.mockResolvedValue(page([row()], 80, 3));
    render(<CustomersManager />);
    await screen.findByRole("table");
    api.fetchCustomers.mockClear();
    const box = screen.getByLabelText(/جست‌وجو/);
    fireEvent.change(box, { target: { value: "ع" } });
    fireEvent.change(box, { target: { value: "عل" } });
    fireEvent.change(box, { target: { value: "علی" } });
    expect(api.fetchCustomers).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe(`/admin/customers?q=${encodeURIComponent("علی")}`), { timeout: 2000 });
    await waitFor(() => expect(api.fetchCustomers).toHaveBeenCalledTimes(1));
    expect(api.fetchCustomers).toHaveBeenCalledWith({ page: 1, limit: 20, search: "علی", status: "all" });
  });

  it("status filter pushes the URL (history entry) and resets to page 1", async () => {
    nav.store.search = "page=2";
    api.fetchCustomers.mockResolvedValue(page([row()], 45, 2));
    render(<CustomersManager />);
    await screen.findByRole("table");
    api.fetchCustomers.mockClear();
    fireEvent.change(screen.getByLabelText("وضعیت حساب"), { target: { value: "inactive" } });
    expect(nav.store.push.at(-1)).toBe("/admin/customers?status=inactive");
    await waitFor(() => expect(api.fetchCustomers).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, status: "inactive" }));
  });

  it("pagination shows page x of y and total, disables prev on the first page, and next/prev push the page", async () => {
    api.fetchCustomers.mockResolvedValue(page([row()], 45, 1));
    render(<CustomersManager />);
    const navEl = await screen.findByRole("navigation", { name: "صفحه‌بندی مشتریان" });
    expect(navEl).toHaveTextContent("صفحه ۱ از ۳");
    expect(navEl).toHaveTextContent("۴۵ مشتری");
    expect(within(navEl).getByRole("button", { name: /قبلی/ })).toBeDisabled();
    fireEvent.click(within(navEl).getByRole("button", { name: /بعدی/ }));
    expect(nav.store.push.at(-1)).toBe("/admin/customers?page=2");
    api.fetchCustomers.mockResolvedValue(page([row()], 45, 3));
    fireEvent.click(await screen.findByRole("button", { name: /بعدی/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /بعدی/ })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /قبلی/ }));
    expect(nav.store.push.at(-1)).toBe("/admin/customers?page=2");
  });

  it("a page beyond the results is replaced by the last available page", async () => {
    nav.store.search = "page=9";
    api.fetchCustomers.mockResolvedValueOnce(page([], 45, 9)).mockResolvedValue(page([row()], 45, 3));
    render(<CustomersManager />);
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe("/admin/customers?page=3"));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("CustomerDetail", () => {
  beforeEach(() => api.fetchCustomer.mockResolvedValue(detail({ addresses: [addr] })));

  it("shows the profile summary, Jalali dates, read-only phone, and read-only addresses without coordinates or edit actions", async () => {
    render(<CustomerDetail id="c1" />);
    expect(await screen.findByRole("heading", { name: "علی رضایی" })).toBeInTheDocument();
    expect(screen.getByText("09120000001")).toBeInTheDocument();
    expect(screen.getByText("فعال")).toBeInTheDocument();
    expect(screen.getByText(/خیابان آزادی/)).toBeInTheDocument();
    expect(screen.getByText("پیش‌فرض")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /موبایل|تلفن/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /آدرس|حذف|پیش‌فرض/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/عرض جغرافیایی|latitude|longitude/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("تاریخ تولد")).toHaveValue("1990-05-17");
    expect(screen.getByText(/تاریخ شمسی:/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /بازگشت به فهرست مشتریان/ })).toHaveAttribute("href", "/admin/customers");
  });

  it("no addresses → empty message", async () => {
    api.fetchCustomer.mockResolvedValue(detail());
    render(<CustomerDetail id="c1" />);
    expect(await screen.findByText("این مشتری آدرسی ثبت نکرده است.")).toBeInTheDocument();
  });

  it("loading, 404 error, 403 and 401 states", async () => {
    api.fetchCustomer.mockRejectedValueOnce(new ApiClientError(404, "CUSTOMER_NOT_FOUND", "مشتری یافت نشد"));
    const a = render(<CustomerDetail id="c1" />);
    expect(screen.getByRole("status", { name: "در حال دریافت مشتری" })).toBeInTheDocument();
    expect(await screen.findByText("مشتری یافت نشد")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    a.unmount();
    api.fetchCustomer.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    const b = render(<CustomerDetail id="c1" />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
    b.unmount();
    api.fetchCustomer.mockRejectedValueOnce(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<CustomerDetail id="c1" />);
    expect(await screen.findByRole("link", { name: "ورود" })).toHaveAttribute("href", `/admin/login?returnTo=${encodeURIComponent("/admin/customers/c1")}`);
  });

  it("editing sends only the changed fields and shows the saved values", async () => {
    api.updateCustomerProfile.mockResolvedValue(detail({ firstName: "حسن" }));
    render(<CustomerDetail id="c1" />);
    const form = await screen.findByRole("form", { name: "ویرایش پروفایل مشتری" });
    fireEvent.change(within(form).getByLabelText("نام"), { target: { value: "حسن" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateCustomerProfile).toHaveBeenCalledWith("c1", { firstName: "حسن" }));
    expect(await within(form).findByText("اطلاعات مشتری ذخیره شد")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "حسن رضایی" })).toBeInTheDocument();
  });

  it("birthDate edit is sent as YYYY-MM-DD", async () => {
    api.updateCustomerProfile.mockResolvedValue(detail({ birthDate: "1991-06-18" }));
    render(<CustomerDetail id="c1" />);
    const form = await screen.findByRole("form", { name: "ویرایش پروفایل مشتری" });
    fireEvent.change(within(form).getByLabelText("تاریخ تولد"), { target: { value: "1991-06-18" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateCustomerProfile).toHaveBeenCalledWith("c1", { birthDate: "1991-06-18" }));
  });

  it("validates before sending: future birth date, clearing the birth date, and no-change", async () => {
    render(<CustomerDetail id="c1" />);
    const form = await screen.findByRole("form", { name: "ویرایش پروفایل مشتری" });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText("تغییری برای ذخیره وجود ندارد")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("تاریخ تولد"), { target: { value: "2999-01-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText("تاریخ تولد نمی‌تواند در آینده باشد")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("تاریخ تولد"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText("حذف تاریخ تولد پشتیبانی نمی‌شود")).toBeInTheDocument();
    expect(api.updateCustomerProfile).not.toHaveBeenCalled();
  });

  it("a server error on save is shown inline and typed values are kept", async () => {
    api.updateCustomerProfile.mockRejectedValue(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<CustomerDetail id="c1" />);
    const form = await screen.findByRole("form", { name: "ویرایش پروفایل مشتری" });
    fireEvent.change(within(form).getByLabelText("نام‌خانوادگی"), { target: { value: "کریمی" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText("خطای داخلی سرور رخ داد")).toBeInTheDocument();
    expect(within(form).getByLabelText("نام‌خانوادگی")).toHaveValue("کریمی");
  });

  it("deactivate then activate use the dedicated status operation and update the badge", async () => {
    api.setCustomerActive.mockResolvedValueOnce(detail({ isActive: false })).mockResolvedValueOnce(detail({ isActive: true }));
    render(<CustomerDetail id="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: "غیرفعال‌سازی حساب" }));
    await waitFor(() => expect(api.setCustomerActive).toHaveBeenCalledWith("c1", false));
    expect(await screen.findByText("حساب مشتری غیرفعال شد")).toBeInTheDocument();
    expect(screen.getAllByText("غیرفعال").length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: "فعال‌سازی حساب" }));
    await waitFor(() => expect(api.setCustomerActive).toHaveBeenLastCalledWith("c1", true));
    expect(await screen.findByText("حساب مشتری فعال شد")).toBeInTheDocument();
  });

  it("a failing status change shows an error and keeps the state", async () => {
    api.setCustomerActive.mockRejectedValue(new ApiClientError(404, "CUSTOMER_NOT_FOUND", "مشتری یافت نشد"));
    render(<CustomerDetail id="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: "غیرفعال‌سازی حساب" }));
    expect(await screen.findByText("مشتری یافت نشد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "غیرفعال‌سازی حساب" })).toBeInTheDocument();
  });
});
