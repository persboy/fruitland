import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { DeliveryRun } from "./DeliveryRun";

const courierId = new Types.ObjectId();
const adminId = new Types.ObjectId();

function buildRun(stops: Array<{ orderId: Types.ObjectId; sequence: number }>, overrides: Record<string, unknown> = {}) {
  return new DeliveryRun({ courierId, createdByAdminUserId: adminId, stops, ...overrides });
}

describe("DeliveryRun schema", () => {
  it("defaults to a draft run whose stops are pending", () => {
    const run = buildRun([{ orderId: new Types.ObjectId(), sequence: 1 }]);
    expect(run.validateSync()).toBeUndefined();
    expect(run.status).toBe("draft");
    expect(run.stops[0]?.status).toBe("pending");
  });

  it("requires at least one stop", () => {
    expect(buildRun([]).validateSync()?.errors.stops).toBeDefined();
  });

  it("rejects the same order twice in one run (the unique index cannot catch this within one document)", () => {
    const orderId = new Types.ObjectId();
    const err = buildRun([{ orderId, sequence: 1 }, { orderId, sequence: 2 }]).validateSync();
    expect(err?.errors.stops).toBeDefined();
  });

  it("rejects duplicate or gapped sequences", () => {
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()];
    expect(buildRun([{ orderId: a, sequence: 1 }, { orderId: b, sequence: 1 }]).validateSync()?.errors.stops).toBeDefined();
    expect(buildRun([{ orderId: a, sequence: 1 }, { orderId: b, sequence: 3 }]).validateSync()?.errors.stops).toBeDefined();
  });

  it("keeps two different orders as two stops (no merging by address — a stop carries no address at all)", () => {
    const run = buildRun([{ orderId: new Types.ObjectId(), sequence: 1 }, { orderId: new Types.ObjectId(), sequence: 2 }]);
    expect(run.validateSync()).toBeUndefined();
    expect(run.stops).toHaveLength(2);
    expect(Object.keys((DeliveryRun.schema.path("stops") as unknown as { schema: { paths: object } }).schema.paths)).not.toContain("address");
  });

  it("rejects an unknown run or stop status", () => {
    const orderId = new Types.ObjectId();
    expect(buildRun([{ orderId, sequence: 1 }], { status: "in_transit" }).validateSync()?.errors.status).toBeDefined();
    const bad = new DeliveryRun({ courierId, createdByAdminUserId: adminId, stops: [{ orderId, sequence: 1, status: "next" }] });
    expect(bad.validateSync()).toBeDefined();
  });

  it("declares the partial unique index that enforces one open run per order", () => {
    const index = DeliveryRun.schema.indexes().find(([fields]) => "stops.orderId" in fields);
    expect(index).toBeDefined();
    const options = index?.[1];
    expect(options).toMatchObject({ unique: true, partialFilterExpression: { status: { $in: ["draft", "active"] } } });
  });

  it("indexes a courier's runs by status", () => {
    expect(DeliveryRun.schema.indexes().some(([fields]) => Object.keys(fields).join() === "courierId,status")).toBe(true);
  });
});
