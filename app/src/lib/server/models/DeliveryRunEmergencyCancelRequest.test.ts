import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { DeliveryRunEmergencyCancelRequest } from "./DeliveryRunEmergencyCancelRequest";

function build(overrides: Record<string, unknown> = {}) {
  return new DeliveryRunEmergencyCancelRequest({
    deliveryRunId: new Types.ObjectId(),
    requestedByCourierId: new Types.ObjectId(),
    reason: "پیک گم شد",
    requestedAt: new Date(),
    ...overrides,
  });
}

describe("DeliveryRunEmergencyCancelRequest schema", () => {
  it("defaults to pending, with no replacement orders yet", () => {
    const doc = build();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe("pending");
    expect(doc.replacementOrderIds).toEqual([]);
  });

  it("requires a run, a requesting courier, and a reason", () => {
    expect(build({ deliveryRunId: undefined }).validateSync()?.errors.deliveryRunId).toBeDefined();
    expect(build({ requestedByCourierId: undefined }).validateSync()?.errors.requestedByCourierId).toBeDefined();
    expect(build({ reason: undefined }).validateSync()?.errors.reason).toBeDefined();
  });

  it("rejects an unknown status", () => {
    expect(build({ status: "approved_ish" }).validateSync()?.errors.status).toBeDefined();
  });

  it("validates an embedded physicalReturn sub-document", () => {
    const ok = build({
      physicalReturn: { returned: true, recordedByAdminUserId: new Types.ObjectId(), recordedAt: new Date() },
    });
    expect(ok.validateSync()).toBeUndefined();
    const missingActor = build({ physicalReturn: { returned: false, recordedAt: new Date() } });
    expect(missingActor.validateSync()?.errors["physicalReturn.recordedByAdminUserId"]).toBeDefined();
  });

  it("declares the partial unique index enforcing at most one pending request per run", () => {
    const index = DeliveryRunEmergencyCancelRequest.schema
      .indexes()
      .find(([fields]) => Object.keys(fields).join() === "deliveryRunId");
    expect(index).toBeDefined();
    expect(index?.[1]).toMatchObject({ unique: true, partialFilterExpression: { status: "pending" } });
  });
});
