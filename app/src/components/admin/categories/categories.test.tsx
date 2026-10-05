import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { CategoryDto } from "@fruitland/shared";

const api = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  setCategoryActive: vi.fn(),
}));
vi.mock("@/lib/client/adminCategories", () => api);

import { CategoriesManager } from "./CategoriesManager";

const cat = (over: Partial<CategoryDto> = {}): CategoryDto => ({
  id: "c1", name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 1, isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
});
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe("CategoriesManager", () => {
  it("shows a loading state first, then the list with name, slug, icon, order, status and actions — and no delete action", async () => {
    api.fetchCategories.mockResolvedValue([cat(), cat({ id: "c2", name: "سبزی", slug: "veg", icon: null, sortOrder: 2, isActive: false })]);
    render(<CategoriesManager />);
    expect(screen.getByRole("status", { name: "در حال دریافت دسته‌بندی‌ها" })).toBeInTheDocument();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2
    expect(within(rows[1]!).getByText("میوه")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("fruit")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("🍎")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("فعال")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("غیرفعال")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ویرایش میوه" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "غیرفعال‌سازی میوه" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فعال‌سازی سبزی" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });

  it("empty state explains there are no categories and offers creation", async () => {
    api.fetchCategories.mockResolvedValue([]);
    render(<CategoriesManager />);
    expect(await screen.findByText("هنوز دسته‌بندی‌ای ثبت نشده است")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /دسته‌بندی جدید/ }).length).toBeGreaterThan(0);
  });

  it("error state shows the server message without internals and retry reloads", async () => {
    api.fetchCategories.mockRejectedValueOnce(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    api.fetchCategories.mockResolvedValueOnce([cat()]);
    render(<CategoriesManager />);
    expect(await screen.findByText("دریافت دسته‌بندی‌ها انجام نشد")).toBeInTheDocument();
    expect(screen.getByText("خطای داخلی سرور رخ داد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("network failure shows a Persian connection message", async () => {
    api.fetchCategories.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CategoriesManager />);
    expect(await screen.findByText(/ارتباط با سرور برقرار نشد/)).toBeInTheDocument();
  });

  it("403 shows the forbidden state (no list, no create button)", async () => {
    api.fetchCategories.mockRejectedValue(new ApiClientError(403, "FORBIDDEN_ROLE", "اجازه ندارید"));
    render(<CategoriesManager />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /دسته‌بندی جدید/ })).not.toBeInTheDocument();
  });

  it("401 shows a re-login link that returns to this page", async () => {
    api.fetchCategories.mockRejectedValue(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<CategoriesManager />);
    const link = await screen.findByRole("link", { name: "ورود" });
    expect(link).toHaveAttribute("href", "/admin/login?returnTo=%2Fadmin%2Fcategories");
  });

  it("create: validates client-side (no API call), then submits parsed values and adds the row in order", async () => {
    api.fetchCategories.mockResolvedValue([cat({ sortOrder: 5 })]);
    api.createCategory.mockResolvedValue(cat({ id: "c9", name: "سبزی", slug: "veg", icon: null, sortOrder: 2 }));
    render(<CategoriesManager />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: /دسته‌بندی جدید/ }));
    const form = screen.getByRole("form", { name: "دسته‌بندی جدید" });
    expect(within(form).getByLabelText("ترتیب نمایش")).toHaveValue("0");

    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("نام دسته‌بندی الزامی است");
    fill("نام", "سبزی");
    fill(/شناسه/, "Bad Slug");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("شناسه فقط می‌تواند");
    expect(api.createCategory).not.toHaveBeenCalled();

    fill(/شناسه/, "veg");
    fill("ترتیب نمایش", "۲"); // Persian digit
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith({ name: "سبزی", slug: "veg", sortOrder: 2 }));
    expect(await screen.findByText("دسته‌بندی ایجاد شد")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[1]!).getByText("سبزی")).toBeInTheDocument(); // sortOrder 2 sorts before 5
  });

  it("sortOrder input is digits only (letters, signs, decimals and separators are stripped)", async () => {
    api.fetchCategories.mockResolvedValue([]);
    render(<CategoriesManager />);
    fireEvent.click((await screen.findAllByRole("button", { name: /دسته‌بندی جدید/ }))[0]!);
    fill("ترتیب نمایش", "-1.5ab٬۳");
    expect(screen.getByLabelText("ترتیب نمایش")).toHaveValue("153");
  });

  it("duplicate slug from the server is shown inline and the typed values are kept", async () => {
    api.fetchCategories.mockResolvedValue([]);
    api.createCategory.mockRejectedValue(new ApiClientError(409, "CATEGORY_SLUG_TAKEN", "این شناسه (slug) قبلاً برای دسته‌بندی دیگری استفاده شده است"));
    render(<CategoriesManager />);
    fireEvent.click((await screen.findAllByRole("button", { name: /دسته‌بندی جدید/ }))[0]!);
    fill("نام", "میوه");
    fill(/شناسه/, "fruit");
    fireEvent.click(screen.getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("قبلاً برای دسته‌بندی دیگری");
    expect(screen.getByLabelText("نام")).toHaveValue("میوه");
    expect(screen.getByLabelText(/شناسه/)).toHaveValue("fruit");
  });

  it("edit: prefilled, sends only changed fields, clears icon with an empty string, and updates the row", async () => {
    api.fetchCategories.mockResolvedValue([cat()]);
    api.updateCategory.mockResolvedValue(cat({ icon: null, sortOrder: 9 }));
    render(<CategoriesManager />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش میوه" }));
    const form = screen.getByRole("form", { name: "ویرایش «میوه»" });
    expect(within(form).getByLabelText("نام")).toHaveValue("میوه");
    expect(within(form).getByLabelText("آیکون")).toHaveValue("🍎");
    fill("آیکون", "");
    fill("ترتیب نمایش", "9");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenCalledWith("c1", { icon: "", sortOrder: 9 }));
    expect(await screen.findByText("دسته‌بندی ذخیره شد")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("🍎")).not.toBeInTheDocument();
  });

  it("edit without changes closes without calling the API", async () => {
    api.fetchCategories.mockResolvedValue([cat()]);
    render(<CategoriesManager />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش میوه" }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it("deactivate then activate: calls the status endpoint, flips the badge and button label", async () => {
    api.fetchCategories.mockResolvedValue([cat()]);
    api.setCategoryActive.mockResolvedValueOnce(cat({ isActive: false })).mockResolvedValueOnce(cat({ isActive: true }));
    render(<CategoriesManager />);
    fireEvent.click(await screen.findByRole("button", { name: "غیرفعال‌سازی میوه" }));
    await waitFor(() => expect(api.setCategoryActive).toHaveBeenLastCalledWith("c1", false));
    expect(await screen.findByText("دسته‌بندی غیرفعال شد")).toBeInTheDocument();
    expect(await screen.findByText("غیرفعال")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "فعال‌سازی میوه" }));
    await waitFor(() => expect(api.setCategoryActive).toHaveBeenLastCalledWith("c1", true));
    expect(await screen.findByText("دسته‌بندی فعال شد")).toBeInTheDocument();
  });

  it("a failed activation shows the error and leaves the row unchanged", async () => {
    api.fetchCategories.mockResolvedValue([cat()]);
    api.setCategoryActive.mockRejectedValue(new ApiClientError(403, "FORBIDDEN_ROLE", "اجازه‌ی این کار را ندارید"));
    render(<CategoriesManager />);
    fireEvent.click(await screen.findByRole("button", { name: "غیرفعال‌سازی میوه" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("اجازه‌ی این کار را ندارید");
    expect(screen.getByText("فعال")).toBeInTheDocument();
  });
});
