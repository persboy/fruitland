import { describe, expect, it } from "vitest";
import {
  SITE_CONTENT_PAGE_SLUGS,
  createFaqSchema,
  createSlideSchema,
  faqStatusSchema,
  looksLikeHtml,
  siteContentPageSlugSchema,
  slideStatusSchema,
  updateFaqSchema,
  updateSiteContentPageSchema,
  updateSlideSchema,
  updateSocialLinksSchema,
} from "./siteContent";

const DANGEROUS = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,AAA", "vbscript:msgbox(1)", "ftp://example.com/x", "//example.com/x", "/products", "example.com", "http://", "https:// spaced.com", "http://exa mple.com"];

describe("page slug", () => {
  it.each(SITE_CONTENT_PAGE_SLUGS)("accepts the supported page %s", (slug) => {
    expect(siteContentPageSlugSchema.safeParse(slug).success).toBe(true);
  });
  it.each(["", "faq", "About", "../etc", "privacy"])("rejects unsupported page %j", (slug) => {
    expect(siteContentPageSlugSchema.safeParse(slug).success).toBe(false);
  });
  it("the fixed set is exactly about + terms", () => {
    expect([...SITE_CONTENT_PAGE_SLUGS]).toEqual(["about", "terms"]);
  });
});

describe("updateSiteContentPageSchema", () => {
  it("accepts any non-empty subset, trims, and strips unknown/protected keys", () => {
    const r = updateSiteContentPageSchema.parse({ title: "  درباره ما ", body: "متن", isPublished: true, slug: "x", _id: "1", role: "master_admin" });
    expect(r).toEqual({ title: "درباره ما", body: "متن", isPublished: true });
    expect(updateSiteContentPageSchema.safeParse({ isPublished: false }).success).toBe(true);
  });
  it("rejects an empty update", () => {
    expect(updateSiteContentPageSchema.safeParse({}).success).toBe(false);
    expect(updateSiteContentPageSchema.safeParse({ slug: "about" }).success).toBe(false);
  });
  it.each([[{ title: "" }], [{ title: "   " }], [{ body: "" }], [{ title: "a".repeat(151) }], [{ body: "a".repeat(10001) }], [{ isPublished: "yes" }], [{ title: 5 }]])("rejects %j", (body) => {
    expect(updateSiteContentPageSchema.safeParse(body).success).toBe(false);
  });
  it("accepts the maximum lengths", () => {
    expect(updateSiteContentPageSchema.safeParse({ title: "a".repeat(150), body: "a".repeat(10000) }).success).toBe(true);
  });
  it.each(["<script>alert(1)</script>", "سلام <b>دنیا</b>", "<div class=x>", "text <!-- hidden -->", "<img src=x onerror=alert(1)>"])("rejects HTML in the body: %s", (body) => {
    expect(updateSiteContentPageSchema.safeParse({ body }).success).toBe(false);
  });
  it("allows plain text with comparison signs", () => {
    expect(updateSiteContentPageSchema.safeParse({ body: "۵ < ۶ و ۷ > ۳" }).success).toBe(true);
  });
});

describe("looksLikeHtml", () => {
  it("detects tags and comments but not bare angle brackets", () => {
    expect(looksLikeHtml("<p>x</p>")).toBe(true);
    expect(looksLikeHtml("a <  b")).toBe(false);
    expect(looksLikeHtml("1<2>0")).toBe(false);
  });
});

describe("FAQ schemas", () => {
  it("create: valid, trims, sortOrder optional, strips isActive/unknown keys", () => {
    expect(createFaqSchema.parse({ question: " چرا؟ ", answer: " چون ", isActive: false, _id: "x" })).toEqual({ question: "چرا؟", answer: "چون" });
    expect(createFaqSchema.parse({ question: "q", answer: "a", sortOrder: 0 }).sortOrder).toBe(0);
  });
  it.each([
    [{ answer: "a" }], [{ question: "q" }], [{ question: "", answer: "a" }], [{ question: "q", answer: "  " }],
    [{ question: "q".repeat(301), answer: "a" }], [{ question: "q", answer: "a".repeat(2001) }],
    [{ question: "q", answer: "a", sortOrder: -1 }], [{ question: "q", answer: "a", sortOrder: 1.5 }], [{ question: "q", answer: "a", sortOrder: "3" }],
    [{ question: "<b>q</b>", answer: "a" }], [{ question: "q", answer: "<script>x</script>" }],
  ])("create rejects %j", (body) => {
    expect(createFaqSchema.safeParse(body).success).toBe(false);
  });
  it("update: partial, needs at least one field", () => {
    expect(updateFaqSchema.safeParse({ sortOrder: 3 }).success).toBe(true);
    expect(updateFaqSchema.safeParse({}).success).toBe(false);
    expect(updateFaqSchema.safeParse({ isActive: false }).success).toBe(false); // stripped → empty
  });
  it("status requires a boolean", () => {
    expect(faqStatusSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(faqStatusSchema.safeParse({}).success).toBe(false);
    expect(faqStatusSchema.safeParse({ isActive: "false" }).success).toBe(false);
  });
});

describe("slide schemas", () => {
  it("create: only imageUrl is required; optional title/linkUrl/sortOrder; strips isActive", () => {
    expect(createSlideSchema.parse({ imageUrl: " https://cdn.example.com/a.jpg " })).toEqual({ imageUrl: "https://cdn.example.com/a.jpg" });
    expect(createSlideSchema.parse({ imageUrl: "http://x.io/a.png", title: "تخفیف", linkUrl: "https://shop.example/offer?a=1#b", sortOrder: 2, isActive: false })).toEqual({
      imageUrl: "http://x.io/a.png", title: "تخفیف", linkUrl: "https://shop.example/offer?a=1#b", sortOrder: 2,
    });
  });
  it("create allows empty title and empty linkUrl (means unset)", () => {
    expect(createSlideSchema.safeParse({ imageUrl: "https://x.io/a.png", title: "", linkUrl: "" }).success).toBe(true);
  });
  it("create requires imageUrl", () => {
    expect(createSlideSchema.safeParse({}).success).toBe(false);
    expect(createSlideSchema.safeParse({ imageUrl: "" }).success).toBe(false);
  });
  it.each(DANGEROUS)("rejects dangerous/invalid imageUrl %j", (imageUrl) => {
    expect(createSlideSchema.safeParse({ imageUrl }).success).toBe(false);
    expect(updateSlideSchema.safeParse({ imageUrl }).success).toBe(false);
  });
  it.each(DANGEROUS)("rejects dangerous/invalid linkUrl %j", (linkUrl) => {
    expect(createSlideSchema.safeParse({ imageUrl: "https://x.io/a.png", linkUrl }).success).toBe(false);
  });
  it("does not rewrite an unsafe URL into a safe one", () => {
    const r = createSlideSchema.safeParse({ imageUrl: "javascript:https://x.io/a.png" });
    expect(r.success).toBe(false);
  });
  it("enforces length limits and sortOrder rules", () => {
    expect(createSlideSchema.safeParse({ imageUrl: `https://x.io/${"a".repeat(2000)}` }).success).toBe(false);
    expect(createSlideSchema.safeParse({ imageUrl: "https://x.io/a", linkUrl: `https://x.io/${"a".repeat(300)}` }).success).toBe(false);
    expect(createSlideSchema.safeParse({ imageUrl: "https://x.io/a", title: "t".repeat(151) }).success).toBe(false);
    expect(createSlideSchema.safeParse({ imageUrl: "https://x.io/a", title: "<i>t</i>" }).success).toBe(false);
    expect(createSlideSchema.safeParse({ imageUrl: "https://x.io/a", sortOrder: -1 }).success).toBe(false);
    expect(createSlideSchema.safeParse({ imageUrl: "https://x.io/a", sortOrder: 0.5 }).success).toBe(false);
  });
  it("update is partial and needs one field; status needs a boolean", () => {
    expect(updateSlideSchema.safeParse({ title: "" }).success).toBe(true);
    expect(updateSlideSchema.safeParse({}).success).toBe(false);
    expect(slideStatusSchema.safeParse({ isActive: true }).success).toBe(true);
    expect(slideStatusSchema.safeParse({ isActive: 1 }).success).toBe(false);
  });
});

describe("updateSocialLinksSchema", () => {
  it("accepts any subset of exactly instagram/telegram/whatsapp and strips eitaa/rubika", () => {
    expect(updateSocialLinksSchema.parse({ instagram: "https://instagram.com/persboy", eitaa: "https://eitaa.com/x", rubika: "https://rubika.ir/x" })).toEqual({
      instagram: "https://instagram.com/persboy",
    });
    expect(updateSocialLinksSchema.safeParse({ telegram: "https://t.me/persboy", whatsapp: "https://wa.me/989121234567" }).success).toBe(true);
  });
  it("empty string is allowed (clears the link)", () => {
    expect(updateSocialLinksSchema.parse({ instagram: "" })).toEqual({ instagram: "" });
  });
  it("rejects an empty update and Legacy-only platforms alone", () => {
    expect(updateSocialLinksSchema.safeParse({}).success).toBe(false);
    expect(updateSocialLinksSchema.safeParse({ eitaa: "https://eitaa.com/x" }).success).toBe(false);
  });
  it.each(DANGEROUS.filter((d) => d !== "http://"))("rejects %j on every platform", (value) => {
    for (const k of ["instagram", "telegram", "whatsapp"]) expect(updateSocialLinksSchema.safeParse({ [k]: value }).success).toBe(false);
  });
  it("rejects over-long links", () => {
    expect(updateSocialLinksSchema.safeParse({ instagram: `https://x.io/${"a".repeat(300)}` }).success).toBe(false);
  });
});
