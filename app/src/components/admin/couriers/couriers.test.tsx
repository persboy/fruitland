import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { CourierDto, CustomerListItemDto } from "@fruitland/shared";

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
    usePathname: () => "/admin/couriers",
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

const api = vi.hoisted(() => ({ fetchCouriers: vi.fn(), createCourier: vi.fn(), updateCourier: vi.fn(), setCourierActive: vi.fn() }));
vi.mock("@/lib/client/adminCouriers", () => api);
const customersApi = vi.hoisted(() => ({ fetchCustomers: vi.fn() }));
vi.mock("@/lib/client/adminCustomers", () => customersApi);

import { CouriersManager } from "./CouriersManager";

const T = "2026-01-01T10:00:00.000Z";
const CID = "64b7f0c2a1b2c3d4e5f60718";
const row = (over: Partial<CourierDto> = {}): CourierDto => ({
  id: "c1", firstName: "علی", lastName: "رضایی", phone: "09120000001", isActive: true, vehicleType: "motorcycle", plateNumber: "12ب345",
  availabilityStatus: "offline", createdAt: T, ...over,
});
const page = (items: CourierDto[], total = items.length, p = 1) => ({ data: items, pagination: { page: p, pageSize: 20, total } });
const customer = (over: Partial<CustomerListItemDto> = {}): CustomerListItemDto => ({ id: CID, firstName: "مریم", lastName: "کریمی", phone: "09121112222", isActive: true, createdAt: T, ...over });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  customersApi.fetchCustomers.mockReset();
  nav.store.search = "";
  nav.store.push = [];
  nav.store.replace = [];
  nav.store.listeners.clear();
  api.fetchCouriers.mockResolvedValue(page([row()]));
});
afterEach(cleanup);

describe("CouriersManager — list", () => {
  it("shows loading, then name, phone, vehicle, plate, account state, availability and Jalali date", async () => {
    render(<CouriersManager />);
    expect(screen.getByRole("status", { name: "در حال دریافت پیک‌ها" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("علی رضایی");
    expect(cells[1]).toHaveTextContent("09120000001");
    expect(cells[2]).toHaveTextContent("موتورسیکلت");
    expect(cells[3]).toHaveTextContent("12ب345");
    expect(cells[4]).toHaveTextContent("فعال");
    expect(cells[5]).toHaveTextContent("آفلاین");
    expect(cells[6]).not.toHaveTextContent("2026");
  });

  it("never shows or requests the courier's location", async () => {
    api.fetchCouriers.mockResolvedValue(page([row({ availabilityStatus: "busy" })]));
    const { container } = render(<CouriersManager />);
    await screen.findByRole("table");
    expect(container.textContent).not.toMatch(/موقعیت|نقشه|lat|lng/);
    expect(screen.getByText("مشغول")).toBeInTheDocument();
  });

  it("an inactive courier with no plate shows the inactive badge and a dash", async () => {
    api.fetchCouriers.mockResolvedValue(page([row({ isActive: false, plateNumber: null })]));
    render(<CouriersManager />);
    const cells = within(within(await screen.findByRole("table")).getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[4]).toHaveTextContent("غیرفعال");
  });

  it("empty (no couriers) offers the promote action; empty (filtered) offers to clear the filters", async () => {
    api.fetchCouriers.mockResolvedValue(page([]));
    const first = render(<CouriersManager />);
    expect(await screen.findByText("هنوز پیکی ثبت نشده است")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /تبدیل مشتری به پیک/ }).length).toBeGreaterThan(0);
    first.unmount();
    nav.store.search = "q=x";
    render(<CouriersManager />);
    expect(await screen.findByText("پیکی با این شرایط پیدا نشد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "پاک‌کردن جست‌وجو و فیلتر" })).toBeInTheDocument();
  });

  it("network failure → error state with retry", async () => {
    api.fetchCouriers.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<CouriersManager />);
    expect(await screen.findByText(/ارتباط با سرور برقرار نشد/)).toBeInTheDocument();
    api.fetchCouriers.mockResolvedValue(page([row()]));
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("403 → forbidden; 401 → session expired with returnTo=/admin/couriers", async () => {
    api.fetchCouriers.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    const first = render(<CouriersManager />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
    first.unmount();
    api.fetchCouriers.mockRejectedValueOnce(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<CouriersManager />);
    expect(await screen.findByText("نشست شما منقضی شده است")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute("href", `/admin/login?returnTo=${encodeURIComponent("/admin/couriers")}`);
  });
});

describe("CouriersManager — URL state, search, filter, pagination", () => {
  it("restores q, status and page from the URL and falls back safely on garbage", async () => {
    nav.store.search = "q=علی&status=inactive&page=2";
    api.fetchCouriers.mockResolvedValue(page([row()], 45, 2));
    render(<CouriersManager />);
    await screen.findByRole("table");
    expect(api.fetchCouriers).toHaveBeenCalledWith({ page: 2, limit: 20, search: "علی", status: "inactive" });
    expect(screen.getByLabelText(/جست‌وجو/)).toHaveValue("علی");
    expect(screen.getByLabelText("وضعیت حساب")).toHaveValue("inactive");
    cleanup();
    api.fetchCouriers.mockClear();
    nav.store.search = "page=-3&status=busy";
    render(<CouriersManager />);
    await screen.findByRole("table");
    expect(api.fetchCouriers).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, status: "all" });
  });

  it("search (name or phone) is debounced, goes into the URL with replace and resets to page 1", async () => {
    nav.store.search = "page=3";
    api.fetchCouriers.mockResolvedValue(page([row()], 60, 3));
    render(<CouriersManager />);
    await screen.findByRole("table");
    api.fetchCouriers.mockClear();
    const box = screen.getByLabelText(/جست‌وجو/);
    for (const v of ["0", "09", "0912"]) fireEvent.change(box, { target: { value: v } });
    expect(api.fetchCouriers).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe("/admin/couriers?q=0912"), { timeout: 2000 });
    await waitFor(() => expect(api.fetchCouriers).toHaveBeenCalledTimes(1));
    expect(api.fetchCouriers).toHaveBeenCalledWith({ page: 1, limit: 20, search: "0912", status: "all" });
  });

  it("changing the status filter pushes to the URL and resets to page 1", async () => {
    nav.store.search = "page=2";
    api.fetchCouriers.mockResolvedValue(page([row()], 45, 2));
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("وضعیت حساب"), { target: { value: "active" } });
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/couriers?status=active"));
    await waitFor(() => expect(api.fetchCouriers).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: undefined, status: "active" }));
  });

  it("pagination moves between pages", async () => {
    api.fetchCouriers.mockResolvedValue(page([row()], 45, 1));
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /بعدی/ }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/couriers?page=2"));
  });
});

describe("CouriersManager — promote a customer", () => {
  const openForm = async () => {
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getAllByRole("button", { name: /تبدیل مشتری به پیک/ })[0]!);
    return screen.getByRole("form", { name: "تبدیل مشتری به پیک" });
  };
  const pick = async () => {
    customersApi.fetchCustomers.mockResolvedValue({ data: [customer()], pagination: { page: 1, pageSize: 8, total: 1 } });
    fireEvent.change(screen.getByLabelText(/مشتری \(جست‌وجو/), { target: { value: "مریم" } });
    fireEvent.click(await screen.findByRole("button", { name: /مریم کریمی/ }, { timeout: 2000 }));
  };

  it("searches ACTIVE customers through the existing Customers endpoint, then promotes with userId + vehicleType + plate", async () => {
    api.createCourier.mockResolvedValue(row({ id: "c2" }));
    await openForm();
    await pick();
    expect(customersApi.fetchCustomers).toHaveBeenCalledWith({ page: 1, limit: 8, search: "مریم", status: "active" });
    fireEvent.change(screen.getByLabelText("نوع وسیله‌ی نقلیه"), { target: { value: "car" } });
    fireEvent.change(screen.getByLabelText(/پلاک/), { target: { value: " ۱۲ب۳۴۵ " } });
    fireEvent.click(screen.getByRole("button", { name: "تبدیل به پیک" }));
    await waitFor(() => expect(api.createCourier).toHaveBeenCalledWith({ userId: CID, vehicleType: "car", plateNumber: "12ب345" }));
    expect(await screen.findByText("مشتری به پیک تبدیل شد")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "تبدیل مشتری به پیک" })).not.toBeInTheDocument();
  });

  it("requires a customer and a vehicle type before calling the API", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "تبدیل به پیک" }));
    expect(await screen.findByText("ابتدا مشتری را انتخاب کنید")).toBeInTheDocument();
    await pick();
    fireEvent.click(screen.getByRole("button", { name: "تبدیل به پیک" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/نوع وسیله/);
    expect(api.createCourier).not.toHaveBeenCalled();
  });

  it("shows the API's specific, safe reason for an ineligible customer and keeps the form", async () => {
    api.createCourier.mockRejectedValue(new ApiClientError(400, "COURIER_CANDIDATE_PROFILE_INCOMPLETE", "نام و نام‌خانوادگی این مشتری کامل نیست؛ ابتدا پروفایل او را کامل کنید"));
    await openForm();
    await pick();
    fireEvent.change(screen.getByLabelText("نوع وسیله‌ی نقلیه"), { target: { value: "bicycle" } });
    fireEvent.click(screen.getByRole("button", { name: "تبدیل به پیک" }));
    expect(await screen.findByText(/نام و نام‌خانوادگی این مشتری کامل نیست/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "تبدیل مشتری به پیک" })).toBeInTheDocument();
  });

  it("a pending submission cannot be sent twice", async () => {
    let resolve!: (v: CourierDto) => void;
    api.createCourier.mockReturnValue(new Promise<CourierDto>((r) => { resolve = r; }));
    await openForm();
    await pick();
    fireEvent.change(screen.getByLabelText("نوع وسیله‌ی نقلیه"), { target: { value: "car" } });
    const submit = screen.getByRole("button", { name: "تبدیل به پیک" });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);
    expect(api.createCourier).toHaveBeenCalledTimes(1);
    resolve(row());
  });
});

describe("CouriersManager — edit and status", () => {
  it("edits vehicle type and plate, sending only what changed, then updates the row", async () => {
    api.updateCourier.mockResolvedValue(row({ vehicleType: "bicycle", plateNumber: null }));
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "ویرایش علی رضایی" }));
    const form = screen.getByRole("form", { name: /ویرایش/ });
    expect(within(form).getByText("آفلاین")).toBeInTheDocument(); // availability is read-only text, not a field
    fireEvent.change(screen.getByLabelText("نوع وسیله‌ی نقلیه"), { target: { value: "bicycle" } });
    fireEvent.change(screen.getByLabelText(/پلاک/), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateCourier).toHaveBeenCalledWith("c1", { vehicleType: "bicycle", plateNumber: "" }));
    expect(await screen.findByText("اطلاعات پیک ذخیره شد")).toBeInTheDocument();
    const cells = within(within(screen.getByRole("table")).getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("دوچرخه");
  });

  it("an unchanged edit just closes without calling the API", async () => {
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "ویرایش علی رضایی" }));
    fireEvent.click(within(screen.getByRole("form", { name: /ویرایش/ })).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(api.updateCourier).not.toHaveBeenCalled();
  });

  it("deactivates a courier explicitly (isActive=false) and shows the new state", async () => {
    api.setCourierActive.mockResolvedValue(row({ isActive: false }));
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی علی رضایی" }));
    await waitFor(() => expect(api.setCourierActive).toHaveBeenCalledWith("c1", false));
    expect(await screen.findByText("حساب پیک غیرفعال شد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فعال‌سازی علی رضایی" })).toBeInTheDocument();
  });

  it("activates an inactive courier (isActive=true)", async () => {
    api.fetchCouriers.mockResolvedValue(page([row({ isActive: false })]));
    api.setCourierActive.mockResolvedValue(row({ isActive: true }));
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "فعال‌سازی علی رضایی" }));
    await waitFor(() => expect(api.setCourierActive).toHaveBeenCalledWith("c1", true));
    expect(await screen.findByText("حساب پیک فعال شد")).toBeInTheDocument();
  });

  it("HTTP 409 on deactivation shows a clear active-run message and leaves the row active", async () => {
    api.setCourierActive.mockRejectedValue(new ApiClientError(409, "COURIER_HAS_ACTIVE_RUN", "x"));
    render(<CouriersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی علی رضایی" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ماموریت فعال");
    expect(screen.getByRole("button", { name: "غیرفعال‌سازی علی رضایی" })).toBeInTheDocument();
  });

  it("other errors show their message; a pending toggle disables the actions", async () => {
    let reject!: (e: unknown) => void;
    api.setCourierActive.mockReturnValue(new Promise((_r, rej) => { reject = rej; }));
    render(<CouriersManager />);
    await screen.findByRole("table");
    const btn = screen.getByRole("button", { name: "غیرفعال‌سازی علی رضایی" });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(api.setCourierActive).toHaveBeenCalledTimes(1);
    reject(new ApiClientError(404, "COURIER_NOT_FOUND", "پیک یافت نشد"));
    expect(await screen.findByText("پیک یافت نشد")).toBeInTheDocument();
  });
});
