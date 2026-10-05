import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import * as pagesList from "./pages/route";
import * as pageOne from "./pages/[slug]/route";
import * as faqsRoute from "./faqs/route";
import * as faqRoute from "./faqs/[id]/route";
import * as faqStatus from "./faqs/[id]/status/route";
import * as slidesRoute from "./slides/route";
import * as slideRoute from "./slides/[id]/route";
import * as slideStatus from "./slides/[id]/status/route";
import * as socialRoute from "./social-links/route";

const s = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listSiteContentPages: vi.fn(), updateSiteContentPage: vi.fn(),
  listFaqs: vi.fn(), createFaq: vi.fn(), updateFaq: vi.fn(), setFaqActive: vi.fn(),
  listSlides: vi.fn(), createSlide: vi.fn(), updateSlide: vi.fn(), setSlideActive: vi.fn(),
  getSocialLinks: vi.fn(), updateSocialLinks: vi.fn(),
}));
vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: s.requireAdmin }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/siteContentService", () => ({ listSiteContentPages: s.listSiteContentPages, updateSiteContentPage: s.updateSiteContentPage }));
vi.mock("@/lib/server/services/faqService", () => ({ listFaqs: s.listFaqs, createFaq: s.createFaq, updateFaq: s.updateFaq, setFaqActive: s.setFaqActive }));
vi.mock("@/lib/server/services/slideService", () => ({ listSlides: s.listSlides, createSlide: s.createSlide, updateSlide: s.updateSlide, setSlideActive: s.setSlideActive }));
vi.mock("@/lib/server/services/settingsService", () => ({ getSocialLinks: s.getSocialLinks, updateSocialLinks: s.updateSocialLinks }));

const URL_ = "http://localhost/api/v1/admin/site-content/x";
const get = (h: (r: NextRequest) => Promise<Response>) => h(new NextRequest(URL_));
const send = (h: (r: NextRequest, c: never) => Promise<Response>, method: string, body: unknown, ctx: unknown = {}, raw = false) =>
  h(new NextRequest(URL_, { method, headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }), ctx as never);
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const OID = "64b7f0c2a1b2c3d4e5f60718";
const deny401 = () => s.requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
const deny403 = () => s.requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });

beforeEach(() => {
  s.requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
  for (const k of Object.keys(s)) if (k !== "requireAdmin") s[k as keyof typeof s].mockResolvedValue({ ok: true });
});
afterEach(() => vi.clearAllMocks());

describe("no route exposes DELETE / PUT / free creation of pages", () => {
  it.each([
    ["pages", pagesList], ["pages/[slug]", pageOne], ["faqs", faqsRoute], ["faqs/[id]", faqRoute], ["faqs/[id]/status", faqStatus],
    ["slides", slidesRoute], ["slides/[id]", slideRoute], ["slides/[id]/status", slideStatus], ["social-links", socialRoute],
  ])("%s has no DELETE or PUT handler", (_name, mod) => {
    expect(mod).not.toHaveProperty("DELETE");
    expect(mod).not.toHaveProperty("PUT");
  });
  it("pages cannot be created or removed through the API", () => {
    expect(pagesList).not.toHaveProperty("POST");
    expect(pageOne).not.toHaveProperty("POST");
  });
});

describe("authorization on every handler (before any data access)", () => {
  const handlers: [string, () => Promise<Response>, () => ReturnType<typeof vi.fn>][] = [
    ["GET pages", () => get(pagesList.GET), () => s.listSiteContentPages],
    ["PATCH pages/[slug]", () => send(pageOne.PATCH, "PATCH", { title: "t" }, slugCtx("about")), () => s.updateSiteContentPage],
    ["GET faqs", () => get(faqsRoute.GET), () => s.listFaqs],
    ["POST faqs", () => send(faqsRoute.POST, "POST", { question: "q", answer: "a" }), () => s.createFaq],
    ["PATCH faqs/[id]", () => send(faqRoute.PATCH, "PATCH", { sortOrder: 1 }, idCtx(OID)), () => s.updateFaq],
    ["PATCH faqs/[id]/status", () => send(faqStatus.PATCH, "PATCH", { isActive: false }, idCtx(OID)), () => s.setFaqActive],
    ["GET slides", () => get(slidesRoute.GET), () => s.listSlides],
    ["POST slides", () => send(slidesRoute.POST, "POST", { imageUrl: "https://x.io/a.png" }), () => s.createSlide],
    ["PATCH slides/[id]", () => send(slideRoute.PATCH, "PATCH", { sortOrder: 1 }, idCtx(OID)), () => s.updateSlide],
    ["PATCH slides/[id]/status", () => send(slideStatus.PATCH, "PATCH", { isActive: false }, idCtx(OID)), () => s.setSlideActive],
    ["GET social-links", () => get(socialRoute.GET), () => s.getSocialLinks],
    ["PATCH social-links", () => send(socialRoute.PATCH, "PATCH", { instagram: "https://x.io/a" }), () => s.updateSocialLinks],
  ];
  it.each(handlers)("%s: unauthenticated → 401, nothing called", async (_n, call, svc) => {
    deny401();
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: forbidden role → 403, nothing called", async (_n, call, svc) => {
    deny403();
    expect((await call()).status).toBe(403);
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: master_admin is allowed", async (_n, call, svc) => {
    s.requireAdmin.mockReturnValue({ userId: "m1", role: "master_admin" });
    const res = await call();
    expect(res.status).toBeLessThan(300);
    expect(svc()).toHaveBeenCalled();
  });
});

describe("pages", () => {
  it("GET returns the list in the standard envelope", async () => {
    s.listSiteContentPages.mockResolvedValue([{ slug: "about" }]);
    expect(await (await get(pagesList.GET)).json()).toEqual({ success: true, data: [{ slug: "about" }], message: null, pagination: null, error: null });
  });
  it("PATCH passes the actor, the route slug and ONLY validated fields", async () => {
    const res = await send(pageOne.PATCH, "PATCH", { title: " عنوان ", body: "متن", isPublished: true, slug: "terms", role: "master_admin", _id: "x" }, slugCtx("about"));
    expect(res.status).toBe(200);
    expect(s.updateSiteContentPage).toHaveBeenCalledWith("admin1", "about", { title: "عنوان", body: "متن", isPublished: true });
  });
  it.each<[Record<string, unknown>]>([[{}], [{ title: "" }], [{ body: "<script>alert(1)</script>" }], [{ title: "a".repeat(151) }], [{ isPublished: "yes" }]])("validation failure %j → 400 VALIDATION_ERROR", async (body) => {
    const res = await send(pageOne.PATCH, "PATCH", body, slugCtx("about"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.updateSiteContentPage).not.toHaveBeenCalled();
  });
  it("malformed JSON → 400", async () => {
    expect((await send(pageOne.PATCH, "PATCH", "{nope", slugCtx("about"), true)).status).toBe(400);
  });
  it.each([
    [AppError.notFound("x", "SITE_PAGE_NOT_FOUND"), 404, "SITE_PAGE_NOT_FOUND"],
    [AppError.badRequest("x", "SITE_PAGE_CONTENT_REQUIRED"), 400, "SITE_PAGE_CONTENT_REQUIRED"],
    [AppError.conflict("x", "SITE_PAGE_SLUG_TAKEN"), 409, "SITE_PAGE_SLUG_TAKEN"],
  ])("service error maps to a stable code (%#)", async (err, status, code) => {
    s.updateSiteContentPage.mockRejectedValue(err);
    const res = await send(pageOne.PATCH, "PATCH", { title: "t" }, slugCtx("privacy"));
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });
  it("an unexpected error is a generic 500 that leaks nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.updateSiteContentPage.mockRejectedValue(new Error("mongo topology secret"));
    const res = await send(pageOne.PATCH, "PATCH", { title: "t" }, slugCtx("about"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("mongo");
  });
});

describe.each([
  { name: "faqs", list: faqsRoute, item: faqRoute, status: faqStatus, svc: { list: "listFaqs", create: "createFaq", update: "updateFaq", set: "setFaqActive" } as const,
    valid: { question: " چرا؟ ", answer: "چون" }, cleaned: { question: "چرا؟", answer: "چون" }, bad: [{ answer: "a" }, { question: "q" }, { question: "q", answer: "a", sortOrder: -1 }, { question: "q", answer: "a", sortOrder: 1.5 }, { question: "<b>q</b>", answer: "a" }], notFound: "FAQ_NOT_FOUND" },
  { name: "slides", list: slidesRoute, item: slideRoute, status: slideStatus, svc: { list: "listSlides", create: "createSlide", update: "updateSlide", set: "setSlideActive" } as const,
    valid: { imageUrl: " https://cdn.example.com/a.jpg ", linkUrl: "https://shop.example/x" }, cleaned: { imageUrl: "https://cdn.example.com/a.jpg", linkUrl: "https://shop.example/x" },
    bad: [{}, { imageUrl: "javascript:alert(1)" }, { imageUrl: "data:text/html;base64,AAA" }, { imageUrl: "https://x.io/a", linkUrl: "vbscript:x" }, { imageUrl: "https://x.io/a", linkUrl: "/products" }, { imageUrl: "https://x.io/a", sortOrder: -1 }], notFound: "SLIDE_NOT_FOUND" },
])("$name", ({ list, item, status, svc, valid, cleaned, bad, notFound }) => {
  it("GET lists in the standard envelope", async () => {
    s[svc.list].mockResolvedValue([{ id: OID }]);
    const body = await (await get(list.GET)).json();
    expect(body).toEqual({ success: true, data: [{ id: OID }], message: null, pagination: null, error: null });
  });
  it("POST creates with 201 passing the actor and ONLY validated fields (isActive/unknown keys dropped)", async () => {
    const res = await send(list.POST, "POST", { ...valid, sortOrder: 2, isActive: false, role: "master_admin", _id: "x" });
    expect(res.status).toBe(201);
    expect(s[svc.create]).toHaveBeenCalledWith("admin1", { ...cleaned, sortOrder: 2 });
  });
  it.each(bad.map((b) => [b] as [Record<string, unknown>]))("POST validation failure %j → 400 VALIDATION_ERROR, nothing created", async (body) => {
    const res = await send(list.POST, "POST", body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s[svc.create]).not.toHaveBeenCalled();
  });
  it("PATCH [id] updates with the id and validated fields only; isActive is not editable here", async () => {
    const res = await send(item.PATCH, "PATCH", { sortOrder: 4, isActive: false }, idCtx(OID));
    expect(res.status).toBe(200);
    expect(s[svc.update]).toHaveBeenCalledWith("admin1", OID, { sortOrder: 4 });
  });
  it("PATCH [id] with only isActive/unknown keys → 400 (nothing to edit)", async () => {
    expect((await send(item.PATCH, "PATCH", { isActive: false }, idCtx(OID))).status).toBe(400);
    expect(s[svc.update]).not.toHaveBeenCalled();
  });
  it("PATCH [id] malformed id / missing record → the service's stable 404", async () => {
    s[svc.update].mockRejectedValue(AppError.notFound("x", notFound));
    const res = await send(item.PATCH, "PATCH", { sortOrder: 1 }, idCtx("not-an-id"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe(notFound);
  });
  it.each([true, false])("PATCH [id]/status sets isActive=%s explicitly", async (isActive) => {
    const res = await send(status.PATCH, "PATCH", { isActive }, idCtx(OID));
    expect(res.status).toBe(200);
    expect(s[svc.set]).toHaveBeenCalledWith("admin1", OID, isActive);
  });
  it.each([[{}], [{ isActive: "false" }], [{ isActive: 1 }]])("status validation failure %j → 400", async (body) => {
    expect((await send(status.PATCH, "PATCH", body, idCtx(OID))).status).toBe(400);
    expect(s[svc.set]).not.toHaveBeenCalled();
  });
  it("status on a missing record → 404 with the stable code", async () => {
    s[svc.set].mockRejectedValue(AppError.notFound("x", notFound));
    const res = await send(status.PATCH, "PATCH", { isActive: true }, idCtx(OID));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe(notFound);
  });
  it("an unexpected service error is a generic 500 that leaks nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    s[svc.create].mockRejectedValue(new Error("mongo secret"));
    const res = await send(list.POST, "POST", valid);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("mongo");
  });
});

describe("social-links", () => {
  it("GET returns the links", async () => {
    s.getSocialLinks.mockResolvedValue({ instagram: "", telegram: "", whatsapp: "" });
    expect((await (await get(socialRoute.GET)).json()).data).toEqual({ instagram: "", telegram: "", whatsapp: "" });
  });
  it("PATCH accepts only instagram/telegram/whatsapp (eitaa/rubika dropped) and passes the actor", async () => {
    const res = await send(socialRoute.PATCH, "PATCH", { instagram: "https://instagram.com/p", telegram: "", eitaa: "https://eitaa.com/x", rubika: "https://rubika.ir/x" });
    expect(res.status).toBe(200);
    expect(s.updateSocialLinks).toHaveBeenCalledWith("admin1", { instagram: "https://instagram.com/p", telegram: "" });
  });
  it.each([[{}], [{ eitaa: "https://eitaa.com/x" }], [{ instagram: "javascript:alert(1)" }], [{ telegram: "data:text/html,x" }], [{ whatsapp: "t.me/x" }], [{ instagram: 5 }]])("validation failure %j → 400 and nothing is written", async (body) => {
    const res = await send(socialRoute.PATCH, "PATCH", body);
    expect(res.status).toBe(400);
    expect(s.updateSocialLinks).not.toHaveBeenCalled();
  });
});
