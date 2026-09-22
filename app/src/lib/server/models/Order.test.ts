import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Order } from "./Order";

const userId = new Types.ObjectId();
const productId = new Types.ObjectId();

const validAddress = {
  recipientName: "Ali",
  phone: "09120000000",
  province: "Tehran",
  city: "Tehran",
  addressLine: "Valiasr St.",
};

const validItem = {
  productId,
  productName: "سیب",
  unit: "kg" as const,
  unitPrice: 50000,
  quantity: 2,
  lineTotal: 100000,
};

function buildValidOrder(overrides: Record<string, unknown> = {}) {
  return new Order({
    orderNumber: "000001",
    userId,
    items: [validItem],
    deliveryAddress: validAddress,
    subtotalAmount: 100000,
    totalAmount: 100000,
    ...overrides,
  });
}

describe("Order schema", () => {
  it("requires at least one item", () => {
    const doc = buildValidOrder({ items: [] });
    const err = doc.validateSync();
    expect(err?.errors.items).toBeDefined();
  });

  it("requires a deliveryAddress", () => {
    const doc = buildValidOrder({ deliveryAddress: undefined });
    const err = doc.validateSync();
    expect(err?.errors.deliveryAddress).toBeDefined();
  });

  it("defaults status to preparing, source to online, and payment to unpaid COD", () => {
    const doc = buildValidOrder();
    expect(doc.status).toBe("preparing");
    expect(doc.source).toBe("online");
    expect(doc.paymentMethod).toBe("cod");
    expect(doc.isPaid).toBe(false);
    expect(doc.validateSync()).toBeUndefined();
  });

  it("defaults delivery to an unassigned sub-lifecycle", () => {
    const doc = buildValidOrder();
    expect(doc.delivery.status).toBe("unassigned");
  });

  it("rejects a payment method other than cod (online payment is a future module)", () => {
    const doc = buildValidOrder({ paymentMethod: "online" });
    const err = doc.validateSync();
    expect(err?.errors.paymentMethod).toBeDefined();
  });

  it("rejects a non-integer subtotal as an invalid Toman value", () => {
    const doc = buildValidOrder({ subtotalAmount: 100000.25 });
    const err = doc.validateSync();
    expect(err?.errors.subtotalAmount).toBeDefined();
  });

  it("rejects an unknown order status", () => {
    const doc = buildValidOrder({ status: "on_the_moon" });
    const err = doc.validateSync();
    expect(err?.errors.status).toBeDefined();
  });

  it("rejects an unknown delivery sub-status", () => {
    const doc = buildValidOrder({ delivery: { status: "teleported" } });
    const err = doc.validateSync();
    expect(err?.errors["delivery.status"]).toBeDefined();
  });
});
