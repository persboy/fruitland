import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), findOne: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), auditCreate: vi.fn() }));
vi.mock("../models/SiteContent", () => ({ SiteContent: { find: m.find, findOne: m.findOne, create: m.create, findOneAndUpdate: m.findOneAndUpdate } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { listSiteContentPages, updateSiteContentPage } from "./siteContentService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const page = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(), slug: "about", title: "درباره ما", body: "متن", isPublished: true,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), ...over,
});
const dupKey = () => Object.assign(new Error("E11000 duplicate key slug_1"), { code: 11000 });

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
});

describe("listSiteContentPages", () => {
  it("always returns the fixed pages in order; a never-saved page is exists:false, empty and unpublished", async () => {
    m.find.mockReturnValue(lean([page({ slug: "terms", title: "قوانین", body: "ب", isPublished: false })]));
    const out = await listSiteContentPages();
    expect(m.find).toHaveBeenCalledWith({ slug: { $in: ["about", "terms"] } });
    expect(out.map((p) => p.slug)).toEqual(["about", "terms"]);
    expect(out[0]).toEqual({ slug: "about", label: "درباره ما", title: "", body: "", isPublished: false, exists: false, updatedAt: null });
    expect(out[1]).toMatchObject({ slug: "terms", title: "قوانین", isPublished: false, exists: true, updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("updateSiteContentPage", () => {
  it("unknown slug → 404 SITE_PAGE_NOT_FOUND before any database access", async () => {
    await expect(updateSiteContentPage(actor, "privacy", { title: "x" })).rejects.toMatchObject({ status: 404, code: "SITE_PAGE_NOT_FOUND" });
    expect(m.findOne).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("first save creates the page (slug from the route, never the body) and audits page_created", async () => {
    m.findOne.mockReturnValue(lean(null));
    const created = page();
    m.create.mockResolvedValue(created);
    const dto = await updateSiteContentPage(actor, "about", { title: "درباره ما", body: "متن", isPublished: true, slug: "terms" } as never);
    expect(m.create).toHaveBeenCalledWith({ slug: "about", title: "درباره ما", body: "متن", isPublished: true });
    expect(dto).toMatchObject({ slug: "about", exists: true, isPublished: true });
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "siteContent.page_created", entityType: "SiteContent", entityId: created._id,
      before: null, after: { slug: "about", title: "درباره ما", body: "متن", isPublished: true },
    });
  });

  it("first save without isPublished keeps the model default (not passed)", async () => {
    m.findOne.mockReturnValue(lean(null));
    m.create.mockResolvedValue(page());
    await updateSiteContentPage(actor, "about", { title: "t", body: "b" });
    expect(m.create.mock.calls[0]![0]).not.toHaveProperty("isPublished");
  });

  it.each([[{ title: "t" }], [{ body: "b" }], [{ isPublished: true }]])("first save with %j → 400 SITE_PAGE_CONTENT_REQUIRED and nothing is written", async (input) => {
    m.findOne.mockReturnValue(lean(null));
    await expect(updateSiteContentPage(actor, "about", input)).rejects.toMatchObject({ status: 400, code: "SITE_PAGE_CONTENT_REQUIRED" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("duplicate-key on create (concurrent first save) → 409 SITE_PAGE_SLUG_TAKEN, no audit, no raw Mongo error", async () => {
    m.findOne.mockReturnValue(lean(null));
    m.create.mockRejectedValue(dupKey());
    const err = await updateSiteContentPage(actor, "about", { title: "t", body: "b" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "AppError", status: 409, code: "SITE_PAGE_SLUG_TAKEN" });
    expect(String((err as Error).message)).not.toContain("E11000");
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("a non-duplicate create error is rethrown untouched", async () => {
    m.findOne.mockReturnValue(lean(null));
    m.create.mockRejectedValue(new Error("boom"));
    await expect(updateSiteContentPage(actor, "about", { title: "t", body: "b" })).rejects.toThrow("boom");
  });

  it("updates only changed fields atomically and audits page_updated with before/after", async () => {
    const current = page();
    m.findOne.mockReturnValueOnce(lean(current)).mockReturnValueOnce(lean({ ...current, title: "جدید", updatedAt: new Date("2026-02-01T00:00:00Z") }));
    m.findOneAndUpdate.mockReturnValue(lean(current));
    const dto = await updateSiteContentPage(actor, "about", { title: "جدید", body: "متن" });
    expect(m.findOneAndUpdate).toHaveBeenCalledWith({ slug: "about" }, { $set: { title: "جدید" } }, { new: false, runValidators: true });
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "siteContent.page_updated", entityType: "SiteContent", entityId: current._id,
      before: { title: "درباره ما", body: "متن", isPublished: true }, after: { title: "جدید", body: "متن", isPublished: true },
    });
    expect(dto.title).toBe("جدید");
  });

  it.each([[false, "siteContent.page_unpublished"], [true, "siteContent.page_published"]])("publication-only change to %s audits %s", async (to, action) => {
    const current = page({ isPublished: !to });
    m.findOne.mockReturnValue(lean(current));
    m.findOneAndUpdate.mockReturnValue(lean(current));
    await updateSiteContentPage(actor, "about", { isPublished: to });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $set: { isPublished: to } });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action, before: { isPublished: !to }, after: { isPublished: to } });
  });

  it("a request that changes nothing performs no write and no audit", async () => {
    const current = page();
    m.findOne.mockReturnValue(lean(current));
    const dto = await updateSiteContentPage(actor, "about", { title: "درباره ما", isPublished: true });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(dto.exists).toBe(true);
  });

  it("the page vanishing between read and write → 404", async () => {
    m.findOne.mockReturnValue(lean(page()));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expect(updateSiteContentPage(actor, "about", { title: "x" })).rejects.toMatchObject({ status: 404, code: "SITE_PAGE_NOT_FOUND" });
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});
