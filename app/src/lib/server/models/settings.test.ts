import { describe, expect, it } from "vitest";
import { StoreSettings } from "./StoreSettings";
import { ShippingSettings } from "./ShippingSettings";
import { SiteContent } from "./SiteContent";
import { FaqItem } from "./FaqItem";
import { HomepageSlide } from "./HomepageSlide";

describe("StoreSettings schema", () => {
  it("requires storeName and supportPhone", () => {
    const doc = new StoreSettings({});
    const err = doc.validateSync();
    expect(err?.errors.storeName).toBeDefined();
    expect(err?.errors.supportPhone).toBeDefined();
  });

  it("defaults key to the singleton constant", () => {
    const doc = new StoreSettings({ storeName: "پرسبوی", supportPhone: "02100000000" });
    expect(doc.key).toBe("singleton");
  });
});

describe("ShippingSettings schema", () => {
  it("requires expressDeliveryFee and freeDeliveryThreshold", () => {
    const doc = new ShippingSettings({});
    const err = doc.validateSync();
    expect(err?.errors.expressDeliveryFee).toBeDefined();
    expect(err?.errors.freeDeliveryThreshold).toBeDefined();
  });

  it("rejects a non-integer fee as an invalid Toman value", () => {
    const doc = new ShippingSettings({ expressDeliveryFee: 15000.5, freeDeliveryThreshold: 500000 });
    const err = doc.validateSync();
    expect(err?.errors.expressDeliveryFee).toBeDefined();
  });

  it("accepts valid integer Toman values", () => {
    const doc = new ShippingSettings({ expressDeliveryFee: 15000, freeDeliveryThreshold: 500000 });
    expect(doc.validateSync()).toBeUndefined();
  });
});

describe("SiteContent schema", () => {
  it("requires slug, title and body", () => {
    const doc = new SiteContent({});
    const err = doc.validateSync();
    expect(err?.errors.slug).toBeDefined();
    expect(err?.errors.title).toBeDefined();
    expect(err?.errors.body).toBeDefined();
  });

  it("lowercases the slug", () => {
    const doc = new SiteContent({ slug: "ABOUT-US", title: "درباره ما", body: "..." });
    expect(doc.slug).toBe("about-us");
  });
});

describe("FaqItem schema", () => {
  it("requires question and answer", () => {
    const doc = new FaqItem({});
    const err = doc.validateSync();
    expect(err?.errors.question).toBeDefined();
    expect(err?.errors.answer).toBeDefined();
  });
});

describe("HomepageSlide schema", () => {
  it("requires imageUrl", () => {
    const doc = new HomepageSlide({});
    const err = doc.validateSync();
    expect(err?.errors.imageUrl).toBeDefined();
  });

  it("defaults isActive to true", () => {
    const doc = new HomepageSlide({ imageUrl: "https://example.com/x.jpg" });
    expect(doc.isActive).toBe(true);
  });
});
