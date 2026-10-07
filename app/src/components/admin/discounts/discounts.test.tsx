import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { CustomerListItemDto, DiscountCodeDto } from "@fruitland/shared";

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
    usePathname: () => "/admin/discounts",
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

const api = vi.hoisted(() => ({ fetchDiscountCodes: vi.fn(), createDiscountCode: vi.fn(), updateDiscountCode: vi.fn(), setDiscountCodeActive: vi.fn() }));
vi.mock("@/lib/client/adminDiscountCodes", () => api);
const customersApi = vi.hoisted(() => ({ fetchCustomers: vi.fn() }));
vi.mock("@/lib/client/adminCustomers", () => customersApi);

import { DiscountCodesManager } from "./DiscountCodesManager";

const T = "2026-01-01T10:00:00.000Z";
const row = (over: Partial<DiscountCodeDto> = {}): DiscountCodeDto => ({
  id: "d1", code: "WELCOME10", type: "public", owner: null, percentage: 10, maxDiscountAmount: null, minOrderAmount: 0,
  usageLimit: null, usedCount: 0, isActive: true, status: "active", expiresAt: null, createdAt: T, updatedAt: T, ...over,
});
const personal = (over: Partial<DiscountCodeDto> = {}) =>
  row({ id: "d2", code: "ALI-ONLY", type: "personal", owner: { id: "c1", firstName: "علی", lastName: "رضایی", phone: "09120000001" }, ...over });
const page = (items: DiscountCodeDto[], total = items.length, p = 1) => ({ data: items, pagination: { page: p, pageSize: 20, total } });
const OWNER_ID = "64b7f0c2a1b2c3d4e5f60718";
const customer = (over: Partial<CustomerListItemDto> = {}): CustomerListItemDto => ({ id: OWNER_ID, firstName: "علی", lastName: "رضایی", phone: "09120000001", isActive: true, createdAt: T, ...over });

const setField = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openCreate = async () => {
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: /کد تخفیف جدید/ }));
  return screen.getByRole("form", { name: "کد تخفیف جدید" });
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  customersApi.fetchCustomers.mockReset();
  nav.store.search = "";
  nav.store.push = [];
  nav.store.replace = [];
  nav.store.listeners.clear();
  api.fetchDiscountCodes.mockResolvedValue(page([row()]));
});
afterEach(cleanup);

describe("DiscountCodesManager — list", () => {
  it("shows loading, then code, type, owner, percentage, usage, expiry, status and actions", async () => {
    api.fetchDiscountCodes.mockResolvedValue(page([personal({ usedCount: 3, usageLimit: 10, expiresAt: "2026-10-07T20:29:59.999Z", status: "active" }), row({ usedCount: 2 })]));
    render(<DiscountCodesManager />);
    expect(screen.getByRole("status", { name: "در حال دریافت کدهای تخفیف" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    const a = within(rows[1]!).getAllByRole("cell");
    expect(a[0]).toHaveTextContent("ALI-ONLY");
    expect(a[1]).toHaveTextContent("شخصی");
    expect(a[2]).toHaveTextContent("علی رضایی");
    expect(a[2]).toHaveTextContent("09120000001");
    expect(a[3]).toHaveTextContent("۱۰");
    expect(a[4]).toHaveTextContent("۳ از ۱۰");
    expect(a[5]!.textContent).toMatch(/[۰-۹]/); // Jalali expiry
    expect(a[6]).toHaveTextContent("فعال");
    const b = within(rows[2]!).getAllByRole("cell");
    expect(b[1]).toHaveTextContent("عمومی");
    expect(b[2]).toHaveTextContent("—");
    expect(b[4]).toHaveTextContent("۲ از نامحدود");
    expect(b[5]).toHaveTextContent("—");
    expect(api.fetchDiscountCodes).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, type: "all", status: "all" });
  });

  it.each([
    ["active", "فعال"],
    ["disabled", "غیرفعال"],
    ["exhausted", "تمام‌شده"],
    ["expired", "منقضی‌شده"],
  ] as const)("renders the %s status badge", async (status, label) => {
    api.fetchDiscountCodes.mockResolvedValue(page([row({ status })]));
    render(<DiscountCodesManager />);
    const cells = within(await screen.findByRole("table")).getAllByRole("row")[1]!;
    expect(within(cells).getAllByRole("cell")[6]).toHaveTextContent(label);
  });

  it("has no delete control anywhere", async () => {
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/حذف سخت|پاک‌کردن کد/)).not.toBeInTheDocument();
  });

  it("empty state (no filters) offers creation", async () => {
    api.fetchDiscountCodes.mockResolvedValue(page([]));
    render(<DiscountCodesManager />);
    expect(await screen.findByText("هنوز کد تخفیفی ساخته نشده است")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /کد تخفیف جدید/ })[0]!);
    expect(screen.getByRole("form", { name: "کد تخفیف جدید" })).toBeInTheDocument();
  });

  it("empty state with active filters offers to clear them", async () => {
    nav.store.search = "q=ZZZ&type=personal&status=expired";
    api.fetchDiscountCodes.mockResolvedValue(page([]));
    render(<DiscountCodesManager />);
    expect(await screen.findByText("کد تخفیفی با این شرایط پیدا نشد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "پاک‌کردن جست‌وجو و فیلترها" }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/discounts"));
  });

  it("error state shows the message and retry reloads", async () => {
    api.fetchDiscountCodes.mockRejectedValueOnce(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<DiscountCodesManager />);
    expect(await screen.findByText("دریافت کدهای تخفیف انجام نشد")).toBeInTheDocument();
    expect(screen.getByText("خطای داخلی سرور رخ داد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("network failure shows a Persian message", async () => {
    api.fetchDiscountCodes.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<DiscountCodesManager />);
    expect(await screen.findByText(/ارتباط با سرور برقرار نشد/)).toBeInTheDocument();
  });

  it("403 → forbidden; 401 → session expired with returnTo=/admin/discounts", async () => {
    api.fetchDiscountCodes.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    const first = render(<DiscountCodesManager />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
    first.unmount();
    api.fetchDiscountCodes.mockRejectedValueOnce(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<DiscountCodesManager />);
    expect(await screen.findByText("نشست شما منقضی شده است")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute("href", `/admin/login?returnTo=${encodeURIComponent("/admin/discounts")}`);
  });
});

describe("DiscountCodesManager — URL state, search, filters, pagination", () => {
  it("restores q, type, status and page from the URL and falls back safely on garbage", async () => {
    nav.store.search = "q=OFF&type=personal&status=expired&page=2";
    api.fetchDiscountCodes.mockResolvedValue(page([row()], 45, 2));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    expect(api.fetchDiscountCodes).toHaveBeenCalledWith({ page: 2, limit: 20, search: "OFF", type: "personal", status: "expired" });
    expect(screen.getByLabelText("جست‌وجوی کد تخفیف")).toHaveValue("OFF");
    expect(screen.getByLabelText("نوع")).toHaveValue("personal");
    expect(screen.getByLabelText("وضعیت")).toHaveValue("expired");
    cleanup();
    api.fetchDiscountCodes.mockClear();
    nav.store.search = "page=-3&type=hacked&status=deleted";
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    expect(api.fetchDiscountCodes).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, type: "all", status: "all" });
  });

  it("search is debounced (no request per keystroke), goes into the URL with replace, and resets to page 1", async () => {
    nav.store.search = "page=3";
    api.fetchDiscountCodes.mockResolvedValue(page([row()], 60, 3));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    api.fetchDiscountCodes.mockClear();
    const box = screen.getByLabelText("جست‌وجوی کد تخفیف");
    for (const v of ["O", "OF", "OFF"]) fireEvent.change(box, { target: { value: v } });
    expect(api.fetchDiscountCodes).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe("/admin/discounts?q=OFF"), { timeout: 2000 });
    await waitFor(() => expect(api.fetchDiscountCodes).toHaveBeenCalledTimes(1));
    expect(api.fetchDiscountCodes).toHaveBeenCalledWith({ page: 1, limit: 20, search: "OFF", type: "all", status: "all" });
  });

  it("changing type or status pushes to the URL and resets to page 1", async () => {
    nav.store.search = "page=2";
    api.fetchDiscountCodes.mockResolvedValue(page([row()], 45, 2));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("نوع"), { target: { value: "public" } });
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/discounts?type=public"));
    fireEvent.change(screen.getByLabelText("وضعیت"), { target: { value: "exhausted" } });
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/discounts?type=public&status=exhausted"));
    await waitFor(() => expect(api.fetchDiscountCodes).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: undefined, type: "public", status: "exhausted" }));
  });

  it("offers exactly the approved type and status filter values", async () => {
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    expect(within(screen.getByLabelText("نوع")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["all", "public", "personal"]);
    expect(within(screen.getByLabelText("وضعیت")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["all", "active", "disabled", "exhausted", "expired"]);
  });

  it("paginates with prev/next buttons and shows the total", async () => {
    api.fetchDiscountCodes.mockResolvedValue(page([row()], 45, 1));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    expect(screen.getByText(/صفحه ۱ از ۳ — ۴۵ کد/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /قبلی/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /بعدی/ }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/discounts?page=2"));
  });

  it("an out-of-range page falls back to the last page", async () => {
    nav.store.search = "page=9";
    api.fetchDiscountCodes.mockResolvedValueOnce(page([], 45, 9)).mockResolvedValue(page([row()], 45, 3));
    render(<DiscountCodesManager />);
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe("/admin/discounts?page=3"));
  });
});

describe("DiscountCodesManager — create", () => {
  it("opens the create form with the expected controls and no owner picker for a public code", async () => {
    render(<DiscountCodesManager />);
    const form = await openCreate();
    for (const label of ["کد تخفیف", "درصد تخفیف", "حداکثر مبلغ تخفیف (تومان)", "حداقل مبلغ سفارش (تومان)", "سقف تعداد استفاده", "تاریخ انقضا (اختیاری)"]) {
      expect(within(form).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(form).getByRole("button", { name: /تولید کد/ })).toBeInTheDocument();
    expect(within(form).getByRole("radio", { name: /عمومی/ })).toBeChecked();
    expect(screen.queryByLabelText(/مشتری مالک کد/)).not.toBeInTheDocument();
  });

  it("does not claim any Checkout semantics for the minimum order amount", async () => {
    render(<DiscountCodesManager />);
    const form = await openCreate();
    expect(form.textContent).not.toMatch(/قبل از تخفیف|بعد از تخفیف|هزینه‌ی ارسال|قبل از ارسال/);
  });

  it("creates a public code: Persian digits and lowercase are normalised, money shows live thousands separators, the values are parsed back to integers", async () => {
    api.createDiscountCode.mockResolvedValue(row({ id: "new" }));
    render(<DiscountCodesManager />);
    const form = await openCreate();
    setField("کد تخفیف", "welcome۱۰");
    setField("درصد تخفیف", "۱۰");
    setField("حداکثر مبلغ تخفیف (تومان)", "50000");
    expect(screen.getByLabelText("حداکثر مبلغ تخفیف (تومان)")).toHaveValue("۵۰٬۰۰۰");
    setField("حداقل مبلغ سفارش (تومان)", "۱۰۰۰۰۰");
    expect(screen.getByLabelText("حداقل مبلغ سفارش (تومان)")).toHaveValue("۱۰۰٬۰۰۰");
    setField("سقف تعداد استفاده", "1000");
    expect(screen.getByLabelText("سقف تعداد استفاده")).toHaveValue("۱٬۰۰۰");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createDiscountCode).toHaveBeenCalledTimes(1));
    expect(api.createDiscountCode).toHaveBeenCalledWith({
      code: "WELCOME10", type: "public", percentage: 10, maxDiscountAmount: 50000, minOrderAmount: 100000, usageLimit: 1000,
    });
    expect(await screen.findByText("کد تخفیف ایجاد شد")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "کد تخفیف جدید" })).not.toBeInTheDocument();
  });

  it("after a successful create the list is reloaded without filters, on page 1", async () => {
    nav.store.search = "q=ZZ&status=expired&page=2";
    api.fetchDiscountCodes.mockResolvedValue(page([row()], 45, 2));
    api.createDiscountCode.mockResolvedValue(row());
    render(<DiscountCodesManager />);
    const form = await openCreate();
    setField("کد تخفیف", "abc");
    setField("درصد تخفیف", "5");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/discounts"));
    await waitFor(() => expect(api.fetchDiscountCodes).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: undefined, type: "all", status: "all" }));
  });

  it("the percentage field accepts digits only (no decimals, no letters)", async () => {
    render(<DiscountCodesManager />);
    await openCreate();
    setField("درصد تخفیف", "10.5");
    expect(screen.getByLabelText("درصد تخفیف")).toHaveValue("105");
    setField("درصد تخفیف", "ab");
    expect(screen.getByLabelText("درصد تخفیف")).toHaveValue("");
  });

  it("the expiry date shows its Persian equivalent and the Tehran end-of-day note", async () => {
    render(<DiscountCodesManager />);
    await openCreate();
    expect(screen.queryByTestId("expiry-jalali")).not.toBeInTheDocument();
    setField("تاریخ انقضا (اختیاری)", "2026-10-07");
    const note = screen.getByTestId("expiry-jalali");
    expect(note.textContent).toMatch(/[۰-۹]/);
    expect(note.textContent).toMatch(/مهر/);
    expect(note.textContent).toMatch(/پایان همین روز.*تهران/);
    expect(screen.queryByLabelText(/شمسی/)).not.toBeInTheDocument(); // no direct Jalali entry
  });

  it("sends the chosen calendar day (not a timestamp) as expiresAt", async () => {
    api.createDiscountCode.mockResolvedValue(row());
    render(<DiscountCodesManager />);
    const form = await openCreate();
    setField("کد تخفیف", "EXPIRING");
    setField("درصد تخفیف", "20");
    setField("تاریخ انقضا (اختیاری)", "2026-10-07");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createDiscountCode).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: "2026-10-07" })));
  });

  it("generates a valid code, and it is only a suggestion (the server still decides uniqueness)", async () => {
    render(<DiscountCodesManager />);
    await openCreate();
    fireEvent.click(screen.getByRole("button", { name: /تولید کد/ }));
    const first = (screen.getByLabelText("کد تخفیف") as HTMLInputElement).value;
    expect(first).toMatch(/^[A-Z0-9_-]{3,30}$/);
    fireEvent.click(screen.getByRole("button", { name: /تولید کد/ }));
    expect((screen.getByLabelText("کد تخفیف") as HTMLInputElement).value).not.toBe(first);
  });

  it("client validation shows a Persian error and sends nothing (bad code, percentage out of range, missing percentage)", async () => {
    render(<DiscountCodesManager />);
    const form = await openCreate();
    const submit = () => fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    setField("کد تخفیف", "AB");
    setField("درصد تخفیف", "10");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("حداقل ۳ نویسه");
    setField("کد تخفیف", "AB CD");
    submit();
    expect(await screen.findByText(/فقط می‌تواند شامل حروف انگلیسی/)).toBeInTheDocument();
    setField("کد تخفیف", "ABCD");
    setField("درصد تخفیف", "101");
    submit();
    expect(await screen.findByText("درصد تخفیف حداکثر ۱۰۰ باشد")).toBeInTheDocument();
    setField("درصد تخفیف", "");
    submit();
    expect(await screen.findByText("درصد تخفیف الزامی است")).toBeInTheDocument();
    expect(api.createDiscountCode).not.toHaveBeenCalled();
  });

  it("a duplicate code (409) is shown inline and the entered values are kept", async () => {
    api.createDiscountCode.mockRejectedValue(new ApiClientError(409, "DISCOUNT_CODE_DUPLICATE", "این کد تخفیف قبلاً ثبت شده است"));
    render(<DiscountCodesManager />);
    const form = await openCreate();
    setField("کد تخفیف", "TAKEN");
    setField("درصد تخفیف", "15");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("این کد تخفیف قبلاً ثبت شده است")).toBeInTheDocument();
    expect(screen.getByLabelText("کد تخفیف")).toHaveValue("TAKEN");
    expect(screen.getByLabelText("درصد تخفیف")).toHaveValue("15");
    expect(screen.getByRole("form", { name: "کد تخفیف جدید" })).toBeInTheDocument();
  });

  it("cancel closes the form without calling the API", async () => {
    render(<DiscountCodesManager />);
    const form = await openCreate();
    fireEvent.click(within(form).getByRole("button", { name: /انصراف/ }));
    expect(screen.queryByRole("form", { name: "کد تخفیف جدید" })).not.toBeInTheDocument();
    expect(api.createDiscountCode).not.toHaveBeenCalled();
  });
});

describe("DiscountCodesManager — create a personal code (owner picker)", () => {
  it("requires choosing a customer before the code can be created", async () => {
    render(<DiscountCodesManager />);
    const form = await openCreate();
    fireEvent.click(within(form).getByRole("radio", { name: /شخصی/ }));
    setField("کد تخفیف", "ALI-ONLY");
    setField("درصد تخفیف", "10");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("برای کد شخصی باید یک مشتری انتخاب شود")).toBeInTheDocument();
    expect(api.createDiscountCode).not.toHaveBeenCalled();
  });

  it("searches ACTIVE customers through the existing customers endpoint (debounced) and sends the chosen owner id", async () => {
    customersApi.fetchCustomers.mockResolvedValue({ data: [customer(), customer({ id: "64b7f0c2a1b2c3d4e5f60999", firstName: "رضا", lastName: "احمدی", phone: "09120000009" })], pagination: { page: 1, pageSize: 8, total: 2 } });
    api.createDiscountCode.mockResolvedValue(personal());
    render(<DiscountCodesManager />);
    const form = await openCreate();
    fireEvent.click(within(form).getByRole("radio", { name: /شخصی/ }));
    const search = screen.getByLabelText(/مشتری مالک کد/);
    for (const v of ["ع", "عل", "علی"]) fireEvent.change(search, { target: { value: v } });
    expect(customersApi.fetchCustomers).not.toHaveBeenCalled();
    const results = await screen.findByRole("list", { name: "نتایج جست‌وجوی مشتری" }, { timeout: 2000 });
    expect(customersApi.fetchCustomers).toHaveBeenCalledTimes(1);
    expect(customersApi.fetchCustomers).toHaveBeenCalledWith({ page: 1, limit: 8, search: "علی", status: "active" });
    expect(within(results).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(results).getAllByRole("button")[0]!);
    expect(screen.getByText("علی رضایی — 09120000001")).toBeInTheDocument();
    setField("کد تخفیف", "ali-only");
    setField("درصد تخفیف", "10");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createDiscountCode).toHaveBeenCalledWith({ code: "ALI-ONLY", type: "personal", ownerUserId: OWNER_ID, percentage: 10 }));
  });

  it("the selected owner can be changed, and switching back to public clears it", async () => {
    customersApi.fetchCustomers.mockResolvedValue({ data: [customer()], pagination: { page: 1, pageSize: 8, total: 1 } });
    api.createDiscountCode.mockResolvedValue(row());
    render(<DiscountCodesManager />);
    const form = await openCreate();
    fireEvent.click(within(form).getByRole("radio", { name: /شخصی/ }));
    fireEvent.change(screen.getByLabelText(/مشتری مالک کد/), { target: { value: "علی" } });
    fireEvent.click(within(await screen.findByRole("list", { name: "نتایج جست‌وجوی مشتری" }, { timeout: 2000 })).getAllByRole("button")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "تغییر مشتری" }));
    expect(screen.getByLabelText(/مشتری مالک کد/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/مشتری مالک کد/), { target: { value: "علی" } });
    fireEvent.click(within(await screen.findByRole("list", { name: "نتایج جست‌وجوی مشتری" }, { timeout: 2000 })).getAllByRole("button")[0]!);
    fireEvent.click(within(form).getByRole("radio", { name: /عمومی/ }));
    setField("کد تخفیف", "PUBLIC1");
    setField("درصد تخفیف", "5");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createDiscountCode).toHaveBeenCalledTimes(1));
    expect((api.createDiscountCode.mock.calls[0]![0] as Record<string, unknown>).ownerUserId).toBeUndefined();
  });

  it("shows an empty message and an error message for the customer search", async () => {
    customersApi.fetchCustomers.mockResolvedValueOnce({ data: [], pagination: { page: 1, pageSize: 8, total: 0 } });
    render(<DiscountCodesManager />);
    const form = await openCreate();
    fireEvent.click(within(form).getByRole("radio", { name: /شخصی/ }));
    fireEvent.change(screen.getByLabelText(/مشتری مالک کد/), { target: { value: "نیست" } });
    expect(await screen.findByText("مشتری فعالی با این مشخصات پیدا نشد.", {}, { timeout: 2000 })).toBeInTheDocument();
    customersApi.fetchCustomers.mockRejectedValueOnce(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    fireEvent.change(screen.getByLabelText(/مشتری مالک کد/), { target: { value: "خطا" } });
    expect(await screen.findByText("خطای داخلی سرور رخ داد", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("surfaces a server-side owner rejection (e.g. the customer was deactivated meanwhile)", async () => {
    customersApi.fetchCustomers.mockResolvedValue({ data: [customer()], pagination: { page: 1, pageSize: 8, total: 1 } });
    api.createDiscountCode.mockRejectedValue(new ApiClientError(400, "DISCOUNT_CODE_OWNER_INVALID", "مشتری فعال با این شناسه پیدا نشد"));
    render(<DiscountCodesManager />);
    const form = await openCreate();
    fireEvent.click(within(form).getByRole("radio", { name: /شخصی/ }));
    fireEvent.change(screen.getByLabelText(/مشتری مالک کد/), { target: { value: "علی" } });
    fireEvent.click(within(await screen.findByRole("list", { name: "نتایج جست‌وجوی مشتری" }, { timeout: 2000 })).getAllByRole("button")[0]!);
    setField("کد تخفیف", "ALI-ONLY");
    setField("درصد تخفیف", "10");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("مشتری فعال با این شناسه پیدا نشد")).toBeInTheDocument();
  });
});

describe("DiscountCodesManager — edit", () => {
  const openEdit = async (item: DiscountCodeDto) => {
    api.fetchDiscountCodes.mockResolvedValue(page([item]));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: `ویرایش ${item.code}` }));
    return screen.getByRole("form", { name: `ویرایش «${item.code}»` });
  };

  it("shows code, type, owner and usedCount as read-only text — no input exists for them", async () => {
    const form = await openEdit(personal({ usedCount: 4, usageLimit: 10 }));
    expect(within(form).getByText("ALI-ONLY")).toBeInTheDocument();
    expect(within(form).getByText("شخصی")).toBeInTheDocument();
    expect(within(form).getByText("علی رضایی — 09120000001")).toBeInTheDocument();
    expect(within(form).getByText("۴")).toBeInTheDocument();
    expect(within(form).queryByLabelText("کد تخفیف")).not.toBeInTheDocument();
    expect(within(form).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/مشتری مالک کد/)).not.toBeInTheDocument();
    expect(within(form).queryByRole("button", { name: /تولید کد/ })).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/استفاده‌شده|usedCount/)).not.toBeInTheDocument();
  });

  it("prefills editable fields (money with separators, the Tehran calendar day of the expiry)", async () => {
    const form = await openEdit(row({ percentage: 25, maxDiscountAmount: 50000, minOrderAmount: 120000, usageLimit: 1000, expiresAt: "2026-10-07T20:29:59.999Z" }));
    expect(within(form).getByLabelText("درصد تخفیف")).toHaveValue("25");
    expect(within(form).getByLabelText("حداکثر مبلغ تخفیف (تومان)")).toHaveValue("۵۰٬۰۰۰");
    expect(within(form).getByLabelText("حداقل مبلغ سفارش (تومان)")).toHaveValue("۱۲۰٬۰۰۰");
    expect(within(form).getByLabelText("سقف تعداد استفاده")).toHaveValue("۱٬۰۰۰");
    expect(within(form).getByLabelText("تاریخ انقضا (اختیاری)")).toHaveValue("2026-10-07");
  });

  it("sends only the changed fields", async () => {
    api.updateDiscountCode.mockResolvedValue(row({ percentage: 30 }));
    const form = await openEdit(row());
    setField("درصد تخفیف", "30");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateDiscountCode).toHaveBeenCalledWith("d1", { percentage: 30 }));
    expect(await screen.findByText("کد تخفیف ذخیره شد")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /ویرایش/ })).not.toBeInTheDocument();
  });

  it("clearing the optional fields sends null (no cap / unlimited / no expiry)", async () => {
    api.updateDiscountCode.mockResolvedValue(row());
    const form = await openEdit(row({ maxDiscountAmount: 50000, usageLimit: 5, expiresAt: "2026-10-07T20:29:59.999Z" }));
    setField("حداکثر مبلغ تخفیف (تومان)", "");
    setField("سقف تعداد استفاده", "");
    setField("تاریخ انقضا (اختیاری)", "");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateDiscountCode).toHaveBeenCalledWith("d1", { maxDiscountAmount: null, usageLimit: null, expiresAt: null }));
  });

  it("an unchanged form just closes without a request", async () => {
    const form = await openEdit(row({ maxDiscountAmount: 50000, usageLimit: 5, expiresAt: "2026-10-07T20:29:59.999Z" }));
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: /ویرایش/ })).not.toBeInTheDocument());
    expect(api.updateDiscountCode).not.toHaveBeenCalled();
  });

  it("a server conflict for a too-low usage limit is shown inline and the form stays open", async () => {
    api.updateDiscountCode.mockRejectedValue(new ApiClientError(409, "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED", "سقف استفاده نمی‌تواند کمتر از تعداد دفعات استفاده‌شده‌ی این کد باشد"));
    const form = await openEdit(row({ usedCount: 5, usageLimit: 10, status: "active" }));
    setField("سقف تعداد استفاده", "3");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText(/نمی‌تواند کمتر از تعداد دفعات استفاده‌شده/)).toBeInTheDocument();
    expect(screen.getByLabelText("سقف تعداد استفاده")).toHaveValue("۳");
    expect(screen.getByRole("form", { name: /ویرایش/ })).toBeInTheDocument();
  });

  it("client validation rejects an empty percentage and out-of-range values without a request", async () => {
    const form = await openEdit(row());
    setField("درصد تخفیف", "");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("درصد تخفیف الزامی است")).toBeInTheDocument();
    setField("درصد تخفیف", "0");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("درصد تخفیف حداقل ۱ باشد")).toBeInTheDocument();
    expect(api.updateDiscountCode).not.toHaveBeenCalled();
  });
});

describe("DiscountCodesManager — status mutation", () => {
  it("deactivates an active code, updates the row in place and confirms", async () => {
    api.setDiscountCodeActive.mockResolvedValue(row({ isActive: false, status: "disabled" }));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی WELCOME10" }));
    await waitFor(() => expect(api.setDiscountCodeActive).toHaveBeenCalledWith("d1", false));
    expect(await screen.findByText("کد تخفیف غیرفعال شد")).toBeInTheDocument();
    expect(within(within(screen.getByRole("table")).getAllByRole("row")[1]!).getAllByRole("cell")[6]).toHaveTextContent("غیرفعال");
    expect(screen.getByRole("button", { name: "فعال‌سازی WELCOME10" })).toBeInTheDocument();
  });

  it("re-activates a disabled code", async () => {
    api.fetchDiscountCodes.mockResolvedValue(page([row({ isActive: false, status: "disabled" })]));
    api.setDiscountCodeActive.mockResolvedValue(row());
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "فعال‌سازی WELCOME10" }));
    await waitFor(() => expect(api.setDiscountCodeActive).toHaveBeenCalledWith("d1", true));
    expect(await screen.findByText("کد تخفیف فعال شد")).toBeInTheDocument();
  });

  it("shows the mutation error and leaves the row unchanged", async () => {
    api.setDiscountCodeActive.mockRejectedValue(new ApiClientError(404, "DISCOUNT_CODE_NOT_FOUND", "کد تخفیف یافت نشد"));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی WELCOME10" }));
    expect(await screen.findByText("کد تخفیف یافت نشد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "غیرفعال‌سازی WELCOME10" })).toBeEnabled();
  });

  it("disables the action buttons while a status change is in flight", async () => {
    let resolve!: (v: DiscountCodeDto) => void;
    api.setDiscountCodeActive.mockReturnValue(new Promise<DiscountCodeDto>((r) => { resolve = r; }));
    render(<DiscountCodesManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی WELCOME10" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "غیرفعال‌سازی WELCOME10" })).toBeDisabled());
    resolve(row({ isActive: false, status: "disabled" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "فعال‌سازی WELCOME10" })).toBeEnabled());
  });
});
