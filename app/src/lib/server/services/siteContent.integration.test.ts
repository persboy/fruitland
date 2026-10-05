import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";
import { AuditLog } from "../models/AuditLog";
import { FaqItem } from "../models/FaqItem";
import { HomepageSlide } from "../models/HomepageSlide";
import { SiteContent } from "../models/SiteContent";
import { StoreSettings } from "../models/StoreSettings";
import { createFaq, listFaqs, setFaqActive } from "./faqService";
import { getSocialLinks, getStoreSettings, updateSocialLinks, updateStoreSettings } from "./settingsService";
import { createSlide, listSlides, setSlideActive } from "./slideService";
import { listSiteContentPages, updateSiteContentPage } from "./siteContentService";

/**
 * Real-MongoDB tests for Site Content (standalone mongod is enough: no
 * multi-document transaction is involved). Run with `npm run test:integration`.
 * They prove what the mocked unit tests cannot: the UNIQUE slug index really
 * protects the fixed pages (also under concurrency), status writes persist, and
 * a social-links-only save never makes StoreSettings "configured".
 */
describe("site content (integration, real MongoDB)", () => {
  const actor = new Types.ObjectId().toString();

  beforeAll(async () => {
    await startTestDb();
    await Promise.all([SiteContent.init(), StoreSettings.init(), FaqItem.init(), HomepageSlide.init()]); // build indexes before any write
  }, 120_000);
  afterAll(stopTestDb);
  afterEach(clearTestDb);

  it("1. the unique index rejects a second document for the same page slug", async () => {
    await SiteContent.create({ slug: "about", title: "a", body: "b" });
    await expect(SiteContent.create({ slug: "about", title: "c", body: "d" })).rejects.toMatchObject({ code: 11000 });
    expect(await SiteContent.countDocuments({ slug: "about" })).toBe(1);
  });

  it("2. concurrent first saves of the same page: exactly one document exists; the loser gets SITE_PAGE_SLUG_TAKEN", async () => {
    const results = await Promise.allSettled([
      updateSiteContentPage(actor, "about", { title: "الف", body: "متن الف" }),
      updateSiteContentPage(actor, "about", { title: "ب", body: "متن ب" }),
    ]);
    expect(await SiteContent.countDocuments({ slug: "about" })).toBe(1);
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // Either the second request saw the first one's row (update path) or the index rejected it (409) — never two rows.
    for (const l of lost) expect(l.reason).toMatchObject({ code: "SITE_PAGE_SLUG_TAKEN", status: 409 });
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("page lifecycle: list shows both fixed pages, create, update, unpublish — all persisted and audited", async () => {
    expect((await listSiteContentPages()).map((p) => [p.slug, p.exists])).toEqual([["about", false], ["terms", false]]);
    await updateSiteContentPage(actor, "terms", { title: "قوانین", body: "متن" });
    await updateSiteContentPage(actor, "terms", { body: "متن تازه" });
    await updateSiteContentPage(actor, "terms", { isPublished: false });
    const terms = (await listSiteContentPages()).find((p) => p.slug === "terms")!;
    expect(terms).toMatchObject({ exists: true, title: "قوانین", body: "متن تازه", isPublished: false });
    expect((await AuditLog.find({ entityType: "SiteContent" }).sort({ _id: 1 })).map((a) => a.action)).toEqual([
      "siteContent.page_created", "siteContent.page_updated", "siteContent.page_unpublished",
    ]);
    await expect(updateSiteContentPage(actor, "privacy", { title: "x" })).rejects.toMatchObject({ code: "SITE_PAGE_NOT_FOUND" });
    expect(await SiteContent.countDocuments({})).toBe(1);
  });

  it("3. FAQ and slide status changes are persisted, ordered by sortOrder, audited once per real change, and never deleted", async () => {
    const f = await createFaq(actor, { question: "ب؟", answer: "ب", sortOrder: 2 });
    await createFaq(actor, { question: "الف؟", answer: "الف", sortOrder: 1 });
    expect((await listFaqs()).map((x) => x.question)).toEqual(["الف؟", "ب؟"]);
    await setFaqActive(actor, f.id, false);
    await setFaqActive(actor, f.id, false); // no-op
    expect((await FaqItem.findById(f.id))!.isActive).toBe(false);
    expect(await AuditLog.countDocuments({ action: "faq.deactivated" })).toBe(1);
    expect(await FaqItem.countDocuments({})).toBe(2);

    const s = await createSlide(actor, { imageUrl: "https://cdn.example.com/a.jpg", sortOrder: 0 });
    await setSlideActive(actor, s.id, false);
    expect((await listSlides())[0]).toMatchObject({ id: s.id, isActive: false, title: null, linkUrl: null });
    await setSlideActive(actor, s.id, true);
    expect((await HomepageSlide.findById(s.id))!.isActive).toBe(true);
    expect(await AuditLog.countDocuments({ entityType: "HomepageSlide" })).toBe(3);
  });

  it("4. social links: saving them never makes StoreSettings configured and never touches other Settings fields", async () => {
    expect((await getStoreSettings()).isConfigured).toBe(false);
    await updateSocialLinks(actor, { instagram: "https://instagram.com/persboy" });
    expect(await getSocialLinks()).toEqual({ instagram: "https://instagram.com/persboy", telegram: "", whatsapp: "" });
    expect(await getStoreSettings()).toEqual({ storeName: "", supportPhone: "", address: "", isConfigured: false });

    // A real Settings save configures the store and keeps the social links.
    await updateStoreSettings(actor, { storeName: "فروشگاه", supportPhone: "02112345678", address: "" });
    expect((await getStoreSettings()).isConfigured).toBe(true);
    expect((await getSocialLinks()).instagram).toBe("https://instagram.com/persboy");

    // Editing links afterwards leaves the configured fields intact.
    await updateSocialLinks(actor, { telegram: "https://t.me/persboy", instagram: "" });
    expect(await getSocialLinks()).toEqual({ instagram: "", telegram: "https://t.me/persboy", whatsapp: "" });
    expect(await getStoreSettings()).toEqual({ storeName: "فروشگاه", supportPhone: "02112345678", address: "", isConfigured: true });
    expect(await StoreSettings.countDocuments({})).toBe(1);
  });

  it("clearing links when no StoreSettings exists creates nothing", async () => {
    await updateSocialLinks(actor, { instagram: "", telegram: "", whatsapp: "" });
    expect(await StoreSettings.countDocuments({})).toBe(0);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });
});
