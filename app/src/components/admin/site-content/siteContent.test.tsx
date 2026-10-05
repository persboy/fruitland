import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiClientError } from "@/lib/client/apiClient";
import type { FaqDto, SiteContentPageDto, SlideDto } from "@fruitland/shared";

const api = vi.hoisted(() => ({
  fetchSitePages: vi.fn(), updateSitePage: vi.fn(),
  fetchFaqs: vi.fn(), createFaq: vi.fn(), updateFaq: vi.fn(), setFaqActive: vi.fn(),
  fetchSlides: vi.fn(), createSlide: vi.fn(), updateSlide: vi.fn(), setSlideActive: vi.fn(),
  fetchSocialLinks: vi.fn(), updateSocialLinks: vi.fn(),
}));
vi.mock("@/lib/client/adminSiteContent", () => api);

import { SiteContentManager } from "./SiteContentManager";
import { FaqSection } from "./FaqSection";
import { PagesSection } from "./PagesSection";
import { SlidesSection } from "./SlidesSection";
import { SocialLinksSection } from "./SocialLinksSection";

const T = "2026-01-01T00:00:00.000Z";
const pageDto = (over: Partial<SiteContentPageDto> = {}): SiteContentPageDto => ({
  slug: "about", label: "درباره ما", title: "درباره ما", body: "متن قدیمی", isPublished: true, exists: true, updatedAt: T, ...over,
});
const unsaved = (slug: "about" | "terms", label: string): SiteContentPageDto => ({ slug, label, title: "", body: "", isPublished: false, exists: false, updatedAt: null });
const faq = (over: Partial<FaqDto> = {}): FaqDto => ({ id: "f1", question: "ارسال چقدر طول می‌کشد؟", answer: "زیاد نه", sortOrder: 1, isActive: true, createdAt: T, updatedAt: T, ...over });
const slide = (over: Partial<SlideDto> = {}): SlideDto => ({ id: "s1", imageUrl: "https://cdn.example.com/a.jpg", title: "تخفیف", linkUrl: "https://shop.example/offer", sortOrder: 1, isActive: true, createdAt: T, updatedAt: T, ...over });
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchSitePages.mockResolvedValue([pageDto(), pageDto({ slug: "terms", label: "قوانین و مقررات", title: "قوانین", body: "ب" })]);
  api.fetchFaqs.mockResolvedValue([]);
  api.fetchSlides.mockResolvedValue([]);
  api.fetchSocialLinks.mockResolvedValue({ instagram: "", telegram: "", whatsapp: "" });
});
afterEach(cleanup);

describe("SiteContentManager", () => {
  it("renders the four approved sections and shows a loading state per section first", async () => {
    render(<SiteContentManager />);
    expect(screen.getAllByRole("status")).toHaveLength(4);
    for (const name of ["صفحات ثابت", "سؤالات متداول", "اسلایدهای صفحه‌ی اصلی", "شبکه‌های اجتماعی"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" })).toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "ویرایش لینک‌های شبکه‌های اجتماعی" })).toBeInTheDocument();
  });

  it("one failing section does not take the others down", async () => {
    api.fetchFaqs.mockRejectedValue(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<SiteContentManager />);
    expect(await screen.findByText("دریافت سؤالات متداول انجام نشد")).toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "ویرایش لینک‌های شبکه‌های اجتماعی" })).toBeInTheDocument();
  });

  it("403 in every section shows the forbidden state and no editing controls", async () => {
    for (const f of [api.fetchSitePages, api.fetchFaqs, api.fetchSlides, api.fetchSocialLinks]) f.mockRejectedValue(new ApiClientError(403, "FORBIDDEN_ROLE", "x"));
    render(<SiteContentManager />);
    await waitFor(() => expect(screen.getAllByText("دسترسی ندارید")).toHaveLength(4));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /جدید/ })).not.toBeInTheDocument();
  });

  it("401 shows a re-login link that returns to /admin/site-content", async () => {
    api.fetchFaqs.mockRejectedValue(new ApiClientError(401, "UNAUTHENTICATED", "x"));
    render(<FaqSection />);
    const link = await screen.findByRole("link", { name: "ورود" });
    expect(link).toHaveAttribute("href", `/admin/login?returnTo=${encodeURIComponent("/admin/site-content")}`);
    expect(screen.getByText("نشست شما منقضی شده است")).toBeInTheDocument();
  });

  it("offers no hard-delete, move up/down, upload or rich-text controls anywhere", async () => {
    api.fetchFaqs.mockResolvedValue([faq()]);
    api.fetchSlides.mockResolvedValue([slide()]);
    const { container } = render(<SiteContentManager />);
    await screen.findAllByRole("table");
    expect(screen.queryByRole("button", { name: /حذف|پاک/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /بالا|پایین|جابه‌جایی/ })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector("[contenteditable], [dangerouslysetinnerhtml]")).toBeNull();
    expect(screen.queryByLabelText(/ایتا|روبیکا/)).not.toBeInTheDocument();
  });
});

describe("PagesSection", () => {
  it("shows exactly the fixed pages with title/body/publication controls and no slug input", async () => {
    render(<PagesSection />);
    expect(await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "ویرایش صفحه‌ی قوانین و مقررات" })).toBeInTheDocument();
    expect(screen.getAllByRole("form")).toHaveLength(2);
    expect(screen.queryByLabelText(/slug|شناسه|نشانی/i)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("عنوان")).toHaveLength(2);
    expect(screen.getAllByLabelText(/متن \(فقط متن ساده\)/)).toHaveLength(2);
    expect(screen.getAllByLabelText("منتشر شود")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "ذخیره" })).toHaveLength(2);
  });

  it("an unsaved page is marked as such and needs title and body before the first save", async () => {
    api.fetchSitePages.mockResolvedValue([unsaved("about", "درباره ما"), unsaved("terms", "قوانین و مقررات")]);
    render(<PagesSection />);
    const form = await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" });
    expect(screen.getAllByText("هنوز ذخیره نشده")).toHaveLength(2);
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText("عنوان صفحه الزامی است")).toBeInTheDocument();
    expect(api.updateSitePage).not.toHaveBeenCalled();
  });

  it("first save sends title, body and isPublished; the card then shows the saved state", async () => {
    api.fetchSitePages.mockResolvedValue([unsaved("about", "درباره ما")]);
    api.updateSitePage.mockResolvedValue(pageDto({ title: "عنوان", body: "متن" }));
    render(<PagesSection />);
    const form = await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" });
    fireEvent.change(within(form).getByLabelText("عنوان"), { target: { value: "عنوان" } });
    fireEvent.change(within(form).getByLabelText(/متن/), { target: { value: "متن" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateSitePage).toHaveBeenCalledWith("about", { title: "عنوان", body: "متن", isPublished: true }));
    expect(await within(form).findByText("صفحه ذخیره شد")).toBeInTheDocument();
    expect(within(form).getByText("منتشرشده")).toBeInTheDocument();
  });

  it("editing sends only the changed fields; unpublishing is sent as isPublished:false", async () => {
    api.updateSitePage.mockResolvedValue(pageDto({ isPublished: false }));
    render(<PagesSection />);
    const form = await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" });
    fireEvent.click(within(form).getByLabelText("منتشر شود"));
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateSitePage).toHaveBeenCalledWith("about", { isPublished: false }));
    expect(await within(form).findByText("منتشرنشده")).toBeInTheDocument();
  });

  it("no change → no request", async () => {
    render(<PagesSection />);
    const form = await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText("تغییری برای ذخیره وجود ندارد")).toBeInTheDocument();
    expect(api.updateSitePage).not.toHaveBeenCalled();
  });

  it("HTML in the body is rejected on the client (the server stays authoritative)", async () => {
    render(<PagesSection />);
    const form = await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" });
    fireEvent.change(within(form).getByLabelText(/متن/), { target: { value: "<script>alert(1)</script>" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText(/نمی‌تواند شامل HTML باشد/)).toBeInTheDocument();
    expect(api.updateSitePage).not.toHaveBeenCalled();
  });

  it("a server error is shown inline and the typed values are kept", async () => {
    api.updateSitePage.mockRejectedValue(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<PagesSection />);
    const form = await screen.findByRole("form", { name: "ویرایش صفحه‌ی درباره ما" });
    fireEvent.change(within(form).getByLabelText("عنوان"), { target: { value: "عنوان جدید" } });
    fireEvent.click(within(form).getByRole("button", { name: "ذخیره" }));
    expect(await within(form).findByText("خطای داخلی سرور رخ داد")).toBeInTheDocument();
    expect(within(form).getByLabelText("عنوان")).toHaveValue("عنوان جدید");
  });
});

describe("FaqSection", () => {
  it("lists items with question, order, status and actions — and no delete", async () => {
    api.fetchFaqs.mockResolvedValue([faq(), faq({ id: "f2", question: "پرداخت؟", sortOrder: 2, isActive: false })]);
    render(<FaqSection />);
    expect(screen.getByRole("status", { name: "در حال دریافت سؤالات متداول" })).toBeInTheDocument();
    const rows = within(await screen.findByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("فعال")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("غیرفعال")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "غیرفعال‌سازی ارسال چقدر طول می‌کشد؟" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فعال‌سازی پرداخت؟" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });

  it("empty state offers creation", async () => {
    render(<FaqSection />);
    expect(await screen.findByText("هنوز سؤال متداولی ثبت نشده است")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /سؤال متداول جدید/ }).length).toBeGreaterThan(0);
  });

  it("error state shows the message and retry reloads", async () => {
    api.fetchFaqs.mockRejectedValueOnce(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    api.fetchFaqs.mockResolvedValueOnce([faq()]);
    render(<FaqSection />);
    expect(await screen.findByText("دریافت سؤالات متداول انجام نشد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("create: validates, then sends the parsed input; Persian digits become the integer sortOrder", async () => {
    api.createFaq.mockResolvedValue(faq({ id: "f9", question: "جدید؟", answer: "بله", sortOrder: 12 }));
    render(<FaqSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: /سؤال متداول جدید/ }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("سؤال الزامی است")).toBeInTheDocument();
    expect(api.createFaq).not.toHaveBeenCalled();
    fill("سؤال", "جدید؟");
    fill(/پاسخ/, "بله");
    fill("ترتیب نمایش", "۱۲");
    fireEvent.click(screen.getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createFaq).toHaveBeenCalledWith({ question: "جدید؟", answer: "بله", sortOrder: 12 }));
    expect(await screen.findByText("سؤال متداول ایجاد شد")).toBeInTheDocument();
    expect(await screen.findByText("جدید؟")).toBeInTheDocument();
  });

  it("sortOrder accepts digits only", async () => {
    render(<FaqSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: /سؤال متداول جدید/ }))[0]!);
    fill("ترتیب نمایش", "-4.5ab");
    expect(screen.getByLabelText("ترتیب نمایش")).toHaveValue("45");
  });

  it("edit sends only what changed and updates the row", async () => {
    api.fetchFaqs.mockResolvedValue([faq()]);
    api.updateFaq.mockResolvedValue(faq({ sortOrder: 5 }));
    render(<FaqSection />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش ارسال چقدر طول می‌کشد؟" }));
    fill("ترتیب نمایش", "5");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateFaq).toHaveBeenCalledWith("f1", { sortOrder: 5 }));
    expect(await screen.findByText("سؤال متداول ذخیره شد")).toBeInTheDocument();
  });

  it("deactivate and activate call the explicit status operation", async () => {
    api.fetchFaqs.mockResolvedValue([faq()]);
    api.setFaqActive.mockResolvedValueOnce(faq({ isActive: false })).mockResolvedValueOnce(faq({ isActive: true }));
    render(<FaqSection />);
    fireEvent.click(await screen.findByRole("button", { name: "غیرفعال‌سازی ارسال چقدر طول می‌کشد؟" }));
    await waitFor(() => expect(api.setFaqActive).toHaveBeenCalledWith("f1", false));
    expect(await screen.findByText("سؤال متداول غیرفعال شد")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "فعال‌سازی ارسال چقدر طول می‌کشد؟" }));
    await waitFor(() => expect(api.setFaqActive).toHaveBeenLastCalledWith("f1", true));
  });

  it("a failing status change shows an inline error and keeps the row", async () => {
    api.fetchFaqs.mockResolvedValue([faq()]);
    api.setFaqActive.mockRejectedValue(new ApiClientError(404, "FAQ_NOT_FOUND", "سؤال متداول یافت نشد"));
    render(<FaqSection />);
    fireEvent.click(await screen.findByRole("button", { name: "غیرفعال‌سازی ارسال چقدر طول می‌کشد؟" }));
    expect(await screen.findByText("سؤال متداول یافت نشد")).toBeInTheDocument();
    expect(screen.getByText("فعال")).toBeInTheDocument();
  });
});

describe("SlidesSection", () => {
  it("lists slides with thumbnail from the external imageUrl, title, link, order, status — no move or delete", async () => {
    api.fetchSlides.mockResolvedValue([slide(), slide({ id: "s2", title: null, linkUrl: null, imageUrl: "https://cdn.example.com/b.jpg", sortOrder: 2, isActive: false })]);
    render(<SlidesSection />);
    const table = await screen.findByRole("table");
    const imgs = within(table).getAllByRole("img");
    expect(imgs[0]).toHaveAttribute("src", "https://cdn.example.com/a.jpg");
    expect(imgs[1]).toHaveAttribute("src", "https://cdn.example.com/b.jpg");
    expect(within(table).getByText("تخفیف")).toBeInTheDocument();
    expect(within(table).getByText("غیرفعال")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف|بالا|پایین|جابه‌جایی/ })).not.toBeInTheDocument();
  });

  it("a broken image URL falls back to a placeholder instead of a broken image", async () => {
    api.fetchSlides.mockResolvedValue([slide()]);
    render(<SlidesSection />);
    const img = within(await screen.findByRole("table")).getByRole("img");
    fireEvent.error(img);
    expect(await screen.findByRole("img", { name: "تصویر قابل نمایش نیست" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByAltText("پیش‌نمایش تصویر اسلاید")).not.toBeInTheDocument();
  });

  it("empty state offers creation", async () => {
    render(<SlidesSection />);
    expect(await screen.findByText("هنوز اسلایدی ثبت نشده است")).toBeInTheDocument();
  });

  it("create: shows a live preview only for a valid http(s) URL and has no file input", async () => {
    render(<SlidesSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: /اسلاید جدید/ }))[0]!);
    const form = screen.getByRole("form", { name: "اسلاید جدید" });
    expect(form.querySelector('input[type="file"]')).toBeNull();
    expect(within(form).queryByRole("img")).not.toBeInTheDocument();
    fill("آدرس تصویر (URL)", "javascript:alert(1)");
    expect(within(form).queryByRole("img")).not.toBeInTheDocument();
    fill("آدرس تصویر (URL)", "https://cdn.example.com/p.jpg");
    expect(within(form).getByRole("img")).toHaveAttribute("src", "https://cdn.example.com/p.jpg");
  });

  it.each(["javascript:alert(1)", "data:text/html;base64,AAA", "/relative", "example.com/a.png"])("rejects the unsafe image URL %s before any request", async (bad) => {
    render(<SlidesSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: /اسلاید جدید/ }))[0]!);
    fill("آدرس تصویر (URL)", bad);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("آدرس تصویر باید با http:// یا https:// شروع شود")).toBeInTheDocument();
    expect(api.createSlide).not.toHaveBeenCalled();
  });

  it("rejects an unsafe link URL and an empty image URL", async () => {
    render(<SlidesSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: /اسلاید جدید/ }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("آدرس تصویر الزامی است")).toBeInTheDocument();
    fill("آدرس تصویر (URL)", "https://cdn.example.com/p.jpg");
    fill("لینک مقصد", "vbscript:msgbox(1)");
    fireEvent.click(screen.getByRole("button", { name: "ایجاد" }));
    expect(await screen.findByText("لینک مقصد باید با http:// یا https:// شروع شود")).toBeInTheDocument();
    expect(api.createSlide).not.toHaveBeenCalled();
  });

  it("create sends the parsed input; an empty optional link/title is allowed", async () => {
    api.createSlide.mockResolvedValue(slide({ id: "s9", title: null, linkUrl: null, imageUrl: "https://cdn.example.com/p.jpg", sortOrder: 3 }));
    render(<SlidesSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: /اسلاید جدید/ }))[0]!);
    fill("آدرس تصویر (URL)", " https://cdn.example.com/p.jpg ");
    fill("ترتیب نمایش", "3");
    fireEvent.click(screen.getByRole("button", { name: "ایجاد" }));
    await waitFor(() => expect(api.createSlide).toHaveBeenCalledWith({ imageUrl: "https://cdn.example.com/p.jpg", title: "", linkUrl: "", sortOrder: 3 }));
    expect(await screen.findByText("اسلاید ایجاد شد")).toBeInTheDocument();
  });

  it("edit sends only changed fields; clearing the link sends an empty string", async () => {
    api.fetchSlides.mockResolvedValue([slide()]);
    api.updateSlide.mockResolvedValue(slide({ linkUrl: null }));
    render(<SlidesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش تخفیف" }));
    fill("لینک مقصد", "");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateSlide).toHaveBeenCalledWith("s1", { linkUrl: "" }));
    expect(await screen.findByText("اسلاید ذخیره شد")).toBeInTheDocument();
  });

  it("deactivate calls the explicit status operation", async () => {
    api.fetchSlides.mockResolvedValue([slide()]);
    api.setSlideActive.mockResolvedValue(slide({ isActive: false }));
    render(<SlidesSection />);
    fireEvent.click(await screen.findByRole("button", { name: "غیرفعال‌سازی تخفیف" }));
    await waitFor(() => expect(api.setSlideActive).toHaveBeenCalledWith("s1", false));
    expect(await screen.findByText("اسلاید غیرفعال شد")).toBeInTheDocument();
  });
});

describe("SocialLinksSection", () => {
  it("shows exactly Instagram, Telegram and WhatsApp — never Eitaa or Rubika", async () => {
    api.fetchSocialLinks.mockResolvedValue({ instagram: "https://instagram.com/p", telegram: "", whatsapp: "" });
    render(<SocialLinksSection />);
    const form = await screen.findByRole("form", { name: "ویرایش لینک‌های شبکه‌های اجتماعی" });
    expect(within(form).getByLabelText("اینستاگرام")).toHaveValue("https://instagram.com/p");
    expect(within(form).getByLabelText("تلگرام")).toHaveValue("");
    expect(within(form).getByLabelText("واتس‌اپ")).toHaveValue("");
    expect(within(form).getAllByRole("textbox")).toHaveLength(3);
    expect(screen.queryByLabelText(/ایتا|روبیکا/)).not.toBeInTheDocument();
    // no Settings configuration fields on this page
    expect(screen.queryByLabelText(/نام فروشگاه|شماره پشتیبانی|آدرس فروشگاه/)).not.toBeInTheDocument();
  });

  it("editing sends only the changed platforms; clearing sends an empty string", async () => {
    api.fetchSocialLinks.mockResolvedValue({ instagram: "https://instagram.com/p", telegram: "", whatsapp: "" });
    api.updateSocialLinks.mockResolvedValue({ instagram: "", telegram: "https://t.me/p", whatsapp: "" });
    render(<SocialLinksSection />);
    await screen.findByRole("form", { name: "ویرایش لینک‌های شبکه‌های اجتماعی" });
    fill("اینستاگرام", "");
    fill("تلگرام", "https://t.me/p");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(api.updateSocialLinks).toHaveBeenCalledWith({ instagram: "", telegram: "https://t.me/p" }));
    expect(await screen.findByText("لینک‌های شبکه‌های اجتماعی ذخیره شد")).toBeInTheDocument();
    expect(screen.getByLabelText("اینستاگرام")).toHaveValue("");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "t.me/p", "ftp://x.io/a"])("rejects %s before any request", async (bad) => {
    render(<SocialLinksSection />);
    await screen.findByRole("form", { name: "ویرایش لینک‌های شبکه‌های اجتماعی" });
    fill("تلگرام", bad);
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("لینک تلگرام باید با http:// یا https:// شروع شود")).toBeInTheDocument();
    expect(api.updateSocialLinks).not.toHaveBeenCalled();
  });

  it("no change → no request; a server error is shown inline", async () => {
    api.updateSocialLinks.mockRejectedValue(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<SocialLinksSection />);
    await screen.findByRole("form", { name: "ویرایش لینک‌های شبکه‌های اجتماعی" });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("تغییری برای ذخیره وجود ندارد")).toBeInTheDocument();
    expect(api.updateSocialLinks).not.toHaveBeenCalled();
    fill("واتس‌اپ", "https://wa.me/98912");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(await screen.findByText("خطای داخلی سرور رخ داد")).toBeInTheDocument();
    expect(screen.getByLabelText("واتس‌اپ")).toHaveValue("https://wa.me/98912");
  });
});
