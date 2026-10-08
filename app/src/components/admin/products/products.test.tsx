import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { CategoryDto, ProductDto } from "@fruitland/shared";

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
    usePathname: () => "/admin/products",
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

const api = vi.hoisted(() => ({ fetchProducts: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(), setProductActive: vi.fn() }));
vi.mock("@/lib/client/adminProducts", () => api);
const catApi = vi.hoisted(() => ({ fetchCategories: vi.fn() }));
vi.mock("@/lib/client/adminCategories", () => catApi);

import { ProductsManager } from "./ProductsManager";

const T = "2026-01-01T10:00:00.000Z";
const CAT_A = "64b7f0c2a1b2c3d4e5f60001";
const CAT_B = "64b7f0c2a1b2c3d4e5f60002";
const CAT_OFF = "64b7f0c2a1b2c3d4e5f60003";
const V1 = "64b7f0c2a1b2c3d4e5f60aa1";
const V2 = "64b7f0c2a1b2c3d4e5f60aa2";
const cat = (id: string, name: string, isActive = true, sortOrder = 0): CategoryDto => ({ id, name, slug: `c-${id.slice(-1)}`, icon: null, sortOrder, isActive, createdAt: T, updatedAt: T });
const categories = [cat(CAT_A, "میوه", true, 1), cat(CAT_B, "سبزی", true, 2), cat(CAT_OFF, "فصلی", false, 3)];
const prod = (over: Partial<ProductDto> = {}): ProductDto => ({
  id: "p1", name: "سیب قرمز", slug: "سیب-قرمز", category: { id: CAT_A, name: "میوه", isActive: true }, description: null, images: [], isOrganic: false, isActive: true,
  sortOrder: 0, variants: [{ id: V1, unit: "kg", price: 50000, isAvailable: true }], createdAt: T, updatedAt: T, ...over,
});
const page = (items: ProductDto[], total = items.length, p = 1) => ({ data: items, pagination: { page: p, pageSize: 20, total } });

const setField = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openCreate = async () => {
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: /محصول جدید/ }));
  return await screen.findByRole("form", { name: "محصول جدید" });
};
const openEdit = async (item: ProductDto) => {
  api.fetchProducts.mockResolvedValue(page([item]));
  render(<ProductsManager />);
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: `ویرایش ${item.name}` }));
  return await screen.findByRole("form", { name: `ویرایش «${item.name}»` });
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  catApi.fetchCategories.mockReset();
  nav.store.search = "";
  nav.store.push = [];
  nav.store.replace = [];
  nav.store.listeners.clear();
  api.fetchProducts.mockResolvedValue(page([prod()]));
  catApi.fetchCategories.mockResolvedValue(categories);
});
afterEach(cleanup);

describe("ProductsManager — list", () => {
  it("shows loading, then name, slug, category, variants with prices, organic, order and status", async () => {
    api.fetchProducts.mockResolvedValue(
      page([
        prod({ isOrganic: true, sortOrder: 3, variants: [{ id: V1, unit: "kg", price: 50000, isAvailable: true }, { id: V2, unit: "box", price: 400000, isAvailable: false }] }),
        prod({ id: "p2", name: "موز", slug: "موز", isActive: false }),
      ]),
    );
    render(<ProductsManager />);
    expect(screen.getByRole("status", { name: "در حال دریافت محصولات" })).toBeInTheDocument();
    const rows = within(await screen.findByRole("table")).getAllByRole("row");
    const a = within(rows[1]!).getAllByRole("cell");
    expect(a[0]).toHaveTextContent("سیب قرمز");
    expect(a[0]).toHaveTextContent("سیب-قرمز");
    expect(a[1]).toHaveTextContent("میوه");
    expect(a[2]).toHaveTextContent("کیلوگرم: ۵۰٬۰۰۰ تومان");
    expect(a[2]).toHaveTextContent("جعبه: ۴۰۰٬۰۰۰ تومان");
    expect(a[2]).toHaveTextContent("ناموجود");
    expect(a[3]).toHaveTextContent("بله");
    expect(a[4]).toHaveTextContent("۳");
    expect(a[5]).toHaveTextContent("فعال");
    expect(within(rows[2]!).getAllByRole("cell")[5]).toHaveTextContent("غیرفعال");
    expect(api.fetchProducts).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, categoryId: undefined, isActive: undefined, isOrganic: undefined });
  });

  it("flags a product whose category is now inactive, without changing anything", async () => {
    api.fetchProducts.mockResolvedValue(page([prod({ category: { id: CAT_OFF, name: "فصلی", isActive: false } })]));
    render(<ProductsManager />);
    await screen.findByRole("table");
    expect(screen.getByText("دسته‌ی غیرفعال")).toBeInTheDocument();
  });

  it("has no delete control, no stock, no original price, no image control anywhere", async () => {
    render(<ProductsManager />);
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/موجودی|قیمت قبل|ایموجی|خاستگاه|آپلود|بارگذاری تصویر/);
  });

  it("empty state (no filters) offers creation", async () => {
    api.fetchProducts.mockResolvedValue(page([]));
    render(<ProductsManager />);
    expect(await screen.findByText("هنوز محصولی ساخته نشده است")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /محصول جدید/ })[0]!);
    expect(await screen.findByRole("form", { name: "محصول جدید" })).toBeInTheDocument();
  });

  it("empty state with active filters offers to clear them", async () => {
    nav.store.search = `q=zzz&categoryId=${CAT_A}&status=inactive&organic=yes`;
    api.fetchProducts.mockResolvedValue(page([]));
    render(<ProductsManager />);
    expect(await screen.findByText("محصولی با این شرایط پیدا نشد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "پاک‌کردن جست‌وجو و فیلترها" }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/products"));
  });

  it("error state shows the message and retry reloads", async () => {
    api.fetchProducts.mockRejectedValueOnce(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<ProductsManager />);
    expect(await screen.findByText("دریافت محصولات انجام نشد")).toBeInTheDocument();
    expect(screen.getByText("خطای داخلی سرور رخ داد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("network failure shows a Persian message", async () => {
    api.fetchProducts.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ProductsManager />);
    expect(await screen.findByText(/ارتباط با سرور برقرار نشد/)).toBeInTheDocument();
  });

  it("403 → forbidden; 401 → session expired with returnTo=/admin/products", async () => {
    api.fetchProducts.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    const first = render(<ProductsManager />);
    expect(await screen.findByText("دسترسی ندارید")).toBeInTheDocument();
    first.unmount();
    api.fetchProducts.mockRejectedValueOnce(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<ProductsManager />);
    expect(await screen.findByText("نشست شما منقضی شده است")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute("href", `/admin/login?returnTo=${encodeURIComponent("/admin/products")}`);
  });
});

describe("ProductsManager — URL state, search, filters, pagination", () => {
  it("restores q, categoryId, status, organic and page from the URL and falls back safely on garbage", async () => {
    nav.store.search = `q=سیب&categoryId=${CAT_B}&status=inactive&organic=no&page=2`;
    api.fetchProducts.mockResolvedValue(page([prod()], 45, 2));
    render(<ProductsManager />);
    await screen.findByRole("table");
    expect(api.fetchProducts).toHaveBeenCalledWith({ page: 2, limit: 20, search: "سیب", categoryId: CAT_B, isActive: false, isOrganic: false });
    expect(screen.getByLabelText("جست‌وجوی محصول")).toHaveValue("سیب");
    await waitFor(() => expect(screen.getByLabelText("دسته‌بندی", { selector: "#product-category-filter" })).toHaveValue(CAT_B));
    expect(screen.getByLabelText("وضعیت")).toHaveValue("inactive");
    expect(screen.getByLabelText("ارگانیک")).toHaveValue("no");
    cleanup();
    api.fetchProducts.mockClear();
    nav.store.search = "page=-3&status=hacked&organic=maybe&categoryId=%24ne";
    render(<ProductsManager />);
    await screen.findByRole("table");
    expect(api.fetchProducts).toHaveBeenCalledWith({ page: 1, limit: 20, search: undefined, categoryId: undefined, isActive: undefined, isOrganic: undefined });
  });

  it("search is debounced (no request per keystroke), goes into the URL with replace, and resets to page 1", async () => {
    nav.store.search = "page=3";
    api.fetchProducts.mockResolvedValue(page([prod()], 60, 3));
    render(<ProductsManager />);
    await screen.findByRole("table");
    api.fetchProducts.mockClear();
    const box = screen.getByLabelText("جست‌وجوی محصول");
    for (const v of ["س", "سی", "سیب"]) fireEvent.change(box, { target: { value: v } });
    expect(api.fetchProducts).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe(`/admin/products?q=${encodeURIComponent("سیب")}`), { timeout: 2000 });
    await waitFor(() => expect(api.fetchProducts).toHaveBeenCalledTimes(1));
    expect(api.fetchProducts).toHaveBeenCalledWith(expect.objectContaining({ page: 1, search: "سیب" }));
  });

  it("changing category, status or organic pushes to the URL and resets to page 1", async () => {
    nav.store.search = "page=2";
    api.fetchProducts.mockResolvedValue(page([prod()], 45, 2));
    render(<ProductsManager />);
    await screen.findByRole("table");
    await waitFor(() => expect(within(screen.getByLabelText("دسته‌بندی", { selector: "#product-category-filter" })).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText("دسته‌بندی", { selector: "#product-category-filter" }), { target: { value: CAT_A } });
    await waitFor(() => expect(nav.store.push.at(-1)).toBe(`/admin/products?categoryId=${CAT_A}`));
    fireEvent.change(screen.getByLabelText("وضعیت"), { target: { value: "active" } });
    await waitFor(() => expect(nav.store.push.at(-1)).toBe(`/admin/products?categoryId=${CAT_A}&status=active`));
    fireEvent.change(screen.getByLabelText("ارگانیک"), { target: { value: "yes" } });
    await waitFor(() => expect(nav.store.push.at(-1)).toBe(`/admin/products?categoryId=${CAT_A}&status=active&organic=yes`));
    await waitFor(() => expect(api.fetchProducts).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: undefined, categoryId: CAT_A, isActive: true, isOrganic: true }));
  });

  it("the category filter lists every category (inactive ones marked) so legacy assignments can be found", async () => {
    render(<ProductsManager />);
    await screen.findByRole("table");
    const select = screen.getByLabelText("دسته‌بندی", { selector: "#product-category-filter" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(4));
    expect(within(select).getByRole("option", { name: "فصلی (غیرفعال)" })).toBeInTheDocument();
  });

  it("paginates with prev/next buttons and shows the total", async () => {
    api.fetchProducts.mockResolvedValue(page([prod()], 45, 1));
    render(<ProductsManager />);
    await screen.findByRole("table");
    expect(screen.getByText(/صفحه ۱ از ۳ — ۴۵ محصول/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /قبلی/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /بعدی/ }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/products?page=2"));
  });

  it("an out-of-range page falls back to the last page", async () => {
    nav.store.search = "page=9";
    api.fetchProducts.mockResolvedValueOnce(page([], 45, 9)).mockResolvedValue(page([prod()], 45, 3));
    render(<ProductsManager />);
    await waitFor(() => expect(nav.store.replace.at(-1)).toBe("/admin/products?page=3"));
  });
});

describe("ProductsManager — create", () => {
  it("shows the approved fields only — no slug, stock, original price, image or other legacy field", async () => {
    render(<ProductsManager />);
    const form = await openCreate();
    for (const label of ["نام محصول", "دسته‌بندی محصول", "توضیحات (اختیاری)", "ترتیب نمایش", "محصول ارگانیک", "فعال"]) {
      expect(within(form).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(form).getByLabelText("واحد ۱")).toBeInTheDocument();
    expect(within(form).getByLabelText("قیمت واحد ۱ (تومان)")).toBeInTheDocument();
    expect(within(form).getByLabelText("موجود بودن واحد ۱")).toBeInTheDocument();
    expect(form.textContent).not.toMatch(/اسلاگ|نشانی \(slug\):|موجودی|قیمت قبل|ایموجی|خاستگاه|فصل برداشت|نگهداری|پرفروش|فصلی|ویژگی نظر|آپلود|تصویر/);
    expect(within(form).queryByLabelText(/slug/i)).not.toBeInTheDocument();
    expect(within(form).queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });

  it("only ACTIVE categories can be chosen", async () => {
    render(<ProductsManager />);
    const form = await openCreate();
    const options = within(within(form).getByLabelText("دسته‌بندی محصول")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["انتخاب دسته‌بندی", "میوه", "سبزی"]);
    expect(options.join()).not.toContain("فصلی");
  });

  it("creates a product: name normalised, price typed with Persian digits shows live separators and is sent as an integer", async () => {
    api.createProduct.mockResolvedValue(prod({ id: "new" }));
    render(<ProductsManager />);
    const form = await openCreate();
    setField("نام محصول", "  سيب   قرمز ");
    setField("دسته‌بندی محصول", CAT_A);
    setField("توضیحات (اختیاری)", "تازه و آبدار");
    setField("ترتیب نمایش", "۵");
    fireEvent.click(within(form).getByLabelText("محصول ارگانیک"));
    setField("قیمت واحد ۱ (تومان)", "۵۰۰۰۰");
    expect(screen.getByLabelText("قیمت واحد ۱ (تومان)")).toHaveValue("۵۰٬۰۰۰");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
    expect(api.createProduct).toHaveBeenCalledWith({
      name: "سیب قرمز", categoryId: CAT_A, description: "تازه و آبدار", isOrganic: true, isActive: true, sortOrder: 5,
      variants: [{ unit: "kg", price: 50000, isAvailable: true }],
    });
    expect(await screen.findByText("محصول ایجاد شد")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "محصول جدید" })).not.toBeInTheDocument();
  });

  it("after a successful create the list is reloaded without filters on page 1", async () => {
    nav.store.search = `q=zz&status=inactive&page=2`;
    api.fetchProducts.mockResolvedValue(page([prod()], 45, 2));
    api.createProduct.mockResolvedValue(prod());
    render(<ProductsManager />);
    const form = await openCreate();
    setField("نام محصول", "گلابی");
    setField("دسته‌بندی محصول", CAT_A);
    setField("قیمت واحد ۱ (تومان)", "1000");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(nav.store.push.at(-1)).toBe("/admin/products"));
    await waitFor(() => expect(api.fetchProducts).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: undefined, categoryId: undefined, isActive: undefined, isOrganic: undefined }));
  });

  it("sortOrder accepts digits only", async () => {
    render(<ProductsManager />);
    await openCreate();
    setField("ترتیب نمایش", "1.5ab");
    expect(screen.getByLabelText("ترتیب نمایش")).toHaveValue("15");
  });

  describe("variant editor", () => {
    it("adds a second variant with the next unused unit, and a row added in the form can be dropped again", async () => {
      render(<ProductsManager />);
      const form = await openCreate();
      fireEvent.click(within(form).getByRole("button", { name: /افزودن واحد فروش/ }));
      expect(within(form).getByLabelText("واحد ۲")).toHaveValue("gram_500");
      fireEvent.click(within(form).getByRole("button", { name: "حذف ردیف واحد ۲" }));
      expect(within(form).queryByLabelText("واحد ۲")).not.toBeInTheDocument();
      expect(within(form).queryByRole("button", { name: /حذف ردیف/ })).not.toBeInTheDocument(); // the last remaining row cannot be dropped
    });

    it("a unit already used by another row is disabled in the other rows' selects", async () => {
      render(<ProductsManager />);
      const form = await openCreate();
      fireEvent.click(within(form).getByRole("button", { name: /افزودن واحد فروش/ }));
      const second = within(form).getByLabelText("واحد ۲");
      expect((within(second).getByRole("option", { name: "کیلوگرم" }) as HTMLOptionElement).disabled).toBe(true);
      expect((within(second).getByRole("option", { name: "جعبه" }) as HTMLOptionElement).disabled).toBe(false);
    });

    it("the add button is disabled once all five units are used", async () => {
      render(<ProductsManager />);
      const form = await openCreate();
      for (let i = 0; i < 4; i++) fireEvent.click(within(form).getByRole("button", { name: /افزودن واحد فروش/ }));
      expect(within(form).getByRole("button", { name: /افزودن واحد فروش/ })).toBeDisabled();
    });

    it("sends several variants with their availability", async () => {
      api.createProduct.mockResolvedValue(prod());
      render(<ProductsManager />);
      const form = await openCreate();
      setField("نام محصول", "گوجه");
      setField("دسته‌بندی محصول", CAT_B);
      setField("قیمت واحد ۱ (تومان)", "40000");
      fireEvent.click(within(form).getByRole("button", { name: /افزودن واحد فروش/ }));
      setField("واحد ۲", "box");
      setField("قیمت واحد ۲ (تومان)", "300000");
      fireEvent.click(within(form).getByLabelText("موجود بودن واحد ۲"));
      fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
      await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
      expect(api.createProduct.mock.calls[0]![0].variants).toEqual([
        { unit: "kg", price: 40000, isAvailable: true },
        { unit: "box", price: 300000, isAvailable: false },
      ]);
    });
  });

  it("client validation shows a Persian error and sends nothing (name, category, price)", async () => {
    render(<ProductsManager />);
    const form = await openCreate();
    const submit = () => fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    submit();
    expect(await screen.findByText("دسته‌بندی را انتخاب کنید")).toBeInTheDocument();
    setField("دسته‌بندی محصول", CAT_A);
    submit();
    expect(await screen.findByText("نام محصول الزامی است")).toBeInTheDocument();
    setField("نام محصول", "سیب");
    submit();
    expect(await screen.findByText("قیمت الزامی است")).toBeInTheDocument();
    setField("قیمت واحد ۱ (تومان)", "0");
    submit();
    expect(await screen.findByText("قیمت باید حداقل ۱ تومان باشد")).toBeInTheDocument();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("duplicate units cannot be submitted even if the select is forced (client message mirrors the server rule)", async () => {
    render(<ProductsManager />);
    const form = await openCreate();
    setField("نام محصول", "سیب");
    setField("دسته‌بندی محصول", CAT_A);
    setField("قیمت واحد ۱ (تومان)", "100");
    fireEvent.click(within(form).getByRole("button", { name: /افزودن واحد فروش/ }));
    setField("واحد ۲", "kg"); // disabled option, forced through the DOM
    setField("قیمت واحد ۲ (تومان)", "200");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("هر واحد فروش را فقط یک‌بار می‌توان برای یک محصول ثبت کرد")).toBeInTheDocument();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("server errors (inactive category, slug conflict) are shown inline and the entered values are kept", async () => {
    api.createProduct.mockRejectedValue(new ApiClientError(400, "PRODUCT_CATEGORY_INVALID", "دسته‌بندی فعال با این شناسه پیدا نشد"));
    render(<ProductsManager />);
    const form = await openCreate();
    setField("نام محصول", "سیب");
    setField("دسته‌بندی محصول", CAT_A);
    setField("قیمت واحد ۱ (تومان)", "5000");
    fireEvent.click(within(form).getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("دسته‌بندی فعال با این شناسه پیدا نشد")).toBeInTheDocument();
    expect(screen.getByLabelText("نام محصول")).toHaveValue("سیب");
    expect(screen.getByLabelText("قیمت واحد ۱ (تومان)")).toHaveValue("۵٬۰۰۰");
    expect(screen.getByRole("form", { name: "محصول جدید" })).toBeInTheDocument();
  });

  it("while categories are loading/failed the form is replaced by that state (with retry)", async () => {
    catApi.fetchCategories.mockRejectedValueOnce(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<ProductsManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /محصول جدید/ }));
    expect(await screen.findByText("دریافت دسته‌بندی‌ها انجام نشد")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "محصول جدید" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByRole("form", { name: "محصول جدید" })).toBeInTheDocument();
  });

  it("cancel closes the form without calling the API", async () => {
    render(<ProductsManager />);
    const form = await openCreate();
    fireEvent.click(within(form).getByRole("button", { name: /انصراف/ }));
    expect(screen.queryByRole("form", { name: "محصول جدید" })).not.toBeInTheDocument();
    expect(api.createProduct).not.toHaveBeenCalled();
  });
});

describe("ProductsManager — edit", () => {
  const two = prod({
    description: "قدیمی", isOrganic: true, sortOrder: 2,
    variants: [{ id: V1, unit: "kg", price: 50000, isAvailable: true }, { id: V2, unit: "box", price: 400000, isAvailable: true }],
  });

  it("prefills every field (price with separators), shows no slug input, and existing variants cannot be removed", async () => {
    const form = await openEdit(two);
    expect(within(form).getByLabelText("نام محصول")).toHaveValue("سیب قرمز");
    expect(within(form).getByLabelText("دسته‌بندی محصول")).toHaveValue(CAT_A);
    expect(within(form).getByLabelText("توضیحات (اختیاری)")).toHaveValue("قدیمی");
    expect(within(form).getByLabelText("ترتیب نمایش")).toHaveValue("2");
    expect(within(form).getByLabelText("محصول ارگانیک")).toBeChecked();
    expect(within(form).getByLabelText("واحد ۱")).toHaveValue("kg");
    expect(within(form).getByLabelText("قیمت واحد ۱ (تومان)")).toHaveValue("۵۰٬۰۰۰");
    expect(within(form).getByLabelText("قیمت واحد ۲ (تومان)")).toHaveValue("۴۰۰٬۰۰۰");
    expect(within(form).queryByLabelText(/slug/i)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText("فعال")).not.toBeInTheDocument(); // status has its own action
    expect(within(form).queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });

  it("sends only the changed fields", async () => {
    api.updateProduct.mockResolvedValue(prod({ sortOrder: 9 }));
    const form = await openEdit(two);
    setField("ترتیب نمایش", "9");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("p1", { sortOrder: 9 }));
    expect(await screen.findByText("محصول ذخیره شد")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /ویرایش/ })).not.toBeInTheDocument();
  });

  it("sends the COMPLETE variant list with each existing id, plus new rows without an id", async () => {
    api.updateProduct.mockResolvedValue(two);
    const form = await openEdit(two);
    setField("قیمت واحد ۱ (تومان)", "55000");
    fireEvent.click(within(form).getByRole("button", { name: /افزودن واحد فروش/ }));
    setField("قیمت واحد ۳ (تومان)", "9000");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(1));
    expect(api.updateProduct).toHaveBeenCalledWith("p1", {
      variants: [
        { id: V1, unit: "kg", price: 55000, isAvailable: true },
        { id: V2, unit: "box", price: 400000, isAvailable: true },
        { unit: "gram_500", price: 9000, isAvailable: true },
      ],
    });
  });

  it("disabling a variant sends isAvailable=false (never a removal)", async () => {
    api.updateProduct.mockResolvedValue(two);
    const form = await openEdit(two);
    fireEvent.click(within(form).getByLabelText("موجود بودن واحد ۲"));
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(1));
    const sent = api.updateProduct.mock.calls[0]![1].variants as { id?: string; isAvailable: boolean }[];
    expect(sent).toHaveLength(2);
    expect(sent.map((v) => v.id)).toEqual([V1, V2]);
    expect(sent[1]!.isAvailable).toBe(false);
  });

  it("clearing the description sends an empty string", async () => {
    api.updateProduct.mockResolvedValue(two);
    const form = await openEdit(two);
    setField("توضیحات (اختیاری)", "");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("p1", { description: "" }));
  });

  it("moving to another active category sends the new categoryId", async () => {
    api.updateProduct.mockResolvedValue(two);
    const form = await openEdit(two);
    setField("دسته‌بندی محصول", CAT_B);
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("p1", { categoryId: CAT_B }));
  });

  it("a product under a now-inactive category keeps it as an 'unchanged' option, can be edited, and the inactive category is not offered to others", async () => {
    api.updateProduct.mockResolvedValue(two);
    const form = await openEdit(prod({ category: { id: CAT_OFF, name: "فصلی", isActive: false } }));
    const select = within(form).getByLabelText("دسته‌بندی محصول");
    expect(select).toHaveValue(CAT_OFF);
    expect(within(select).getByRole("option", { name: /فصلی \(غیرفعال — بدون تغییر\)/ })).toBeInTheDocument();
    setField("ترتیب نمایش", "4");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("p1", { sortOrder: 4 })); // categoryId NOT sent
  });

  it("an unchanged form just closes without a request", async () => {
    const form = await openEdit(two);
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: /ویرایش/ })).not.toBeInTheDocument());
    expect(api.updateProduct).not.toHaveBeenCalled();
  });

  it("server rejections are shown inline and the form stays open", async () => {
    api.updateProduct.mockRejectedValue(new ApiClientError(409, "PRODUCT_CONCURRENT_UPDATE", "این محصول هم‌زمان توسط درخواست دیگری تغییر کرد؛ صفحه را تازه کنید و دوباره تلاش کنید"));
    const form = await openEdit(two);
    setField("ترتیب نمایش", "7");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText(/هم‌زمان توسط درخواست دیگری/)).toBeInTheDocument();
    expect(screen.getByLabelText("ترتیب نمایش")).toHaveValue("7");
    expect(screen.getByRole("form", { name: /ویرایش/ })).toBeInTheDocument();
  });

  it("client validation: zero price and an empty price are rejected without a request", async () => {
    const form = await openEdit(two);
    setField("قیمت واحد ۱ (تومان)", "0");
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("قیمت باید حداقل ۱ تومان باشد")).toBeInTheDocument();
    expect(api.updateProduct).not.toHaveBeenCalled();
  });
});

describe("ProductsManager — status mutation", () => {
  it("deactivates an active product, updates the row in place and confirms", async () => {
    api.setProductActive.mockResolvedValue(prod({ isActive: false }));
    render(<ProductsManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی سیب قرمز" }));
    await waitFor(() => expect(api.setProductActive).toHaveBeenCalledWith("p1", false));
    expect(await screen.findByText("محصول غیرفعال شد")).toBeInTheDocument();
    expect(within(within(screen.getByRole("table")).getAllByRole("row")[1]!).getAllByRole("cell")[5]).toHaveTextContent("غیرفعال");
    expect(screen.getByRole("button", { name: "فعال‌سازی سیب قرمز" })).toBeInTheDocument();
  });

  it("re-activates an inactive product", async () => {
    api.fetchProducts.mockResolvedValue(page([prod({ isActive: false })]));
    api.setProductActive.mockResolvedValue(prod());
    render(<ProductsManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "فعال‌سازی سیب قرمز" }));
    await waitFor(() => expect(api.setProductActive).toHaveBeenCalledWith("p1", true));
    expect(await screen.findByText("محصول فعال شد")).toBeInTheDocument();
  });

  it("shows the mutation error and leaves the row unchanged", async () => {
    api.setProductActive.mockRejectedValue(new ApiClientError(404, "PRODUCT_NOT_FOUND", "محصول یافت نشد"));
    render(<ProductsManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی سیب قرمز" }));
    expect(await screen.findByText("محصول یافت نشد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "غیرفعال‌سازی سیب قرمز" })).toBeEnabled();
  });

  it("disables the action buttons while a status change is in flight", async () => {
    let resolve!: (v: ProductDto) => void;
    api.setProductActive.mockReturnValue(new Promise<ProductDto>((r) => { resolve = r; }));
    render(<ProductsManager />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "غیرفعال‌سازی سیب قرمز" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "غیرفعال‌سازی سیب قرمز" })).toBeDisabled());
    resolve(prod({ isActive: false }));
    await waitFor(() => expect(screen.getByRole("button", { name: "فعال‌سازی سیب قرمز" })).toBeEnabled());
  });
});
