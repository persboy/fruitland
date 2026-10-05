import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findOne: vi.fn(), findOneAndUpdate: vi.fn(), auditCreate: vi.fn() }));
vi.mock("../models/StoreSettings", () => ({ StoreSettings: { findOne: m.findOne, findOneAndUpdate: m.findOneAndUpdate } }));
vi.mock("../models/ShippingSettings", () => ({ ShippingSettings: {} }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { getSocialLinks, getStoreSettings, updateSocialLinks, updateStoreSettings } from "./settingsService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const EMPTY = { instagram: "", telegram: "", whatsapp: "" };
const IG = "https://instagram.com/persboy";

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
});

describe("getSocialLinks", () => {
  it("returns every platform, empty string when not set or when no StoreSettings exists", async () => {
    m.findOne.mockReturnValueOnce(lean(null));
    expect(await getSocialLinks()).toEqual(EMPTY);
    m.findOne.mockReturnValueOnce(lean({ socialLinks: { telegram: "https://t.me/p" } }));
    expect(await getSocialLinks()).toEqual({ ...EMPTY, telegram: "https://t.me/p" });
  });
});

describe("updateSocialLinks — safe partial update of StoreSettings.socialLinks", () => {
  it("1. no StoreSettings document: upserts ONLY the dotted socialLinks path (no store fields), audits with the new id", async () => {
    const id = new Types.ObjectId();
    m.findOne.mockReturnValueOnce(lean(null)).mockReturnValueOnce(lean({ _id: id }));
    m.findOneAndUpdate.mockReturnValue(lean(null)); // inserted
    const out = await updateSocialLinks(actor, { instagram: IG });
    expect(m.findOneAndUpdate).toHaveBeenCalledWith(
      { key: "singleton" },
      { $set: { "socialLinks.instagram": IG }, $setOnInsert: { key: "singleton" } },
      { new: false, upsert: true, runValidators: true },
    );
    const update = m.findOneAndUpdate.mock.calls[0]![1] as Record<string, Record<string, unknown>>;
    expect(Object.keys(update.$set!)).toEqual(["socialLinks.instagram"]);
    expect(update.$setOnInsert).toEqual({ key: "singleton" }); // never storeName / supportPhone / address
    expect(out).toEqual({ ...EMPTY, instagram: IG });
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "siteContent.social_links_updated", entityType: "StoreSettings", entityId: id,
      before: EMPTY, after: { ...EMPTY, instagram: IG },
    });
  });

  it("2/3. existing document (configured or not): updates only the changed platform path and audits before/after", async () => {
    const id = new Types.ObjectId();
    const existing = { _id: id, storeName: "فروشگاه", supportPhone: "021", socialLinks: { telegram: "https://t.me/p" } };
    m.findOne.mockReturnValueOnce(lean(existing));
    m.findOneAndUpdate.mockReturnValue(lean(existing));
    const out = await updateSocialLinks(actor, { whatsapp: "https://wa.me/98912" });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toMatchObject({ $set: { "socialLinks.whatsapp": "https://wa.me/98912" } });
    expect(JSON.stringify(m.findOneAndUpdate.mock.calls[0]![1])).not.toMatch(/storeName|supportPhone|address/);
    expect(out).toEqual({ instagram: "", telegram: "https://t.me/p", whatsapp: "https://wa.me/98912" });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ entityId: id, before: { ...EMPTY, telegram: "https://t.me/p" }, after: { instagram: "", telegram: "https://t.me/p", whatsapp: "https://wa.me/98912" } });
  });

  it('"" clears one platform with $unset and never upserts when nothing is set', async () => {
    const id = new Types.ObjectId();
    const existing = { _id: id, socialLinks: { instagram: IG, telegram: "https://t.me/p" } };
    m.findOne.mockReturnValueOnce(lean(existing));
    m.findOneAndUpdate.mockReturnValue(lean(existing));
    const out = await updateSocialLinks(actor, { instagram: "" });
    expect(m.findOneAndUpdate).toHaveBeenCalledWith(
      { key: "singleton" },
      { $unset: { "socialLinks.instagram": 1 }, $setOnInsert: { key: "singleton" } },
      { new: false, upsert: false, runValidators: true },
    );
    expect(out).toEqual({ ...EMPTY, telegram: "https://t.me/p" });
  });

  it("clearing links when no document exists is a no-op: no write, no audit, no document created", async () => {
    m.findOne.mockReturnValueOnce(lean(null));
    expect(await updateSocialLinks(actor, { instagram: "", telegram: "" })).toEqual(EMPTY);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("unchanged values → no write and no audit", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: new Types.ObjectId(), socialLinks: { instagram: IG } }));
    expect(await updateSocialLinks(actor, { instagram: IG })).toEqual({ ...EMPTY, instagram: IG });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("only the supported platforms are ever written (eitaa/rubika cannot reach the update)", async () => {
    m.findOne.mockReturnValueOnce(lean(null)).mockReturnValueOnce(lean({ _id: new Types.ObjectId() }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await updateSocialLinks(actor, { instagram: IG, eitaa: "https://eitaa.com/x", rubika: "https://rubika.ir/x" } as never);
    expect(JSON.stringify(m.findOneAndUpdate.mock.calls[0]![1])).not.toMatch(/eitaa|rubika/);
  });
});

describe("isConfigured is not affected by social links", () => {
  it("5. a document that holds only socialLinks reads as NOT configured", async () => {
    m.findOne.mockResolvedValue({ key: "singleton", socialLinks: { instagram: IG } });
    expect(await getStoreSettings()).toEqual({ storeName: "", supportPhone: "", address: "", isConfigured: false });
  });
  it("a real Settings save still reads as configured, and no document is still unconfigured", async () => {
    m.findOne.mockResolvedValueOnce({ storeName: "فروشگاه", supportPhone: "021", address: "x", socialLinks: { instagram: IG } });
    expect(await getStoreSettings()).toMatchObject({ storeName: "فروشگاه", supportPhone: "021", isConfigured: true });
    m.findOne.mockResolvedValueOnce(null);
    expect((await getStoreSettings()).isConfigured).toBe(false);
  });
  it("4. saving store settings never touches socialLinks, and a social-links-only document is audited as 'no previous settings'", async () => {
    const id = new Types.ObjectId();
    m.findOne.mockResolvedValue({ _id: id, key: "singleton", socialLinks: { instagram: IG } });
    m.findOneAndUpdate.mockResolvedValue({ _id: id });
    const out = await updateStoreSettings(actor, { storeName: "فروشگاه", supportPhone: "021", address: "" });
    expect(out.isConfigured).toBe(true);
    const update = m.findOneAndUpdate.mock.calls[0]![1] as { $set: Record<string, unknown> };
    expect(Object.keys(update.$set).sort()).toEqual(["address", "storeName", "supportPhone"]);
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "settings.store_updated", before: null });
  });
});
