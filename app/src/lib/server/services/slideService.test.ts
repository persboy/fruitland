import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), findById: vi.fn(), auditCreate: vi.fn() }));
vi.mock("../models/HomepageSlide", () => ({ HomepageSlide: { find: m.find, create: m.create, findOneAndUpdate: m.findOneAndUpdate, findById: m.findById } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { createSlide, listSlides, setSlideActive, updateSlide } from "./slideService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const rec = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(), imageUrl: "https://cdn.example.com/a.jpg", title: "تخفیف", linkUrl: "https://shop.example/offer", sortOrder: 1, isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), ...over,
});
const SNAP = { imageUrl: "https://cdn.example.com/a.jpg", title: "تخفیف", linkUrl: "https://shop.example/offer", sortOrder: 1, isActive: true };

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
});

describe("listSlides", () => {
  it("lists active and inactive by sortOrder then _id; unset title/linkUrl are null", async () => {
    const sort = vi.fn().mockReturnValue(lean([rec({ title: undefined, linkUrl: undefined }), rec({ isActive: false })]));
    m.find.mockReturnValue({ sort });
    const out = await listSlides();
    expect(m.find).toHaveBeenCalledWith({});
    expect(sort).toHaveBeenCalledWith({ sortOrder: 1, _id: 1 });
    expect(out[0]).toMatchObject({ title: null, linkUrl: null });
    expect(Object.keys(out[0]!).sort()).toEqual(["createdAt", "id", "imageUrl", "isActive", "linkUrl", "sortOrder", "title", "updatedAt"]);
    expect(out[1]!.isActive).toBe(false);
  });
});

describe("createSlide", () => {
  it("creates active, stores only validated fields and audits homepageSlide.created", async () => {
    const created = rec();
    m.create.mockResolvedValue(created);
    const dto = await createSlide(actor, { imageUrl: SNAP.imageUrl, title: "تخفیف", linkUrl: SNAP.linkUrl, sortOrder: 1, isActive: false } as never);
    expect(m.create).toHaveBeenCalledWith({ imageUrl: SNAP.imageUrl, title: "تخفیف", linkUrl: SNAP.linkUrl, sortOrder: 1 });
    expect(dto.isActive).toBe(true);
    expect(m.auditCreate).toHaveBeenCalledWith({ actorUserId: actor, action: "homepageSlide.created", entityType: "HomepageSlide", entityId: created._id, before: null, after: SNAP });
  });
  it("empty title/linkUrl are not stored", async () => {
    m.create.mockResolvedValue(rec({ title: undefined, linkUrl: undefined }));
    await createSlide(actor, { imageUrl: SNAP.imageUrl, title: "", linkUrl: "" });
    expect(m.create).toHaveBeenCalledWith({ imageUrl: SNAP.imageUrl });
  });
});

describe("updateSlide", () => {
  it("sets provided fields, persists sortOrder as a plain integer, and audits before/after", async () => {
    const before = rec();
    m.findOneAndUpdate.mockReturnValue(lean(before));
    m.findById.mockReturnValue(lean({ ...before, sortOrder: 7, imageUrl: "https://x.io/b.png" }));
    const dto = await updateSlide(actor, before._id.toString(), { sortOrder: 7, imageUrl: "https://x.io/b.png" });
    expect(m.findOneAndUpdate).toHaveBeenCalledWith({ _id: before._id }, { $set: { imageUrl: "https://x.io/b.png", sortOrder: 7 } }, { new: false, runValidators: true });
    expect(dto.sortOrder).toBe(7);
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "homepageSlide.updated", entityType: "HomepageSlide", entityId: before._id,
      before: SNAP, after: { ...SNAP, sortOrder: 7, imageUrl: "https://x.io/b.png" },
    });
  });
  it('"" clears title and linkUrl with $unset and audits them as null', async () => {
    const before = rec();
    m.findOneAndUpdate.mockReturnValue(lean(before));
    m.findById.mockReturnValue(lean({ ...before, title: undefined, linkUrl: undefined }));
    const dto = await updateSlide(actor, before._id.toString(), { title: "", linkUrl: "" });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $unset: { title: 1, linkUrl: 1 } });
    expect(dto).toMatchObject({ title: null, linkUrl: null });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ after: { ...SNAP, title: null, linkUrl: null } });
  });
  it("never writes isActive here", async () => {
    const before = rec();
    m.findOneAndUpdate.mockReturnValue(lean(before));
    m.findById.mockReturnValue(lean(before));
    await updateSlide(actor, before._id.toString(), { sortOrder: 2, isActive: false } as never);
    expect(JSON.stringify(m.findOneAndUpdate.mock.calls[0]![1])).not.toContain("isActive");
  });
  it("malformed id → 404 SLIDE_NOT_FOUND; unknown id → 404 and no audit", async () => {
    await expect(updateSlide(actor, "bad", { sortOrder: 1 })).rejects.toMatchObject({ status: 404, code: "SLIDE_NOT_FOUND" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expect(updateSlide(actor, new Types.ObjectId().toString(), { sortOrder: 1 })).rejects.toMatchObject({ status: 404, code: "SLIDE_NOT_FOUND" });
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("setSlideActive", () => {
  it.each([[false, "homepageSlide.deactivated"], [true, "homepageSlide.activated"]])("setting isActive=%s audits %s with a conditional write", async (to, action) => {
    const cur = rec({ isActive: !to });
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: to }));
    m.findOneAndUpdate.mockReturnValue(lean(cur));
    const dto = await setSlideActive(actor, cur._id.toString(), to);
    expect(m.findOneAndUpdate).toHaveBeenCalledWith({ _id: cur._id, isActive: !to }, { $set: { isActive: to } }, { new: false });
    expect(dto.isActive).toBe(to);
    expect(m.auditCreate).toHaveBeenCalledWith({ actorUserId: actor, action, entityType: "HomepageSlide", entityId: cur._id, before: { isActive: !to }, after: { isActive: to } });
  });
  it("same state → no write, no audit", async () => {
    const cur = rec();
    m.findById.mockReturnValue(lean(cur));
    await setSlideActive(actor, cur._id.toString(), true);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it("lost race → latest state, no audit; unknown/malformed id → 404", async () => {
    const cur = rec();
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    expect((await setSlideActive(actor, cur._id.toString(), false)).isActive).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled();
    await expect(setSlideActive(actor, "x", true)).rejects.toMatchObject({ status: 404, code: "SLIDE_NOT_FOUND" });
    m.findById.mockReturnValue(lean(null));
    await expect(setSlideActive(actor, new Types.ObjectId().toString(), true)).rejects.toMatchObject({ status: 404, code: "SLIDE_NOT_FOUND" });
  });
});
