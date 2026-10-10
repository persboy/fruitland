import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { OrderDetailDto, OrderListItemDto } from "@fruitland/shared";

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
    usePathname: () => "/admin/orders",
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

const api = vi.hoisted(() => ({ fetchOrders: vi.fn(), fetchOrder: vi.fn(), cancelOrder: vi.fn() }));
vi.mock("@/lib/client/adminOrders", () => api);

import { OrdersManager } from "./OrdersManager";
import { OrderDetail } from "./OrderDetail";

const T = "2026-01-01T10:00:00.000Z";
const row = (over: Partial<OrderListItemDto> = {}): OrderListItemDto => ({
  id: "o1", orderNumber: "000012", status: "preparing", deliveryStatus: "unassigned", source: "online", customerName: "علی رضایی", customerPhone: "09120000001",
  recipientName: "گیرنده", itemCount: 2, totalAmount: 130000, isReplacement: false, createdAt: T, ...over,
});
const page = (items: OrderListItemDto[], total = items.length, p = 1) => ({ data: items, pagination: { page: p, pageSize: 20, total } });
const detail = (over: Partial<OrderDetailDto> = {}): OrderDetailDto => ({
  ...row(), updatedAt: T,
  customer: { id: "u1", name: "علی رضایی", phone: "09120000001" },
  deliveryAddress: { recipientName: "گیرنده", phone: "09121110000", province: "زنجان", city: "زنجان", addressLine: "خیابان ۱", postalCode: null },
  items: [{ id: "i1", productName: "سیب سرخ", unit: "kg", unitPrice: 60000, quantity: 2, discountAmount: 0, lineTotal: 120000 }],
  subtotalAmount: 120000, discountCode: null, discountAmount: 0, deliveryFeeAmount: 10000, paymentMethod: "cod", isPaid: false, paidAt: null, customerNote: null,
  delivery: { status: "unassigned", courier: null, assignedAt: null, pickedUpAt: null, proposedOutcome: null, proposedAt: null, resolvedAt: null, emergencyCancelledAt: null },
  cancellation: null, replacesOrder: null, replacedBy: [], ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  nav.store.search = "";
  nav.store.push = [];
  nav.store.replace = [];
  nav.store.listeners.clear();
  api.fetchOrders.mockResolvedValue(page([row()]));
});
afterEach(cleanup);

describe("OrdersManager", () => {
  it("shows loading, then a row with number link, customer, both statuses, items, total and Jalali date", async () => {
    render(<OrdersManager />);
    expect(screen.getByRole("status", { name: "در حال دریافت سفارش‌ها" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole("cell");
    expect(within(cells[0]!).getByRole("link")).toHaveAttribute("href", "/admin/orders/o1");
    expect(cells[1]).toHaveTextContent("علی رضایی");
    expect(cells[2]).toHaveTextContent("در حال آماده‌سازی");
    expect(cells[3]).toHaveTextContent("بدون پیک");
    expect(cells[4]).toHaveTextContent("آنلاین");
    expect(cells[6]).toHaveTextContent("تومان");
    expect(cells[7]).not.toHaveTextContent("2026");
  });

  it("marks replacement orders and falls back to the recipient when the customer is unknown", async () => {
    api.fetchOrders.mockResolvedValue(page([row({ isReplacement: true, customerName: null, customerPhone: null })]));
    render(<OrdersManager />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("جایگزین")).toBeInTheDocument();
    expect(within(table).getByText("گیرنده")).toBeInTheDocument();
  });

  it("empty (no orders) and empty (filtered, with a clear button)", async () => {
    api.fetchOrders.mockResolvedValue(page([]));
    const first = render(<OrdersManager />);
    expect(await screen.findByText("هنوز سفارشی ثبت نشده است")).toBeInTheDocument();
    first.unmount();
    nav.store.search = "status=shipped";
    render(<OrdersManager />);
    expect(await screen.findByText("سفارشی با این شرایط پیدا نشد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "پاک‌کردن جست‌وجو و فیلترها" })).toBeInTheDocument();
  });

  it("network failure → error with retry; 403 → forbidden; 401 → session expired with returnTo", async () => {
    api.fetchOrders.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const a = render(<OrdersManager />);
    expect(await screen.findByText(/ارتباط با سرور برقرار نشد/)).toBeInTheDocument();
    api.fetchOrders.mockResolvedValue(page([row()]));
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    a.unmount();
    api.fetchOrders.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    const b = render(<OrdersManager />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
    b.unmount();
    api.fetchOrders.mockRejectedValueOnce(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<OrdersManager />);
    expect(await screen.findByText("نشست شما منقضی شده است")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute("href", `/admin/login?returnTo=${encodeURIComponent("/admin/orders")}`);
  });

  it("restores every filter and the page from the URL; garbage falls back to defaults", async () => {
    nav.store.search = "q=0912&status=shipped&deliveryStatus=picked_up&source=phone&page=2";
    api.fetchOrders.mockResolvedValue(page([row()], 45, 2));
    render(<OrdersManager />);
    await screen.findByRole("table");
    expect(api.fetchOrders).toHaveBeenCalledWith({ page: 2, limit: 20, search: "0912", status: "shipped", deliveryStatus: "picked_up", source: "phone" });
    expect(screen.getByLabelText("وضعیت سفارش")).toHaveValue("shipped");
    expect(screen.getByLabelText("وضعیت تحویل")).toHaveValue("picked_up");
    expect(screen.getByLabelText("منبع سفارش")).toHaveValue("phone");
    cleanup();
    api.fetchOrders.mockClear();
    nav.store.search = "status=paid&deliveryStatus=x&source=app&page=-1";
    render(<OrdersManager />);
    await screen.findByRole("table");
    expect(api.fetchOrders).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, status: undefined, deliveryStatus: undefined, source: undefined });
  });

  it("changing a filter pushes it into the URL and resets to page 1; search is debounced and uses replace", async () => {
    nav.store.search = "page=3";
    api.fetchOrders.mockResolvedValue(page([row()], 60, 3));
    render(<OrdersManager />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("وضعیت سفارش"), { target: { value: "cancelled" } });
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/orders?status=cancelled"));
    api.fetchOrders.mockClear();
    const box = screen.getByLabelText(/جست‌وجو/);
    for (const v of ["0", "00", "0001"]) fireEvent.change(box, { target: { value: v } });
    expect(api.fetchOrders).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe("/admin/orders?q=0001&status=cancelled"), { timeout: 2000 });
    await waitFor(() => expect(api.fetchOrders).toHaveBeenCalledTimes(1));
  });

  it("pagination moves between pages", async () => {
    api.fetchOrders.mockResolvedValue(page([row()], 45, 1));
    render(<OrdersManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /بعدی/ }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/orders?page=2"));
  });
});

describe("OrderDetail", () => {
  it("shows the stored snapshots, amounts, payment (display only) and delivery — and no location", async () => {
    api.fetchOrder.mockResolvedValue(detail({ delivery: { status: "assigned", courier: { id: "c1", name: "پیک یک", phone: "09120000002" }, assignedAt: T, pickedUpAt: null, proposedOutcome: null, proposedAt: null, resolvedAt: null, emergencyCancelledAt: null }, deliveryStatus: "assigned" }));
    const { container } = render(<OrderDetail id="o1" />);
    expect(await screen.findByText("سیب سرخ")).toBeInTheDocument();
    expect(screen.getByText("خیابان ۱", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("پرداخت در محل")).toBeInTheDocument();
    expect(screen.getByText("پرداخت‌نشده")).toBeInTheDocument();
    expect(screen.getByText(/پیک یک/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/موقعیت|نقشه|lat|lng/);
    expect(screen.getByRole("link", { name: /بازگشت به فهرست/ })).toHaveAttribute("href", "/admin/orders");
  });

  it("links a replacement order to its original and back", async () => {
    api.fetchOrder.mockResolvedValue(detail({ isReplacement: true, replacesOrder: { id: "o0", orderNumber: "000010" }, replacedBy: [{ id: "o9", orderNumber: "000020" }] }));
    render(<OrderDetail id="o1" />);
    expect(await screen.findByRole("link", { name: "000010" })).toHaveAttribute("href", "/admin/orders/o0");
    expect(screen.getByRole("link", { name: "000020" })).toHaveAttribute("href", "/admin/orders/o9");
  });

  it("a proposed outcome is shown but NO approve/reject action is offered here", async () => {
    api.fetchOrder.mockResolvedValue(detail({ status: "shipped", deliveryStatus: "proposed", delivery: { ...detail().delivery, status: "proposed", proposedOutcome: "delivered", proposedAt: T } }));
    render(<OrderDetail id="o1" />);
    expect(await screen.findByText("تحویل‌شد")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تأیید|رد/ })).not.toBeInTheDocument();
  });

  it("not found / network error / forbidden states", async () => {
    api.fetchOrder.mockRejectedValueOnce(new ApiClientError(404, "ORDER_NOT_FOUND", "سفارش یافت نشد"));
    const a = render(<OrderDetail id="zz" />);
    expect(await screen.findByText("سفارش یافت نشد")).toBeInTheDocument();
    a.unmount();
    api.fetchOrder.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    render(<OrderDetail id="o1" />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
  });

  it.each([
    ["shipped", { status: "shipped" as const, deliveryStatus: "picked_up" as const }],
    ["cancelled", { status: "cancelled" as const }],
    ["preparing but assigned", { deliveryStatus: "assigned" as const }],
  ])("no cancel button for an order that is %s", async (_n, over) => {
    api.fetchOrder.mockResolvedValue(detail(over));
    render(<OrderDetail id="o1" />);
    await screen.findByText("سیب سرخ");
    expect(screen.queryByRole("button", { name: "لغو سفارش" })).not.toBeInTheDocument();
  });

  it("cancels with a mandatory reason: blank is rejected client-side, valid reason calls the API and updates the page", async () => {
    api.fetchOrder.mockResolvedValue(detail());
    api.cancelOrder.mockResolvedValue(detail({ status: "cancelled", cancellation: { reason: "مشتری منصرف شد", canceledAt: T, canceledByUserId: "a1" } }));
    render(<OrderDetail id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "لغو سفارش" }));
    const form = screen.getByRole("form", { name: "لغو سفارش" });
    fireEvent.click(within(form).getByRole("button", { name: "تأیید لغو سفارش" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("دلیل لغو الزامی است");
    expect(api.cancelOrder).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("دلیل لغو"), { target: { value: "  مشتری منصرف شد  " } });
    fireEvent.click(within(form).getByRole("button", { name: "تأیید لغو سفارش" }));
    await waitFor(() => expect(api.cancelOrder).toHaveBeenCalledWith("o1", "مشتری منصرف شد"));
    expect(await screen.findByText("اطلاعات لغو")).toBeInTheDocument();
    expect(screen.getByText("مشتری منصرف شد")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "لغو سفارش" })).not.toBeInTheDocument();
  });

  it("shows the server's 409 reason and keeps the form; a pending cancel cannot be submitted twice", async () => {
    api.fetchOrder.mockResolvedValue(detail());
    let reject!: (e: unknown) => void;
    api.cancelOrder.mockReturnValue(new Promise((_r, rej) => { reject = rej; }));
    render(<OrderDetail id="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "لغو سفارش" }));
    fireEvent.change(screen.getByLabelText("دلیل لغو"), { target: { value: "دلیل" } });
    const submit = screen.getByRole("button", { name: "تأیید لغو سفارش" });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);
    expect(api.cancelOrder).toHaveBeenCalledTimes(1);
    reject(new ApiClientError(409, "ORDER_IN_DELIVERY", "این سفارش در ماموریت تحویل قرار دارد"));
    expect(await screen.findByText(/در ماموریت تحویل قرار دارد/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "لغو سفارش" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "تأیید لغو سفارش" })).not.toBeDisabled());
  });
});
