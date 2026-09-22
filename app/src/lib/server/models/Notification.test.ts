import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Notification } from "./Notification";
import { AuditLog } from "./AuditLog";

describe("Notification schema", () => {
  it("requires type and title", () => {
    const doc = new Notification({});
    const err = doc.validateSync();
    expect(err?.errors.type).toBeDefined();
    expect(err?.errors.title).toBeDefined();
  });

  it("rejects an unapproved notification type", () => {
    const doc = new Notification({ type: "birthday_greeting", title: "x" });
    const err = doc.validateSync();
    expect(err?.errors.type).toBeDefined();
  });

  it("defaults isRead to false", () => {
    const doc = new Notification({ type: "new_order", title: "سفارش جدید" });
    expect(doc.isRead).toBe(false);
    expect(doc.validateSync()).toBeUndefined();
  });
});

describe("AuditLog schema", () => {
  it("requires actorUserId, action, entityType and entityId", () => {
    const doc = new AuditLog({});
    const err = doc.validateSync();
    expect(err?.errors.actorUserId).toBeDefined();
    expect(err?.errors.action).toBeDefined();
    expect(err?.errors.entityType).toBeDefined();
    expect(err?.errors.entityId).toBeDefined();
  });

  it("accepts arbitrary before/after payloads", () => {
    const doc = new AuditLog({
      actorUserId: new Types.ObjectId(),
      action: "user.birthDate.updated",
      entityType: "User",
      entityId: new Types.ObjectId(),
      before: { birthDate: "1990-01-01" },
      after: { birthDate: "1991-02-02" },
    });
    expect(doc.validateSync()).toBeUndefined();
  });
});
