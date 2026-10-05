import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), findById: vi.fn(), auditCreate: vi.fn() }));
vi.mock("../models/FaqItem", () => ({ FaqItem: { find: m.find, create: m.create, findOneAndUpdate: m.findOneAndUpdate, findById: m.findById } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { createFaq, listFaqs, setFaqActive, updateFaq } from "./faqService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const rec = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(), question: "چرا؟", answer: "چون", sortOrder: 1, isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
});

describe("listFaqs", () => {
  it("lists active AND inactive, sorted sortOrder then _id, as DTOs without internals", async () => {
    const sort = vi.fn().mockReturnValue(lean([rec(), rec({ isActive: false })]));
    m.find.mockReturnValue({ sort });
    const out = await listFaqs();
    expect(m.find).toHaveBeenCalledWith({});
    expect(sort).toHaveBeenCalledWith({ sortOrder: 1, _id: 1 });
    expect(Object.keys(out[0]!).sort()).toEqual(["answer", "createdAt", "id", "isActive", "question", "sortOrder", "updatedAt"]);
    expect(out[1]!.isActive).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("createFaq", () => {
  it("creates active (isActive never from input) and audits faq.created", async () => {
    const created = rec();
    m.create.mockResolvedValue(created);
    const dto = await createFaq(actor, { question: "چرا؟", answer: "چون", sortOrder: 1, isActive: false } as never);
    expect(m.create).toHaveBeenCalledWith({ question: "چرا؟", answer: "چون", sortOrder: 1 });
    expect(dto.isActive).toBe(true);
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "faq.created", entityType: "FaqItem", entityId: created._id,
      before: null, after: { question: "چرا؟", answer: "چون", sortOrder: 1, isActive: true },
    });
  });
  it("omits sortOrder when not provided (model default applies)", async () => {
    m.create.mockResolvedValue(rec());
    await createFaq(actor, { question: "q", answer: "a" });
    expect(m.create.mock.calls[0]![0]).not.toHaveProperty("sortOrder");
  });
});

describe("updateFaq", () => {
  it("sets only provided fields, never isActive, and audits before/after", async () => {
    const before = rec();
    m.findOneAndUpdate.mockReturnValue(lean(before));
    m.findById.mockReturnValue(lean({ ...before, sortOrder: 5 }));
    const dto = await updateFaq(actor, before._id.toString(), { sortOrder: 5, isActive: false } as never);
    expect(m.findOneAndUpdate).toHaveBeenCalledWith({ _id: before._id }, { $set: { sortOrder: 5 } }, { new: false, runValidators: true });
    expect(dto.sortOrder).toBe(5);
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "faq.updated", entityType: "FaqItem", entityId: before._id,
      before: { question: "چرا؟", answer: "چون", sortOrder: 1, isActive: true },
      after: { question: "چرا؟", answer: "چون", sortOrder: 5, isActive: true },
    });
  });
  it("malformed id → 404 FAQ_NOT_FOUND before any query", async () => {
    await expect(updateFaq(actor, "not-an-id", { sortOrder: 1 })).rejects.toMatchObject({ status: 404, code: "FAQ_NOT_FOUND" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it("unknown id → 404 FAQ_NOT_FOUND and no audit", async () => {
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expect(updateFaq(actor, new Types.ObjectId().toString(), { sortOrder: 1 })).rejects.toMatchObject({ status: 404, code: "FAQ_NOT_FOUND" });
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("setFaqActive", () => {
  it("deactivates with a conditional write and audits faq.deactivated", async () => {
    const cur = rec();
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean(cur));
    const dto = await setFaqActive(actor, cur._id.toString(), false);
    expect(m.findOneAndUpdate).toHaveBeenCalledWith({ _id: cur._id, isActive: true }, { $set: { isActive: false } }, { new: false });
    expect(dto.isActive).toBe(false);
    expect(m.auditCreate).toHaveBeenCalledWith({ actorUserId: actor, action: "faq.deactivated", entityType: "FaqItem", entityId: cur._id, before: { isActive: true }, after: { isActive: false } });
  });
  it("activates and audits faq.activated", async () => {
    const cur = rec({ isActive: false });
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean(cur));
    await setFaqActive(actor, cur._id.toString(), true);
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "faq.activated" });
  });
  it("the state it already has → success without write or audit", async () => {
    const cur = rec();
    m.findById.mockReturnValue(lean(cur));
    const dto = await setFaqActive(actor, cur._id.toString(), true);
    expect(dto.isActive).toBe(true);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it("lost race (conditional write matched nothing) → returns the latest state, no audit", async () => {
    const cur = rec();
    m.findById.mockReturnValueOnce(lean(cur)).mockReturnValueOnce(lean({ ...cur, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    expect((await setFaqActive(actor, cur._id.toString(), false)).isActive).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it("malformed/unknown id → 404 FAQ_NOT_FOUND", async () => {
    await expect(setFaqActive(actor, "zzz", true)).rejects.toMatchObject({ status: 404, code: "FAQ_NOT_FOUND" });
    m.findById.mockReturnValue(lean(null));
    await expect(setFaqActive(actor, new Types.ObjectId().toString(), true)).rejects.toMatchObject({ status: 404, code: "FAQ_NOT_FOUND" });
  });
});
