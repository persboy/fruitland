import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  find: vi.fn(),
  countDocuments: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  create: vi.fn(),
  catFind: vi.fn(),
  catFindOne: vi.fn(),
  auditCreate: vi.fn(),
}));
vi.mock("../models/Product", () => ({
  Product: { find: m.find, countDocuments: m.countDocuments, findOne: m.findOne, findOneAndUpdate: m.findOneAndUpdate, create: m.create },
}));
vi.mock("../models/Category", () => ({ Category: { find: m.catFind, findOne: m.catFindOne } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { createProduct, getProduct, listProducts, setProductActive, updateProduct } from "./productService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const T0 = new Date("2026-01-01T10:00:00Z");
const CAT = new Types.ObjectId();
const variant = (unit: string, price: number, over: Record<string, unknown> = {}) => ({ _id: new Types.ObjectId(), unit, price, isAvailable: true, ...over });
const product = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(), name: "سیب قرمز", slug: "سیب-قرمز", categoryId: CAT, description: undefined, images: [], isOrganic: false, isActive: true,
  sortOrder: 0, variants: [variant("kg", 50000)], createdAt: T0, updatedAt: T0, ...over,
});
const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, ...over });
const listChain = (docs: unknown[]) => {
  const chain = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), lean: () => Promise.resolve(docs) };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
};
const created = (doc: Record<string, unknown>) => ({ ...doc, toObject: () => doc });

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
  m.catFind.mockReturnValue(lean([{ _id: CAT, name: "میوه", isActive: true }]));
  m.catFindOne.mockReturnValue(lean({ _id: CAT })); // an ACTIVE category exists
  m.find.mockReturnValue(lean([])); // no slug taken
});

describe("listProducts", () => {
  it("orders by sortOrder, name, _id (deterministic), paginates, returns metadata; no condition without filters", async () => {
    const chain = listChain([product()]);
    m.find.mockReturnValue(chain);
    m.countDocuments.mockResolvedValue(45);
    const out = await listProducts(q({ page: 3, limit: 10 }));
    expect(m.find.mock.calls[0]![0]).toEqual({});
    expect(chain.sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1, _id: 1 });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(m.countDocuments).toHaveBeenCalledWith({});
    expect(out.pagination).toEqual({ page: 3, pageSize: 10, total: 45 });
  });

  it("uses an explicit projection with exactly the Product model fields (no legacy fields)", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listProducts(q());
    expect(Object.keys(m.find.mock.calls[0]![1] as object).sort()).toEqual(
      ["categoryId", "createdAt", "description", "images", "isActive", "isOrganic", "name", "slug", "sortOrder", "updatedAt", "variants"].sort(),
    );
  });

  it("search matches name or slug as an escaped literal (never a raw regex)", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listProducts(q({ search: ".*(a+)+[x]$" }));
    const filter = m.find.mock.calls[0]![0] as { $and: { $or: { name?: RegExp; slug?: RegExp }[] }[] };
    const [byName, bySlug] = filter.$and[0]!.$or;
    for (const rx of [byName!.name!, bySlug!.slug!]) {
      expect(rx.test(".*(a+)+[x]$")).toBe(true);
      expect(rx.test("zzz")).toBe(false);
      expect(rx.test("aaaa")).toBe(false);
    }
    expect(byName!.name!.flags).toContain("i");
    expect(m.countDocuments).toHaveBeenCalledWith(m.find.mock.calls[0]![0]);
  });

  it("applies categoryId, isActive and isOrganic filters (including false)", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listProducts(q({ categoryId: CAT.toString(), isActive: false, isOrganic: true }));
    const filter = m.find.mock.calls[0]![0] as { $and: Record<string, unknown>[] };
    expect(filter.$and).toEqual([{ categoryId: CAT }, { isActive: false }, { isOrganic: true }]);
    expect((filter.$and[0] as { categoryId: Types.ObjectId }).categoryId).toBeInstanceOf(Types.ObjectId);
  });

  it("loads the category name for the whole page with ONE query limited to name/isActive", async () => {
    m.find.mockReturnValue(listChain([product(), product({ slug: "x" })]));
    m.countDocuments.mockResolvedValue(2);
    const out = await listProducts(q());
    expect(m.catFind).toHaveBeenCalledTimes(1);
    expect(Object.keys(m.catFind.mock.calls[0]![1] as object).sort()).toEqual(["isActive", "name"]);
    expect(out.items[0]!.category).toEqual({ id: CAT.toString(), name: "میوه", isActive: true });
  });

  it("a product whose category document is gone still renders (category null)", async () => {
    m.find.mockReturnValue(listChain([product()]));
    m.countDocuments.mockResolvedValue(1);
    m.catFind.mockReturnValue(lean([]));
    expect((await listProducts(q())).items[0]!.category).toBeNull();
  });

  it("an inactive category is still reported as it is (the product is not changed)", async () => {
    m.find.mockReturnValue(listChain([product()]));
    m.countDocuments.mockResolvedValue(1);
    m.catFind.mockReturnValue(lean([{ _id: CAT, name: "میوه", isActive: false }]));
    expect((await listProducts(q())).items[0]!.category).toEqual({ id: CAT.toString(), name: "میوه", isActive: false });
  });
});

describe("DTO", () => {
  const dto = async (doc: Record<string, unknown>) => {
    m.findOne.mockReturnValue(lean(doc));
    return getProduct(String(doc._id));
  };
  it("serialises field by field; ids are strings; variants carry id/unit/price/isAvailable only", async () => {
    const v = variant("kg", 50000);
    const d = await dto(product({ variants: [v], description: "تازه", images: ["https://a.example/x.png"], isOrganic: true, sortOrder: 4 }));
    expect(Object.keys(d).sort()).toEqual(["category", "createdAt", "description", "id", "images", "isActive", "isOrganic", "name", "slug", "sortOrder", "updatedAt", "variants"]);
    expect(d.variants).toEqual([{ id: v._id.toString(), unit: "kg", price: 50000, isAvailable: true }]);
    expect(d).toMatchObject({ description: "تازه", isOrganic: true, sortOrder: 4, images: ["https://a.example/x.png"] });
    expect(typeof d.id).toBe("string");
  });
  it("never leaks Mongoose internals, legacy fields or unselected data even if the driver returned them", async () => {
    const d = await dto(product({ __v: 2, stockQty: 5, originalPrice: 9, emoji: "🍎", secret: "x", variants: [{ ...variant("kg", 1), stockQty: 3, originalPrice: 2 }] }));
    expect(JSON.stringify(d)).not.toMatch(/__v|stockQty|originalPrice|emoji|secret|_id/);
  });
  it("description is null when absent", async () => expect((await dto(product())).description).toBeNull());
  it("a malformed or unknown id is a 404 PRODUCT_NOT_FOUND and a malformed id never reaches the database", async () => {
    await expect(getProduct("nope")).rejects.toMatchObject({ status: 404, code: "PRODUCT_NOT_FOUND" });
    expect(m.findOne).not.toHaveBeenCalled();
    m.findOne.mockReturnValue(lean(null));
    await expect(getProduct(new Types.ObjectId().toString())).rejects.toMatchObject({ status: 404, code: "PRODUCT_NOT_FOUND" });
  });
});

describe("createProduct", () => {
  const input = (over: Record<string, unknown> = {}) => ({ name: "سیب قرمز", categoryId: CAT.toString(), variants: [{ unit: "kg" as const, price: 50000 }], ...over });
  // Like the real model, give every created variant its own _id.
  const mockCreate = (over: Record<string, unknown> = {}) =>
    m.create.mockImplementation(async (doc: Record<string, unknown>) =>
      created(product({ ...doc, variants: (doc.variants as Record<string, unknown>[]).map((v) => ({ _id: new Types.ObjectId(), ...v })), ...over })),
    );

  it("requires an ACTIVE category: existence and isActive are one filter, and a miss is a 400 with no write", async () => {
    mockCreate();
    await createProduct(actor, input());
    expect(m.catFindOne.mock.calls[0]![0]).toEqual({ _id: CAT, isActive: true });
    m.catFindOne.mockReturnValue(lean(null));
    await expect(createProduct(actor, input())).rejects.toMatchObject({ status: 400, code: "PRODUCT_CATEGORY_INVALID" });
    expect(m.create).toHaveBeenCalledTimes(1); // only the first, successful call
  });

  it("rejects an invalid category id without querying", async () => {
    await expect(createProduct(actor, input({ categoryId: "nope" }))).rejects.toMatchObject({ code: "PRODUCT_CATEGORY_INVALID" });
    expect(m.catFindOne).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("creates with server defaults and a slug generated from the name; the client slug is never read", async () => {
    mockCreate();
    const out = await createProduct(actor, input({ slug: "evil" } as never));
    const arg = m.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({ name: "سیب قرمز", slug: "سیب-قرمز", isOrganic: false, isActive: true, sortOrder: 0, images: [] });
    expect(arg.categoryId).toBeInstanceOf(Types.ObjectId);
    expect(arg).not.toHaveProperty("description");
    expect(arg.variants).toEqual([{ unit: "kg", price: 50000, isAvailable: true }]);
    expect(out.slug).toBe("سیب-قرمز");
  });

  it("passes every optional field through", async () => {
    mockCreate();
    await createProduct(actor, input({ description: "تازه", images: ["https://a.example/x.png"], isOrganic: true, isActive: false, sortOrder: 7, variants: [{ unit: "kg", price: 5, isAvailable: false }, { unit: "box", price: 9 }] }));
    expect(m.create.mock.calls[0]![0]).toMatchObject({
      description: "تازه", images: ["https://a.example/x.png"], isOrganic: true, isActive: false, sortOrder: 7,
      variants: [{ unit: "kg", price: 5, isAvailable: false }, { unit: "box", price: 9, isAvailable: true }],
    });
  });

  it.each([
    ["duplicate units", [{ unit: "kg", price: 5 }, { unit: "kg", price: 6 }]],
    ["zero price", [{ unit: "kg", price: 0 }]],
    ["negative price", [{ unit: "kg", price: -5 }]],
    ["fractional price", [{ unit: "kg", price: 5.5 }]],
    ["empty list", []],
  ])("rejects %s on the server (even if the schema were bypassed) with 400 PRODUCT_VARIANTS_INVALID and no write", async (_n, variants) => {
    await expect(createProduct(actor, input({ variants }))).rejects.toMatchObject({ status: 400, code: "PRODUCT_VARIANTS_INVALID" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  describe("slug", () => {
    it("uses the first free suffix when the base is taken: base, base-2, base-3", async () => {
      m.find.mockReturnValue(lean([{ slug: "سیب-قرمز" }, { slug: "سیب-قرمز-2" }]));
      mockCreate();
      await createProduct(actor, input());
      expect((m.create.mock.calls[0]![0] as { slug: string }).slug).toBe("سیب-قرمز-3");
    });
    it("fills a gap instead of skipping it", async () => {
      m.find.mockReturnValue(lean([{ slug: "سیب-قرمز" }, { slug: "سیب-قرمز-3" }]));
      mockCreate();
      await createProduct(actor, input());
      expect((m.create.mock.calls[0]![0] as { slug: string }).slug).toBe("سیب-قرمز-2");
    });
    it("looks up only slugs of the form base or base-<digits> with an escaped literal base", async () => {
      mockCreate();
      await createProduct(actor, input({ name: "a.b (c)" }));
      const rx = (m.find.mock.calls[0]![0] as { slug: { $regex: RegExp } }).slug.$regex;
      expect(rx.test("a-b-c")).toBe(true);
      expect(rx.test("a-b-c-2")).toBe(true);
      expect(rx.test("a-b-c-x")).toBe(false);
      expect(rx.test("zz-a-b-c")).toBe(false);
    });
    it("a concurrent insert that wins the same slug (E11000) is retried with the next free suffix", async () => {
      m.find.mockReturnValueOnce(lean([])).mockReturnValueOnce(lean([{ slug: "سیب-قرمز" }]));
      m.create.mockRejectedValueOnce(Object.assign(new Error("E11000 duplicate key"), { code: 11000 }));
      mockCreate();
      const out = await createProduct(actor, input());
      expect(m.create).toHaveBeenCalledTimes(2);
      expect((m.create.mock.calls[1]![0] as { slug: string }).slug).toBe("سیب-قرمز-2");
      expect(out.slug).toBe("سیب-قرمز-2");
      expect(m.auditCreate).toHaveBeenCalledTimes(1);
    });
    it("gives up with 409 PRODUCT_SLUG_CONFLICT (no raw Mongo error) when it keeps losing the race", async () => {
      m.create.mockRejectedValue(Object.assign(new Error("E11000 duplicate key collection: x index: slug_1"), { code: 11000 }));
      const err = await createProduct(actor, input()).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 409, code: "PRODUCT_SLUG_CONFLICT" });
      expect((err as Error).message).not.toMatch(/E11000|collection|index/);
      expect(m.auditCreate).not.toHaveBeenCalled();
    });
    it("does not swallow unexpected errors", async () => {
      m.create.mockRejectedValue(new Error("boom"));
      await expect(createProduct(actor, input())).rejects.toThrow("boom");
    });
    it("slugs Persian, Persian digits and ZWNJ names deterministically", async () => {
      mockCreate();
      await createProduct(actor, input({ name: "سیب‌زمینی ۵ کیلویی" }));
      expect((m.create.mock.calls[0]![0] as { slug: string }).slug).toBe("سیب-زمینی-5-کیلویی");
    });
  });

  it("audits product.created with before:null and a snapshot", async () => {
    mockCreate();
    await createProduct(actor, input({ description: "تازه" }));
    const a = m.auditCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(a).toMatchObject({ actorUserId: actor, action: "product.created", entityType: "Product", before: null });
    expect(a.after).toMatchObject({ name: "سیب قرمز", slug: "سیب-قرمز", categoryId: CAT.toString(), isActive: true, description: "تازه" });
    expect((a.after as { variants: unknown[] }).variants).toHaveLength(1);
  });
});

describe("updateProduct", () => {
  const A = variant("kg", 50000);
  const B = variant("box", 400000);
  const base = () => product({ variants: [A, B] });
  const id = (p: { _id: Types.ObjectId }) => p._id.toString();
  /** current → written (before) → final re-read */
  const setup = (current: Record<string, unknown>, finalDoc: Record<string, unknown> = current) => {
    m.findOne.mockReturnValueOnce(lean(current));
    m.findOneAndUpdate.mockReturnValue(lean(current));
    m.findOne.mockReturnValue(lean(finalDoc));
  };
  const written = () => m.findOneAndUpdate.mock.calls[0]![1] as { $set?: Record<string, unknown>; $unset?: Record<string, unknown> };

  it("404 for a malformed id (no DB access) and for an unknown id (no write)", async () => {
    await expect(updateProduct(actor, "nope", { name: "x" })).rejects.toMatchObject({ status: 404, code: "PRODUCT_NOT_FOUND" });
    expect(m.findOne).not.toHaveBeenCalled();
    m.findOne.mockReturnValueOnce(lean(null));
    await expect(updateProduct(actor, id(base()), { name: "x" })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("writes only allowlisted fields — never slug, isActive, timestamps", async () => {
    const cur = base();
    setup(cur);
    await updateProduct(actor, id(cur), { name: "گلابی", description: "تازه", images: ["https://a.example/x.png"], isOrganic: true, sortOrder: 3 });
    expect(Object.keys(written().$set!).sort()).toEqual(["description", "images", "isOrganic", "name", "sortOrder"]);
    for (const k of ["slug", "isActive", "createdAt", "updatedAt", "_id"]) expect(written().$set).not.toHaveProperty(k);
  });

  it("does NOT regenerate the slug when the name changes (stable URLs)", async () => {
    const cur = base();
    setup(cur);
    await updateProduct(actor, id(cur), { name: "گلابی" });
    expect(written().$set).not.toHaveProperty("slug");
    expect(m.find).not.toHaveBeenCalled(); // no slug lookup at all
  });

  it("uses an optimistic lock on updatedAt and returns the pre-write document", async () => {
    const cur = base();
    setup(cur);
    await updateProduct(actor, id(cur), { sortOrder: 9 });
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: cur._id, updatedAt: T0 });
    expect(m.findOneAndUpdate.mock.calls[0]![2]).toMatchObject({ new: false, runValidators: true });
  });

  it("a write that loses the race is a 409 PRODUCT_CONCURRENT_UPDATE with no audit", async () => {
    const cur = base();
    m.findOne.mockReturnValueOnce(lean(cur));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    m.findOne.mockReturnValueOnce(lean({ _id: cur._id })); // still exists
    await expect(updateProduct(actor, id(cur), { sortOrder: 9 })).rejects.toMatchObject({ status: 409, code: "PRODUCT_CONCURRENT_UPDATE" });
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("if the product vanished mid-update the answer is 404, not 409", async () => {
    const cur = base();
    m.findOne.mockReturnValueOnce(lean(cur));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    m.findOne.mockReturnValueOnce(lean(null));
    await expect(updateProduct(actor, id(cur), { sortOrder: 9 })).rejects.toMatchObject({ status: 404 });
  });

  it("an unchanged request writes nothing and audits nothing", async () => {
    const cur = product({ variants: [A, B], description: "تازه", images: ["https://a.example/x.png"], isOrganic: true, sortOrder: 2 });
    m.findOne.mockReturnValue(lean(cur));
    await updateProduct(actor, id(cur), {
      name: cur.name as string, categoryId: CAT.toString(), description: "تازه", images: ["https://a.example/x.png"], isOrganic: true, sortOrder: 2,
      variants: [{ id: id(A) }, { id: id(B), unit: "box", price: 400000, isAvailable: true }],
    });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("description '' clears it with $unset, and clearing an absent description is a no-op", async () => {
    const cur = product({ description: "قدیمی" });
    setup(cur);
    await updateProduct(actor, id(cur), { description: "" });
    expect(written().$unset).toEqual({ description: 1 });
    vi.resetAllMocks();
    m.auditCreate.mockResolvedValue({});
    m.catFind.mockReturnValue(lean([]));
    const none = product();
    m.findOne.mockReturnValue(lean(none));
    await updateProduct(actor, id(none), { description: "" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
  });

  describe("category", () => {
    const OTHER = new Types.ObjectId();
    it("moving to another ACTIVE category is allowed and validated with existence+isActive in one filter", async () => {
      const cur = base();
      setup(cur);
      m.catFindOne.mockReturnValue(lean({ _id: OTHER }));
      await updateProduct(actor, id(cur), { categoryId: OTHER.toString() });
      expect(m.catFindOne.mock.calls[0]![0]).toEqual({ _id: OTHER, isActive: true });
      expect((written().$set!.categoryId as Types.ObjectId).toString()).toBe(OTHER.toString());
    });
    it("moving to an inactive or nonexistent category is a 400 PRODUCT_CATEGORY_INVALID and writes nothing", async () => {
      const cur = base();
      m.findOne.mockReturnValue(lean(cur));
      m.catFindOne.mockReturnValue(lean(null));
      await expect(updateProduct(actor, id(cur), { categoryId: OTHER.toString() })).rejects.toMatchObject({ status: 400, code: "PRODUCT_CATEGORY_INVALID" });
      expect(m.findOneAndUpdate).not.toHaveBeenCalled();
      expect(m.auditCreate).not.toHaveBeenCalled();
    });
    it("keeping the SAME category is never re-validated, so a product under a now-inactive category can still be edited", async () => {
      const cur = base();
      setup(cur);
      m.catFindOne.mockReturnValue(lean(null)); // the current category is inactive now
      await updateProduct(actor, id(cur), { categoryId: CAT.toString(), sortOrder: 5 });
      expect(m.catFindOne).not.toHaveBeenCalled();
      expect(written().$set).not.toHaveProperty("categoryId");
    });
    it("rejects a malformed category id", async () => {
      const cur = base();
      m.findOne.mockReturnValue(lean(cur));
      await expect(updateProduct(actor, id(cur), { categoryId: "nope" })).rejects.toMatchObject({ code: "PRODUCT_CATEGORY_INVALID" });
    });
  });

  describe("variants — _id preservation", () => {
    it("existing A and B keep their _id; only the genuinely new C gets a new one", async () => {
      const cur = base();
      setup(cur);
      await updateProduct(actor, id(cur), { variants: [{ id: id(A), price: 55000 }, { id: id(B) }, { unit: "bundle", price: 9000 }] });
      const set = written().$set!.variants as { _id: Types.ObjectId; unit: string; price: number; isAvailable: boolean }[];
      expect(set).toHaveLength(3);
      expect(set[0]!._id.toString()).toBe(id(A));
      expect(set[1]!._id.toString()).toBe(id(B));
      expect(set[2]!._id).toBeInstanceOf(Types.ObjectId);
      expect([id(A), id(B)]).not.toContain(set[2]!._id.toString());
      expect(set.map((v) => v.unit)).toEqual(["kg", "box", "bundle"]);
      expect(set[0]!.price).toBe(55000);
      expect(set[1]).toMatchObject({ unit: "box", price: 400000, isAvailable: true }); // untouched fields carried over
      expect(set[2]).toMatchObject({ isAvailable: true });
    });

    it("only the price of one variant changes: both _ids are identical to before", async () => {
      const cur = base();
      setup(cur);
      await updateProduct(actor, id(cur), { variants: [{ id: id(A) }, { id: id(B), price: 410000 }] });
      const set = written().$set!.variants as { _id: Types.ObjectId }[];
      expect(set.map((v) => v._id.toString())).toEqual([id(A), id(B)]);
    });

    it("the submitted order becomes the stored order without changing identities", async () => {
      const cur = base();
      setup(cur);
      await updateProduct(actor, id(cur), { variants: [{ id: id(B) }, { id: id(A), isAvailable: false }] });
      const set = written().$set!.variants as { _id: Types.ObjectId; isAvailable: boolean }[];
      expect(set.map((v) => v._id.toString())).toEqual([id(B), id(A)]);
      expect(set[1]!.isAvailable).toBe(false);
    });

    it("disabling a variant is isAvailable=false, never a removal", async () => {
      const cur = base();
      setup(cur);
      await updateProduct(actor, id(cur), { variants: [{ id: id(A), isAvailable: false }, { id: id(B) }] });
      const set = written().$set!.variants as { isAvailable: boolean }[];
      expect(set.map((v) => v.isAvailable)).toEqual([false, true]);
      expect(set).toHaveLength(2);
    });

    it("omitting an existing variant is rejected (no variant hard delete)", async () => {
      const cur = base();
      m.findOne.mockReturnValue(lean(cur));
      await expect(updateProduct(actor, id(cur), { variants: [{ id: id(A) }] })).rejects.toMatchObject({ status: 400, code: "PRODUCT_VARIANT_REMOVAL_NOT_ALLOWED" });
      expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("an id that is not one of THIS product's variants is rejected", async () => {
      const cur = base();
      m.findOne.mockReturnValue(lean(cur));
      await expect(updateProduct(actor, id(cur), { variants: [{ id: id(A) }, { id: id(B) }, { id: new Types.ObjectId().toString(), price: 5 }] })).rejects.toMatchObject({
        code: "PRODUCT_VARIANT_NOT_FOUND",
      });
    });

    it("rejects a duplicate unit after merging (new kg while kg already exists)", async () => {
      const cur = base();
      m.findOne.mockReturnValue(lean(cur));
      const err = await updateProduct(actor, id(cur), { variants: [{ id: id(A) }, { id: id(B) }, { unit: "kg", price: 1000 }] }).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 400, code: "PRODUCT_VARIANTS_INVALID" });
      expect((err as Error).message).toContain("فقط یک‌بار");
      expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("rejects a duplicate caused by changing one variant's unit onto another's (kg + box → box + box)", async () => {
      const cur = base();
      m.findOne.mockReturnValue(lean(cur));
      await expect(updateProduct(actor, id(cur), { variants: [{ id: id(A), unit: "box" }, { id: id(B) }] })).rejects.toMatchObject({ code: "PRODUCT_VARIANTS_INVALID" });
    });

    it("allows swapping units between two variants only if the final list is unique (kg↔box is a duplicate-free result)", async () => {
      const cur = base();
      setup(cur);
      await updateProduct(actor, id(cur), { variants: [{ id: id(A), unit: "box" }, { id: id(B), unit: "kg" }] });
      const set = written().$set!.variants as { _id: Types.ObjectId; unit: string }[];
      expect(set.map((v) => [v._id.toString(), v.unit])).toEqual([[id(A), "box"], [id(B), "kg"]]);
    });

    it("rejects a zero price on the server even if the schema were bypassed", async () => {
      const cur = base();
      m.findOne.mockReturnValue(lean(cur));
      await expect(updateProduct(actor, id(cur), { variants: [{ id: id(A), price: 0 }, { id: id(B) }] })).rejects.toMatchObject({ code: "PRODUCT_VARIANTS_INVALID" });
    });
  });

  it("audits product.updated with before/after of the editable fields (variant ids preserved in both)", async () => {
    const cur = base();
    setup(cur);
    await updateProduct(actor, id(cur), { name: "گلابی", variants: [{ id: id(A), price: 60000 }, { id: id(B) }, { unit: "bundle", price: 9000 }] });
    const a = m.auditCreate.mock.calls[0]![0] as { before: { name: string; variants: { id: string; price: number }[] }; after: { name: string; variants: { id: string; price: number }[] } } & Record<string, unknown>;
    expect(a).toMatchObject({ actorUserId: actor, action: "product.updated", entityType: "Product", entityId: cur._id });
    expect(a.before.name).toBe("سیب قرمز");
    expect(a.after.name).toBe("گلابی");
    expect(a.before.variants.map((v) => v.id)).toEqual([id(A), id(B)]);
    expect(a.after.variants.slice(0, 2).map((v) => v.id)).toEqual([id(A), id(B)]);
    expect(a.after.variants).toHaveLength(3);
    expect(a.after.variants[0]!.price).toBe(60000);
    expect(JSON.stringify(a)).not.toMatch(/slug|isActive/);
  });

  it("the audit 'before' comes from the atomic write result, not from the earlier read", async () => {
    const cur = base();
    m.findOne.mockReturnValueOnce(lean(cur));
    m.findOneAndUpdate.mockReturnValue(lean({ ...cur, sortOrder: 4 }));
    m.findOne.mockReturnValue(lean({ ...cur, sortOrder: 9 }));
    await updateProduct(actor, id(cur), { sortOrder: 9 });
    expect((m.auditCreate.mock.calls[0]![0] as { before: { sortOrder: number } }).before.sortOrder).toBe(4);
  });
});

describe("setProductActive", () => {
  const pid = new Types.ObjectId();
  const sid = pid.toString();

  it("404 for malformed and unknown ids", async () => {
    await expect(setProductActive(actor, "x", false)).rejects.toMatchObject({ status: 404 });
    m.findOne.mockReturnValueOnce(lean(null));
    await expect(setProductActive(actor, sid, false)).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("deactivates with a write conditional on the state seen, changes ONLY isActive, and audits product.deactivated", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: pid, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: pid, isActive: true }));
    m.findOne.mockReturnValue(lean(product({ _id: pid, isActive: false })));
    const out = await setProductActive(actor, sid, false);
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: pid, isActive: true });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $set: { isActive: false } });
    expect(m.auditCreate).toHaveBeenCalledWith({ actorUserId: actor, action: "product.deactivated", entityType: "Product", entityId: pid, before: { isActive: true }, after: { isActive: false } });
    expect(out.isActive).toBe(false);
  });

  it("activates and audits product.activated, without touching variant availability", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: pid, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: pid, isActive: false }));
    m.findOne.mockReturnValue(lean(product({ _id: pid, variants: [variant("kg", 5, { isAvailable: false })] })));
    const out = await setProductActive(actor, sid, true);
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "product.activated", before: { isActive: false }, after: { isActive: true } });
    expect(Object.keys((m.findOneAndUpdate.mock.calls[0]![1] as { $set: object }).$set)).toEqual(["isActive"]);
    expect(out.variants[0]!.isAvailable).toBe(false);
  });

  it("requesting the state it already has is a successful no-op: no write, no audit", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: pid, isActive: true }));
    m.findOne.mockReturnValue(lean(product({ _id: pid })));
    await setProductActive(actor, sid, true);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("a racing request that already flipped the state: the conditional write misses, so no second audit", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: pid, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    m.findOne.mockReturnValue(lean(product({ _id: pid, isActive: false })));
    const out = await setProductActive(actor, sid, false);
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(out.isActive).toBe(false);
  });

  it("never touches categories, orders, reviews or variants", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: pid, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: pid, isActive: true }));
    m.findOne.mockReturnValue(lean(product({ _id: pid, isActive: false })));
    await setProductActive(actor, sid, false);
    expect(m.catFindOne).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("module surface", () => {
  it("exposes no delete operation (no hard delete of products or variants)", async () => {
    const mod = await import("./productService");
    expect(Object.keys(mod).sort()).toEqual(["createProduct", "getProduct", "listProducts", "setProductActive", "updateProduct"]);
  });
});
